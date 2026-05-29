import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { inngest } from "@/lib/jobs/client";
import { expireCardFailures } from "@/lib/stripe/card-failure-recovery";

/**
 * Card-failure recovery-window expiry. Every 5 minutes, releases seats whose
 * recovery window (CARD_FAILURE_RECOVERY_WINDOW_MINUTES, default 4h) has
 * lapsed without the fan submitting a new card — the offer becomes 'unplaced'
 * and the held seat is freed.
 *
 * - No Stripe needed: the original auth already failed, so there's nothing to
 *   cancel — this is a pure DB state transition.
 * - concurrency 1 + step.run: a retry replays the memoized result; the work
 *   is idempotent regardless (a released offer no longer matches the query).
 */
export const cardFailureExpiry = inngest.createFunction(
  {
    id: "card-failure-expiry",
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) =>
    step.run("expire-card-failures", () =>
      expireCardFailures(
        db,
        new Date(),
        env.CARD_FAILURE_RECOVERY_WINDOW_MINUTES,
      ),
    ),
);
