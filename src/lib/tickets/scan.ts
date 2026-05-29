// Door-scan processing (Scanner, ADR-0015). Verifies a scanned rotating-QR
// token against the ticket's server-only secret, decides whether to admit,
// and appends to the ticket_scans audit log on EVERY scan (valid or not, per
// SECURITY.md #19). Split from the route so the decision flow is
// integration-testable.
//
// Geo-gating (ADR-0015) lives on the fan's TicketViewer (the QR only renders
// near the venue); the scanner trusts a presented token, so v1 records no
// distance and never returns geo_failed.

import type { Db } from "@/lib/db";
import {
  getTicketForScan,
  insertTicketScan,
  markTicketScanned,
} from "@/lib/db/repositories";

import { parseTicketId, verifyTicketToken } from "./token";

export type ScanResult = "ok" | "invalid" | "replay" | "expired_token";

export type ScanOutcome = {
  result: ScanResult;
  reason?: string;
  // The resolved ticket, when the token parsed to a real one (null for a
  // malformed token or an unknown id).
  ticketId: string | null;
};

export async function processTicketScan(
  db: Db,
  params: { token: string; staffId: string; now?: Date },
): Promise<ScanOutcome> {
  const nowMs = (params.now ?? new Date()).getTime();
  const ticketId = parseTicketId(params.token);

  // Not even shaped like a token → log without a ticket reference.
  if (!ticketId) {
    await insertTicketScan(db, {
      ticketId: null,
      scannedByStaffId: params.staffId,
      result: "invalid",
      reason: "malformed",
    });
    return { result: "invalid", reason: "malformed", ticketId: null };
  }

  const ticket = await getTicketForScan(db, ticketId);
  if (!ticket) {
    // Parsed an id that's not a real ticket — the FK can't store it, so the
    // scan logs with a null ticket + a reason.
    await insertTicketScan(db, {
      ticketId: null,
      scannedByStaffId: params.staffId,
      result: "invalid",
      reason: "unknown_ticket",
    });
    return { result: "invalid", reason: "unknown_ticket", ticketId: null };
  }

  const verify = verifyTicketToken(params.token, ticket.totpSecret, nowMs);
  if (!verify.ok) {
    // An expired window is its own bucket (a stale-but-real QR); forgery /
    // malformed / wrong-version all read as 'invalid'.
    const result: ScanResult =
      verify.reason === "expired_window" ? "expired_token" : "invalid";
    await insertTicketScan(db, {
      ticketId: ticket.id,
      scannedByStaffId: params.staffId,
      result,
      reason: verify.reason,
    });
    return { result, reason: verify.reason, ticketId: ticket.id };
  }

  // Signature is valid — now the ticket has to be admissible.
  if (ticket.status !== "issued") {
    const result: ScanResult = ticket.status === "scanned" ? "replay" : "invalid";
    const reason =
      ticket.status === "scanned" ? "already_scanned" : `ticket_${ticket.status}`;
    await insertTicketScan(db, {
      ticketId: ticket.id,
      scannedByStaffId: params.staffId,
      result,
      reason,
    });
    return { result, reason, ticketId: ticket.id };
  }

  // Admit. The status-guarded update closes the double-scan race: if a
  // concurrent scan admitted first, ours updates 0 rows → replay.
  const admitted = await markTicketScanned(db, ticket.id, params.staffId);
  if (admitted === 0) {
    await insertTicketScan(db, {
      ticketId: ticket.id,
      scannedByStaffId: params.staffId,
      result: "replay",
      reason: "already_scanned",
    });
    return { result: "replay", reason: "already_scanned", ticketId: ticket.id };
  }

  await insertTicketScan(db, {
    ticketId: ticket.id,
    scannedByStaffId: params.staffId,
    result: "ok",
  });
  return { result: "ok", ticketId: ticket.id };
}
