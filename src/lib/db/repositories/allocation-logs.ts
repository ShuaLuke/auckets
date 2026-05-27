// Read-path queries for the allocation_logs append-only audit table.
//
// The table is written by the allocation engine — one row per GAE
// decision (PLACED / SKIPPED / ORPHAN_DETECTED / WATERFALLED / etc.) —
// and never updated or deleted (schema enforces this with RESTRICT
// FKs). Repository layer returns raw DB shapes; display formatting
// happens in the activity presenter.

import { and, desc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { allocationLogs } from "../../../../drizzle/schema";

export type AllocationLog = typeof allocationLogs.$inferSelect;

// Actions that are useful in the Recent activity feed. RUN_START /
// RUN_END / FIT_RESOLVED are noise to the artist — they exist for
// the audit trail but don't belong in a "what changed" feed. The
// explicit allow-list also makes the activity presenter's mapping
// exhaustive (TS catches new actions at the boundary).
const ACTIVITY_RELEVANT_ACTIONS = [
  "PLACED",
  "SKIPPED",
  "ORPHAN_DETECTED",
  "WATERFALLED",
] as const;

// Recent log rows for the activity feed. Filtered to mode='preview'
// (binding runs land with their own slice) and to actions the artist
// cares about. LIMIT 50 caps the scan; the activity presenter takes
// the union with offer events and slices to top 10.
export async function listRecentAllocationLogsForShow(
  db: Db,
  showId: string,
  limit = 50,
): Promise<AllocationLog[]> {
  return db
    .select()
    .from(allocationLogs)
    .where(
      and(
        eq(allocationLogs.showId, showId),
        eq(allocationLogs.mode, "preview"),
        inArray(allocationLogs.action, [...ACTIVITY_RELEVANT_ACTIONS]),
      ),
    )
    .orderBy(desc(allocationLogs.createdAt))
    .limit(limit);
}
