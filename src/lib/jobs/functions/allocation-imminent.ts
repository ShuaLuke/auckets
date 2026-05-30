import { db } from "@/lib/db";
import { inngest } from "@/lib/jobs/client";
import { sweepAllocationImminent } from "@/lib/notifications/imminent";

/**
 * Allocation-imminent reminder. Every 15 minutes, finds shows whose binding
 * checkpoint is ~24h out and emails fans still holding a pool offer so they
 * can revise upward before allocation runs.
 *
 * - concurrency: 1 — one sweep at a time.
 * - The band the sweep selects matches this 15-min cadence, so each show is
 *   picked up in ~one tick (see sweepAllocationImminent for the dedup note).
 * - No Stripe dependency: this only sends email, which itself no-ops without
 *   RESEND_API_KEY, so the cron is safe to run in any environment.
 */
export const allocationImminent = inngest.createFunction(
  {
    id: "allocation-imminent",
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step }) =>
    step.run("sweep-allocation-imminent", () =>
      sweepAllocationImminent(db, new Date()),
    ),
);
