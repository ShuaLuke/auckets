// Read-path queries for the holds table. Write-path (create/update/
// delete) is intentionally deferred — the prototype's "Add hold"
// button + per-row trash icon ship in their own slice once we have
// a hold form. The GAE already respects venue_architectures.rows[].holds
// at allocation time; this table is a per-show addition.

import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { holds } from "../../../../drizzle/schema";

export type Hold = typeof holds.$inferSelect;

// Holds carry these schema values today. Free-form on the DB side but
// the route handler / dialog enforce the union at the boundary so we
// don't accumulate one-off label drift ("Artist comp" vs "artist-comp"
// vs "comp").
export const HOLD_KINDS = ["venue", "artist"] as const;
export type HoldKind = (typeof HOLD_KINDS)[number];

export async function listHoldsForShow(
  db: Db,
  showId: string,
): Promise<Hold[]> {
  return db.select().from(holds).where(eq(holds.showId, showId));
}
