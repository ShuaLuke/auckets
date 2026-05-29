import { db } from "@/lib/db";
import { inngest } from "@/lib/jobs/client";
import { issueTicketsForDueShows } from "@/lib/tickets/issuance";

/**
 * Ticket issuance (ADR-0015). Every 15 minutes, issues tickets (with their
 * server-only signing secret) for the paid seats of any bound show within the
 * T-48h issuance horizon — lighting up the TicketViewer + rotating-QR
 * endpoint for those fans.
 *
 * - No Stripe: issuance is a pure DB write (the money already moved at
 *   binding / recovery).
 * - concurrency 1 + step.run: a retry replays the memoized result; the work
 *   is idempotent regardless (only un-ticketed charged seats are issued, and
 *   the insert is ON CONFLICT DO NOTHING).
 * - 15-minute cadence: issuance isn't latency-sensitive to the minute the way
 *   binding is, and 48h of slack means a ≤15-min delay is immaterial.
 */
export const ticketIssuance = inngest.createFunction(
  {
    id: "ticket-issuance",
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) =>
    step.run("issue-tickets-for-due-shows", () =>
      issueTicketsForDueShows(db, new Date()),
    ),
);
