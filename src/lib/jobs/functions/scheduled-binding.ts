import { sweepDueBindings } from "@/lib/allocation/scheduled-binding";
import type { BindingStepRunner } from "@/lib/allocation/run-binding";
import { db } from "@/lib/db";
import { inngest } from "@/lib/jobs/client";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe/client";

/**
 * Scheduled binding (replaces the manual "Run binding" admin button as the
 * default trigger). Sweeps every 5 minutes for shows whose announced binding
 * checkpoint has passed and binds them — and resumes shows a previous run
 * left stuck mid-settlement ('allocating').
 *
 * - concurrency: 1 — only one sweep at a time. runBindingAllocation also
 *   self-guards with a two-step compare-and-set (claim 'open' → 'closed'
 *   before reading the pool, then a conditional 'closed' → 'allocating'
 *   UPDATE that opens the Phase-1 transaction — a concurrent attempt loses
 *   that CAS and bails with zero writes), but this avoids redundant work,
 *   and it guarantees a healthy long-running sweep can't be raced by the
 *   next tick (important for the stuck-show heuristic — see
 *   STUCK_ALLOCATING_THRESHOLD_MS in src/lib/allocation/scheduled-binding.ts).
 * - Granular steps, not one big one: the sweep receives step.run and wraps
 *   each unit of work in its own durable step — the due/stuck queries,
 *   Phase 1 per show, captures in batches of 10, the unplaced-auth release,
 *   and the final 'allocated' flip. A crash or timeout anywhere mid-sweep is
 *   recovered by Inngest's retry: completed steps replay from the memoized
 *   JSON result, unfinished ones re-execute — and every step is idempotent
 *   by construction (status CAS + deterministic Stripe idempotency keys),
 *   not by relying on memoization. This replaces the old single
 *   step.run("sweep-due-bindings") that wrapped ALL shows' Stripe captures
 *   in one step, where a retry re-entered the whole sweep from scratch and a
 *   timeout mid-capture stranded shows in 'allocating'.
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
    // step.run returns Jsonify<T> (results are memoized as JSON); every
    // value the sweep passes through the runner is already JSON-plain
    // (string[] worklists, count objects, the Phase-1 outcome), so the
    // cast back to T is honest. Keeping the runner generic lets the same
    // sweep code run step-less in tests and scripts.
    const runner: BindingStepRunner = (id, fn) =>
      step.run(id, fn) as ReturnType<typeof fn>;
    return sweepDueBindings(db, activeStripe, new Date(), runner);
  },
);
