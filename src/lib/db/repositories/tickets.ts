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

import { eq, inArray } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { tickets } from "../../../../drizzle/schema";

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
