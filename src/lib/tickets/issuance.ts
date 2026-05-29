// Ticket issuance (ADR-0015 + TECHNICAL_INTEGRATION.md): T-48h before doors,
// mint a ticket — with a server-only signing secret — for every paid seat of
// a bound show. This is what brings the already-built TicketViewer + rotating
// token endpoint (#68/#69) to life: until a ticket row with a totp_secret
// exists, there's nothing to sign a QR for.
//
// Extracted from the Inngest wrapper so the sweep is testable against a real
// DB. Idempotent: only 'charged' seats without a ticket are issued, and the
// insert is ON CONFLICT DO NOTHING, so re-runs (and the cron's own retries)
// don't double-issue.

import type { Db } from "@/lib/db";
import {
  insertIssuedTickets,
  listChargedAssignmentsWithoutTicket,
  listShowIdsDueForTicketIssuance,
} from "@/lib/db/repositories";
import { logger } from "@/lib/logger";

import { generateTicketSecret } from "./token";

// Tickets issue 48h before doors.
export const TICKET_ISSUANCE_LEAD_MINUTES = 48 * 60;

export type IssueTicketsResult = {
  showsConsidered: number;
  ticketsIssued: number;
};

export async function issueTicketsForDueShows(
  db: Db,
  now: Date,
  leadMinutes: number = TICKET_ISSUANCE_LEAD_MINUTES,
): Promise<IssueTicketsResult> {
  const horizon = new Date(now.getTime() + leadMinutes * 60_000);
  const showIds = await listShowIdsDueForTicketIssuance(db, horizon);

  let ticketsIssued = 0;
  for (const showId of showIds) {
    const seats = await listChargedAssignmentsWithoutTicket(db, showId);
    if (seats.length === 0) continue;
    // Mint a fresh secret per ticket. The secret is the HMAC key the rotating
    // QR is signed with (src/lib/tickets/token.ts) — high-entropy, server-only.
    const rows = seats.map((s) => ({
      seatAssignmentId: s.seatAssignmentId,
      userId: s.userId,
      totpSecret: generateTicketSecret(),
    }));
    const inserted = await insertIssuedTickets(db, rows);
    ticketsIssued += inserted;
  }

  if (ticketsIssued > 0) {
    logger.info(
      { showsConsidered: showIds.length, ticketsIssued },
      "ticket issuance sweep issued tickets",
    );
  }
  return { showsConsidered: showIds.length, ticketsIssued };
}
