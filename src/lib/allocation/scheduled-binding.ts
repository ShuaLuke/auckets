// The scheduled-binding sweep: find shows whose announced binding checkpoint
// has arrived and run the (existing, money-moving) binding allocation for
// each — plus recover shows whose previous run died mid-settlement.
// Extracted from the Inngest wrapper (src/lib/jobs/functions/
// scheduled-binding.ts) so the sweep is testable against a real DB without an
// Inngest execution context.
//
// Replaces the manual "Run binding" admin button as the default trigger — a
// single supervised beta show can still be bound by hand, but ops no longer
// has to be awake at the checkpoint.
//
// Granularity: every unit of work goes through the BindingStepRunner. Under
// Inngest that's step.run, which makes each unit durable and memoized —
// Phase 1 once per show, captures in small batches, finalize last. A crash
// or timeout anywhere mid-sweep is recovered by Inngest's retry (memoized
// steps replay, unfinished ones re-execute against idempotent operations),
// and a crash that exhausts retries is recovered by the NEXT tick's
// stuck-show pass. Directly invoked (tests, scripts) the runner is a
// pass-through and the sweep behaves as a plain sequential function.

import type Stripe from "stripe";

import type { Db } from "@/lib/db";
import {
  listShowIdsDueForBinding,
  listShowIdsStuckInAllocating,
} from "@/lib/db/repositories";
import { logger } from "@/lib/logger";

import {
  runBindingPhase1,
  settleBinding,
  type BindingStepRunner,
} from "./run-binding";

// How long a show may sit in 'allocating' past its binding checkpoint before
// the sweep treats it as a crashed run and resumes it. shows has no
// updated_at column, so binding_allocation_at is the proxy for "when the run
// started" — accurate for sweep-triggered runs (they start at the first tick
// after the checkpoint) and conservative for an early manual bind (recovery
// then waits until checkpoint+10min; the admin button resumes immediately if
// ops doesn't want to wait). 10 minutes = two sweep ticks of headroom, and
// the Inngest function's concurrency:1 guarantees a HEALTHY long-running
// sweep can't be raced by the next tick — only a genuinely dead run ages
// into this window.
const STUCK_ALLOCATING_THRESHOLD_MS = 10 * 60 * 1000;

export type SweepShowResult =
  | {
      showId: string;
      ok: true;
      // True when this show entered through settlement-only recovery (it
      // was already 'allocating' — a previous run's Phase 1 had committed).
      resumed: boolean;
      captured: number;
      cardFailures: number;
      cancelled: number;
    }
  | { showId: string; ok: false; error: string };

export type SweepResult = {
  due: number;
  // Shows found stuck in 'allocating' and routed into resume.
  stuck: number;
  bound: number;
  results: SweepShowResult[];
};

const directRunner: BindingStepRunner = (_id, fn) => fn();

export async function sweepDueBindings(
  db: Db,
  stripe: Stripe,
  now: Date,
  run: BindingStepRunner = directRunner,
): Promise<SweepResult> {
  const dueShowIds = await run("list-due-shows", () =>
    listShowIdsDueForBinding(db, now),
  );
  // Crashed-run recovery: shows whose Phase 1 committed ('allocating') but
  // whose settlement never finished. Disjoint from the due list by status
  // (due = open|closed), so no show is processed twice in one sweep.
  const stuckShowIds = await run("list-stuck-allocating", () =>
    listShowIdsStuckInAllocating(
      db,
      new Date(now.getTime() - STUCK_ALLOCATING_THRESHOLD_MS),
    ),
  );

  const results: SweepShowResult[] = [];

  for (const showId of dueShowIds) {
    // Each show is bound independently — one show's failure (e.g. a Stripe
    // hiccup) must not stop the others from binding at their checkpoint. A
    // show that fails here stays 'closed' or 'allocating', so the next tick
    // picks it up again via the due or stuck list.
    try {
      const phase1 = await run(`binding-phase1-${showId}`, () =>
        runBindingPhase1(db, showId),
      );
      if (!phase1.ok) {
        if (
          phase1.error.kind === "show_not_eligible" &&
          phase1.error.status === "allocating"
        ) {
          // The show moved to 'allocating' between the due query and the
          // claim — either a concurrent trigger's Phase 1 won (settlement
          // is idempotent, so helping it along is harmless) or that
          // trigger already crashed. Settle rather than skip.
          const settle = await settleBinding(db, stripe, showId, run);
          results.push({
            showId,
            ok: true,
            resumed: true,
            captured: settle.captured,
            cardFailures: settle.cardFailures,
            cancelled: settle.cancelled,
          });
          continue;
        }
        // 'show_not_eligible' is otherwise the benign concurrent case
        // (something already bound it between the query and the call).
        // Log and keep going.
        logger.warn(
          { showId, error: phase1.error.kind },
          "scheduled binding: show not bound",
        );
        results.push({ showId, ok: false, error: phase1.error.kind });
        continue;
      }

      const settle = await settleBinding(db, stripe, showId, run);
      results.push({
        showId,
        ok: true,
        resumed: false,
        captured: settle.captured,
        cardFailures: settle.cardFailures,
        cancelled: settle.cancelled,
      });
    } catch (err) {
      logger.error(
        { showId, err },
        "scheduled binding: unexpected failure binding show — will retry next tick",
      );
      results.push({ showId, ok: false, error: "unexpected_error" });
    }
  }

  for (const showId of stuckShowIds) {
    try {
      logger.warn(
        { showId },
        "scheduled binding: show stuck in 'allocating' — resuming settlement",
      );
      const settle = await settleBinding(db, stripe, showId, run);
      results.push({
        showId,
        ok: true,
        resumed: true,
        captured: settle.captured,
        cardFailures: settle.cardFailures,
        cancelled: settle.cancelled,
      });
    } catch (err) {
      logger.error(
        { showId, err },
        "scheduled binding: resume failed — will retry next tick",
      );
      results.push({ showId, ok: false, error: "unexpected_error" });
    }
  }

  const bound = results.filter((r) => r.ok).length;
  logger.info(
    { due: dueShowIds.length, stuck: stuckShowIds.length, bound },
    "scheduled binding sweep complete",
  );
  return {
    due: dueShowIds.length,
    stuck: stuckShowIds.length,
    bound,
    results,
  };
}
