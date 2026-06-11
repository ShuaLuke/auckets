// Orchestration: load inputs, run the GAE via build-plan, write
// outputs in a transaction. This is the place where DB I/O happens —
// build-plan.ts and translate.ts stay pure.
//
// Flow:
//   1. Load show + venue architecture + pool offers (read-only).
//   2. Build the allocation plan (pure call).
//   3. Diff this run against the prior preview projection to derive per-fan
//      displacement alerts (ADR-0018 §4) — read the baseline before the swap.
//   4. In a single transaction:
//        - Delete prior preview rows for this show (preview is
//          re-runnable, so this is the cleanup of the previous run).
//        - Insert new seat_assignments rows (is_binding=false).
//        - Insert allocation_logs rows (mode='preview').
//        - Insert displacement_events rows for the alerts from step 3.
//   5. Return stats + write counts to the caller.
//
// Binding mode is NOT implemented in this slice. It needs additional
// concerns — offer.status transitions (pool → placed/unplaced),
// shows.status transitions (open → allocating → allocated), and the
// downstream Stripe PaymentIntent + ticket-issuance triggers. Those
// land in their own slice. Calling this with binding inputs would do
// the wrong thing silently, so we keep the function name explicit and
// the orchestrator scoped.

import { and, eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  getLatestRaiseTargetsByOfferForShow,
  getShowById,
  getVenueArchitectureById,
  listHoldsForShow,
  listPoolOffersForShow,
  listSeatAssignmentsForShow,
} from "@/lib/db/repositories";
import {
  allocationLogs,
  displacementEvents,
  seatAssignments,
} from "../../../drizzle/schema";

import {
  buildPreviewAllocationPlan,
  type AllocationPlan,
} from "./build-plan";
import { detectDisplacementEvents, type Placement } from "./displacement";
import { mergeShowHoldsIntoArchitecture } from "./translate";

export type RunPreviewResult = {
  showId: string;
  mode: "preview";
  ranAt: Date;
  stats: AllocationPlan["result"]["stats"];
  assignmentsWritten: number;
  logsWritten: number;
  // Per-fan displacement alerts emitted by diffing this run against the prior
  // preview projection (ADR-0018 §4).
  displacementEventsWritten: number;
};

export type RunPreviewError =
  | { kind: "show_not_found"; showId: string }
  | { kind: "architecture_not_found"; architectureId: string }
  | { kind: "show_not_eligible"; status: string };

export type RunPreviewOutcome =
  | { ok: true; value: RunPreviewResult }
  | { ok: false; error: RunPreviewError };

// Pre-binding statuses where preview allocation is meaningful. Once a
// show has moved into allocating/allocated/complete, preview re-runs
// would misrepresent the binding state and confuse the dashboard.
const PREVIEW_ELIGIBLE_STATUSES = new Set([
  "draft",
  "open",
  "paused",
]);

export async function runPreviewAllocation(
  db: Db,
  showId: string,
): Promise<RunPreviewOutcome> {
  const show = await getShowById(db, showId);
  if (!show) {
    return { ok: false, error: { kind: "show_not_found", showId } };
  }
  if (!PREVIEW_ELIGIBLE_STATUSES.has(show.status)) {
    return {
      ok: false,
      error: { kind: "show_not_eligible", status: show.status },
    };
  }

  // getShowById joins venue_architectures already; keep the read
  // explicit so the architecture type stays narrow (the show join
  // returns it bundled, but we re-fetch via the dedicated repo in
  // case future refactors split them).
  const architecture = await getVenueArchitectureById(
    db,
    show.venueArchitectureId,
  );
  if (!architecture) {
    return {
      ok: false,
      error: {
        kind: "architecture_not_found",
        architectureId: show.venueArchitectureId,
      },
    };
  }

  // Per-show holds (artist comps, ADA, production) live in the `holds`
  // table — the architecture JSONB only carries building-level manifest
  // holds. Merge them so the GAE never seats a fan in a held seat. The
  // binding run does the same merge, so preview stays faithful to it.
  const showHolds = await listHoldsForShow(db, showId);
  const effectiveArchitecture = mergeShowHoldsIntoArchitecture(
    architecture,
    showHolds,
  );

  const poolOffers = await listPoolOffersForShow(db, showId);
  const plan = buildPreviewAllocationPlan(
    show,
    effectiveArchitecture,
    poolOffers,
  );

  // ---- Displacement alerts (ADR-0018 §4) ----
  // Diff this run against the PRIOR preview projection to find the per-fan
  // transitions worth alerting on. Read the baseline (current preview rows)
  // before the swap below deletes them.
  const priorAssignments = await listSeatAssignmentsForShow(db, showId);
  const prevByOffer = new Map<string, Placement>();
  for (const a of priorAssignments) {
    if (a.isBinding) continue; // baseline is the preview projection only
    prevByOffer.set(a.offerId, { tier: a.tier, venueRowId: a.venueRowId });
  }
  const newByOffer = new Map<string, Placement>();
  for (const r of plan.assignmentRows) {
    newByOffer.set(r.offerId, { tier: r.tier, venueRowId: r.venueRowId });
  }
  const lastRaiseToByOffer = await getLatestRaiseTargetsByOfferForShow(
    db,
    showId,
  );
  // Tier ordering for better/worse: a higher floor is a better section.
  const floors = (show.tierFloorsCents ?? {}) as Record<string, number>;
  const displacementEventRows = detectDisplacementEvents({
    prevByOffer,
    newByOffer,
    autoBidRaises: plan.autoBidRaises,
    offers: plan.resolvedOffers,
    lastRaiseToByOffer,
    tierRank: (tier) => (tier ? floors[tier] ?? 0 : 0),
  });

  // Transactional swap: drop the previous preview, write the new one, and
  // append any displacement alerts. Binding rows (is_binding=true) are never
  // touched — they're post-binding state that survives preview re-runs.
  await db.transaction(async (tx) => {
    await tx
      .delete(seatAssignments)
      .where(
        and(
          eq(seatAssignments.showId, showId),
          eq(seatAssignments.isBinding, false),
        ),
      );
    if (plan.assignmentRows.length > 0) {
      await tx.insert(seatAssignments).values(plan.assignmentRows);
    }
    if (plan.logRows.length > 0) {
      await tx.insert(allocationLogs).values(plan.logRows);
    }
    if (displacementEventRows.length > 0) {
      await tx.insert(displacementEvents).values(
        displacementEventRows.map((e) => ({
          showId,
          offerId: e.offerId,
          userId: e.userId,
          kind: e.kind,
          detail: e.detail,
        })),
      );
    }
  });

  return {
    ok: true,
    value: {
      showId,
      mode: "preview",
      // Timestamp the response so the admin caller can correlate with
      // the allocation_logs.created_at column on the inserted rows.
      // We don't write this back; it's just for the response.
      ranAt: new Date(),
      stats: plan.result.stats,
      assignmentsWritten: plan.assignmentRows.length,
      logsWritten: plan.logRows.length,
      displacementEventsWritten: displacementEventRows.length,
    },
  };
}
