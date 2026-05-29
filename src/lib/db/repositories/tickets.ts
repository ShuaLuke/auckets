// Read-path queries for the tickets table.
//
// PRIVACY-CRITICAL — divergence from the usual "repo returns raw shape"
// convention.
//
// tickets.totp_secret is a base32-encoded otplib seed (drizzle/schema.ts
// line 374). Per ADR-0015 the seed must NEVER leave the server. Leaking
// it leaks every rotating QR for that fan, forever — that's a credential
// leak, not a UX violation. Compare to offers.private_threshold_cents
// (a UX field that slice 4 strips at the presenter): both are server-
// only, but the blast radius of a totp_secret leak is much higher, so
// we move the safety boundary into the repo layer where it's
// structurally enforced rather than presenter-dependent.
//
// What that means in practice:
//   - The repo functions here PROJECT only safe columns. totp_secret is
//     never SELECTed. A future route handler that constructs the view
//     from the raw repo result can't accidentally serialize a secret
//     that was never fetched.
//   - The rotating-QR endpoint (Austin prep, Weeks 11–14, ADR-0015)
//     will need its own dedicated repo function that DOES fetch
//     totp_secret. It will live alongside these and carry a name like
//     `getTicketSecretForRotatingQr` so call sites are loud.
//
// The shape returned here is TicketSummary, not the schema-inferred
// Ticket — by design, so consumers can't widen back to the secret-
// carrying shape without an explicit second query.

import { and, eq, inArray, isNull } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  offers,
  seatAssignments,
  ticketScans,
  tickets,
} from "../../../../drizzle/schema";

// Status enum from schema line 376. Kept as a union so unknown future
// values surface a TS error at the presenter boundary rather than
// silently being rendered.
export type TicketStatus =
  | "issued"
  | "scanned"
  | "resold"
  | "gifted"
  | "expired";

export type TicketSummary = {
  id: string;
  seatAssignmentId: string;
  userId: string;
  status: TicketStatus;
  scannedAt: Date | null;
  scannedByStaffId: string | null;
  issuedAt: Date;
  createdAt: Date;
};

// Explicit column projection — note the absence of tickets.totpSecret.
// Adding it here is the only way to widen the read; do not do that
// outside the dedicated rotating-QR helper.
const TICKET_SUMMARY_SELECTION = {
  id: tickets.id,
  seatAssignmentId: tickets.seatAssignmentId,
  userId: tickets.userId,
  status: tickets.status,
  scannedAt: tickets.scannedAt,
  scannedByStaffId: tickets.scannedByStaffId,
  issuedAt: tickets.issuedAt,
  createdAt: tickets.createdAt,
} as const;

// tickets.status is TEXT in the schema; narrow the projected string to
// TicketStatus. Same pattern as ShowStatus / OfferStatus in the
// presenters. The input row already comes back with the right field
// types from Drizzle's selectColumn projection — we only need to narrow
// status.
type ProjectedTicketRow = Omit<TicketSummary, "status"> & { status: string };

function narrow(row: ProjectedTicketRow): TicketSummary {
  return { ...row, status: row.status as TicketStatus };
}

export async function getTicketByAssignmentId(
  db: Db,
  seatAssignmentId: string,
): Promise<TicketSummary | null> {
  // seat_assignment_id is UNIQUE on tickets (drizzle/schema.ts line 365),
  // so at-most-one row. .limit(1) is belt-and-braces.
  const rows = await db
    .select(TICKET_SUMMARY_SELECTION)
    .from(tickets)
    .where(eq(tickets.seatAssignmentId, seatAssignmentId))
    .limit(1);
  const row = rows[0];
  return row ? narrow(row) : null;
}

export async function listTicketsByAssignmentIds(
  db: Db,
  seatAssignmentIds: string[],
): Promise<Map<string, TicketSummary>> {
  const out = new Map<string, TicketSummary>();
  if (seatAssignmentIds.length === 0) return out;

  const rows = await db
    .select(TICKET_SUMMARY_SELECTION)
    .from(tickets)
    .where(inArray(tickets.seatAssignmentId, seatAssignmentIds));

  for (const row of rows) {
    out.set(row.seatAssignmentId, narrow(row));
  }
  return out;
}

