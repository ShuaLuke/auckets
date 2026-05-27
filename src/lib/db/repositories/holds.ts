// Read + write helpers for the holds table. The GAE already respects
// venue_architectures.rows[].holds at allocation time; this table is
// a per-show addition layered on top.
//
// Write-side posture (enforced at the route layer, not here):
//   - kind='artist' (comps) creatable + deletable by anyone who can
//     manage the artist (artist member OR AUCKETS_ADMIN).
//   - kind='venue' (ADA / production / sound desk) creatable +
//     deletable only by AUCKETS_ADMIN. Until VENUE_STAFF lands
//     (ADR-0012, Week 7), there's no artist-side path to touch
//     venue-kind holds.

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

// Single-row lookup. Used by DELETE /api/holds/[id] — the route loads
// the row, derives the showId for authorization, and only then
// proceeds with the delete. Returning the full row keeps the API
// symmetric with createHold below.
export async function getHoldById(
  db: Db,
  holdId: string,
): Promise<Hold | null> {
  const rows = await db
    .select()
    .from(holds)
    .where(eq(holds.id, holdId))
    .limit(1);
  return rows[0] ?? null;
}

export async function createHold(
  db: Db,
  params: {
    showId: string;
    source: string;
    kind: HoldKind;
    venueRowId: string;
    seatNumbers: string[];
    notes?: string;
  },
): Promise<Hold> {
  const rows = await db
    .insert(holds)
    .values({
      showId: params.showId,
      source: params.source,
      kind: params.kind,
      venueRowId: params.venueRowId,
      seatNumbers: params.seatNumbers,
      notes: params.notes ?? null,
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error(
      `createHold: no row returned (showId=${params.showId})`,
    );
  }
  return row;
}

// Hard delete is intentional — holds are operational state, not
// audit-relevant payment history. The GAE picks up the change on the
// next preview run. Returns the deleted row (or null when no row
// matched) so the caller can surface "already gone" cleanly.
export async function deleteHoldById(
  db: Db,
  holdId: string,
): Promise<Hold | null> {
  const rows = await db
    .delete(holds)
    .where(eq(holds.id, holdId))
    .returning();
  return rows[0] ?? null;
}
