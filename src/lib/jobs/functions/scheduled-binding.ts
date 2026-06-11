import { sweepDueBindings } from "@/lib/allocation/scheduled-binding";
import { db } from "@/lib/db";
import { inngest } from "@/lib/jobs/client";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe/client";

/**
 * Scheduled binding (replaces the manual "Run binding" admin button as the
 * default trigger). Sweeps every 5 minutes for shows whose announced binding
 * checkpoint has passed and binds them.
 *
 * - concurrency: 1 — only one sweep at a time. runBindingAllocation also
 *   self-guards with a two-step compare-and-set (claim 'open' → 'closed'
 *   before reading the pool, then a conditional 'closed' → 'allocating'
 *   UPDATE that opens the Phase-1 transaction — a concurrent attempt loses
 *   that CAS and bails with zero writes), but this avoids redundant work.
 * - The sweep runs inside step.run, so an Inngest retry of this cron tick
 *   replays the memoized result rather than re-binding shows already handled.
 * - Binding moves real money; with Stripe unconfigured (local/dev) we skip
 *   rather than no-op-charge.
 */
export const scheduledBinding = inngest.createFunction(
  {
    id: "scheduled-binding",
    concurrency: { limit: 1 },
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    if (!stripe) {
      logger.warn(
        "scheduled-binding: Stripe not configured — skipping sweep",
      );
      return { skipped: "stripe_not_configured" as const };
    }
    // Capture the narrowed (non-null) client for the closure.
    const activeStripe = stripe;
    return step.run("sweep-due-bindings", () =>
      sweepDueBindings(db, activeStripe, new Date()),
    );
  },
);