// The dedicated, loudly-named secret-fetching helper the file header
// anticipates. This is the ONLY function that SELECTs tickets.totp_secret.
//
// It exists solely so the rotating-QR token endpoint can sign a token
// server-side. The returned secret MUST be used only to compute the HMAC
// (src/lib/tickets/token.ts) and MUST NOT be serialized into any response —
// the route returns the signed token, never the secret. userId is included
// so the route can enforce ownership before minting a token.
export type TicketSecret = {
  id: string;
  userId: string;
  totpSecret: string;
};

export async function getTicketSecretForRotatingQr(
  db: Db,
  ticketId: string,
): Promise<TicketSecret | null> {
  const rows = await db
    .select({
      id: tickets.id,
      userId: tickets.userId,
      totpSecret: tickets.totpSecret,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Issuance (write path).
// ---------------------------------------------------------------------------

export type IssuableSeat = {
  seatAssignmentId: string;
  // The seat's owner — the offer's user (ticket.user_id references users.id).
  userId: string;
};

// Binding seat assignments for a show whose offer is 'charged' (paid) but that
// don't yet have a ticket — the work list for issuance. A left join to tickets
// with an IS NULL filter excludes seats already issued, so this is naturally
// idempotent across re-runs.
export async function listChargedAssignmentsWithoutTicket(
  db: Db,
  showId: string,
): Promise<IssuableSeat[]> {
  const rows = await db
    .select({
      seatAssignmentId: seatAssignments.id,
      userId: offers.userId,
    })
    .from(seatAssignments)
    .innerJoin(offers, eq(offers.id, seatAssignments.offerId))
    .leftJoin(tickets, eq(tickets.seatAssignmentId, seatAssignments.id))
    .where(
      and(
        eq(seatAssignments.showId, showId),
        eq(seatAssignments.isBinding, true),
        eq(offers.status, "charged"),
        isNull(tickets.id),
      ),
    );
  return rows;
}

export type TicketToIssue = {
  seatAssignmentId: string;
  userId: string;
  // Server-minted via generateTicketSecret(). Written, never read back here.
  totpSecret: string;
};

// Insert issued tickets. ON CONFLICT (seat_assignment_id) DO NOTHING makes a
// concurrent or repeated issuance run a no-op for already-issued seats.
// Returns the count actually inserted; deliberately does NOT return the rows
// (and never the secret) — issuance is fire-and-forget.
export async function insertIssuedTickets(
  db: Db,
  rows: TicketToIssue[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(tickets)
    .values(rows)
    .onConflictDoNothing({ target: tickets.seatAssignmentId })
    .returning({ id: tickets.id });
  return inserted.length;
}

// ---------------------------------------------------------------------------
// Scanning (door — Scanner). Like getTicketSecretForRotatingQr, getTicketForScan
// is a loudly-named, server-only read that touches totp_secret (to verify the
// scanned token). The secret is used only to recompute the HMAC and is never
// returned to a response.
// ---------------------------------------------------------------------------

export type TicketForScan = {
  id: string;
  status: string;
  totpSecret: string;
};

export async function getTicketForScan(
  db: Db,
  ticketId: string,
): Promise<TicketForScan | null> {
  const rows = await db
    .select({
      id: tickets.id,
      status: tickets.status,
      totpSecret: tickets.totpSecret,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return rows[0] ?? null;
}

// Mark a ticket admitted. Guarded on status='issued' so a concurrent double
// scan can't admit twice — the second update matches 0 rows, which the caller
// reads as a replay. Returns the number of rows updated (0 or 1).
export async function markTicketScanned(
  db: Db,
  ticketId: string,
  staffId: string,
): Promise<number> {
  const updated = await db
    .update(tickets)
    .set({ status: "scanned", scannedAt: new Date(), scannedByStaffId: staffId })
    .where(and(eq(tickets.id, ticketId), eq(tickets.status, "issued")))
    .returning({ id: tickets.id });
  return updated.length;
}

export type TicketScanRecord = {
  // Null for a scan that didn't resolve to a known ticket (malformed token /
  // unknown id) — the FK only allows a real ticket id.
  ticketId: string | null;
  scannedByStaffId: string;
  result: "ok" | "invalid" | "replay" | "expired_token" | "geo_failed" | "staff_override";
  reason?: string;
};

// Append a scan to the audit log (every scan, valid or not — SECURITY.md #19).
export async function insertTicketScan(
  db: Db,
  record: TicketScanRecord,
): Promise<void> {
  await db.insert(ticketScans).values({
    ticketId: record.ticketId,
    scannedByStaffId: record.scannedByStaffId,
    result: record.result,
    reason: record.reason ?? null,
  });
}
