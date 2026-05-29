// The scheduled-binding sweep: find shows whose announced binding checkpoint
// has arrived and run the (existing, money-moving) binding allocation for
// each. Extracted from the Inngest wrapper (src/lib/jobs/functions/
// scheduled-binding.ts) so the sweep is testable against a real DB without an
// Inngest execution context.
//
// Replaces the manual "Run binding" admin button as the default trigger — a
// single supervised beta show can still be bound by hand, but ops no longer
// has to be awake at the checkpoint.

import type Stripe from "stripe";

import type { Db } from "@/lib/db";
import { listShowIdsDueForBinding } from "@/lib/db/repositories";
import { logger } from "@/lib/logger";

import { runBindingAllocation } from "./run-binding";

export type SweepShowResult =
  | {
      showId: string;
      ok: true;
      captured: number;
      cardFailures: number;
      cancelled: number;
    }
  | { showId: string; ok: false; error: string };

export type SweepResult = {
  due: number;
  bound: number;
  results: SweepShowResult[];
};

export async function sweepDueBindings(
  db: Db,
  stripe: Stripe,
  now: Date,
): Promise<SweepResult> {
  const dueShowIds = await listShowIdsDueForBinding(db, now);

  const results: SweepShowResult[] = [];
  for (const showId of dueShowIds) {
    // Each show is bound independently — one show's failure (e.g. a Stripe
    // hiccup) must not stop the others from binding at their checkpoint.
    const outcome = await runBindingAllocation(db, stripe, showId);
    if (outcome.ok) {
      const { captured, cardFailures, cancelled } = outcome.value;
      results.push({ showId, ok: true, captured, cardFailures, cancelled });
    } else {
      // 'show_not_eligible' is the benign concurrent case (something already
      // bound it between the query and the call). Log and keep going.
      logger.warn(
        { showId, error: outcome.error.kind },
        "scheduled binding: show not bound",
      );
      results.push({ showId, ok: false, error: outcome.error.kind });
    }
  }

  const bound = results.filter((r) => r.ok).length;
  logger.info(
    { due: dueShowIds.length, bound },
    "scheduled binding sweep complete",
  );
  return { due: dueShowIds.length, bound, results };
}
