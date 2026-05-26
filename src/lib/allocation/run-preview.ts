// Orchestration: load inputs, run the GAE via build-plan, write
// outputs in a transaction. This is the place where DB I/O happens —
// build-plan.ts and translate.ts stay pure.
//
// Flow:
//   1. Load show + venue architecture + pool offers (read-only).
//   2. Build the allocation plan (pure call).
//   3. In a single transaction:
//        - Delete prior preview rows for this show (preview is
//          re-runnable, so this is the cleanup of the previous run).
//        - Insert new seat_assignments rows (is_binding=false).
//        - Insert allocation_logs rows (mode='preview').
//   4. Return stats + write counts to the caller.
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
  getShowById,
  getVenueArchitectureById,
  listPoolOffersForShow,
} from "@/lib/db/repositories";
import {
  allocationLogs,
  seatAssignments,
} from "../../../drizzle/schema";

import {
  buildPreviewAllocationPlan,
  type AllocationPlan,
} from "./build-plan";

export type RunPreviewResult = {
  showId: string;
  mode: "preview";
  ranAt: Date;
  stats: AllocationPlan["result"]["stats"];
  assignmentsWritten: number;
  logsWritten: number;
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

  const poolOffers = await listPoolOffersForShow(db, showId);
  const plan = buildPreviewAllocationPlan(show, architecture, poolOffers);

  // Transactional swap: drop the previous preview, write the new one.
  // Binding rows (is_binding=true) are never touched — they're
  // post-binding state that survives preview re-runs.
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
    },
  };
}
