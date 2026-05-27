// Read-path queries for the seat_assignments table.
//
// Repositories return raw DB shapes — text[] seat numbers, integer cents,
// raw enum/string fields. Display formatting (e.g. "Orchestra · Row AA ·
// seats 7–10") happens in the presenter, which joins the assignment to
// the venue architecture row to look up the area + row name.
//
// is_binding semantics: assignments are written by every allocation run
// (preview and binding). The schema's unique (offer_id) constraint
// guarantees one row per offer ever — re-running the allocation
// replaces, not appends. So a count of seat_numbers across a show is
// always "currently placed seats" regardless of mode.

import { eq, inArray, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { seatAssignments } from "../../../../drizzle/schema";

type SeatAssignment = typeof seatAssignments.$inferSelect;

export type { SeatAssignment };

export async function getSeatAssignmentByOfferId(
  db: Db,
  offerId: string,
): Promise<SeatAssignment | null> {
  // offer_id is UNIQUE on seat_assignments (drizzle/schema.ts line 259),
  // so at-most-one row. .limit(1) is belt-and-braces.
  const rows = await db
    .select()
    .from(seatAssignments)
    .where(eq(seatAssignments.offerId, offerId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listSeatAssignmentsByOfferIds(
  db: Db,
  offerIds: string[],
): Promise<Map<string, SeatAssignment>> {
  const out = new Map<string, SeatAssignment>();
  if (offerIds.length === 0) return out;

  // Used by GET /api/shows: the route handler has the caller's offer list
  // already (slice 4), so one batched query keyed by offer_id avoids the
  // N+1 trap on a fan with many placed offers.
  const rows = await db
    .select()
    .from(seatAssignments)
    .where(inArray(seatAssignments.offerId, offerIds));

  for (const row of rows) {
    out.set(row.offerId, row);
  }
  return out;
}

// All seat assignments for a show. Drives the ShowAdmin provisional
// placement seat map — one row per placed offer, with the seat numbers
// array surfacing which seats in the row are occupied.
//
// No status filter on the offer side: assignments only exist for
// successfully placed offers (the GAE writes nothing for unplaced),
// so the result set is "every seat the latest run filled."
export async function listSeatAssignmentsForShow(
  db: Db,
  showId: string,
): Promise<SeatAssignment[]> {
  return db
    .select()
    .from(seatAssignments)
    .where(eq(seatAssignments.showId, showId));
}

export async function getProvisionalFilledByShow(
  db: Db,
  showId: string,
): Promise<number> {
  // SUM(array_length(seat_numbers, 1)) counts seats, not assignments.
  // The ArtistDashboard prototype shows "487 / 624 seats" — that's
  // seat-level, and a group offer of 4 fills 4 seats with one row.
  // Empty pool returns NULL from SUM; we coalesce to 0.
  const rows = await db
    .select({
      filled: sql<number>`COALESCE(SUM(array_length(${seatAssignments.seatNumbers}, 1)), 0)::int`,
    })
    .from(seatAssignments)
    .where(eq(seatAssignments.showId, showId));
  return Number(rows[0]?.filled ?? 0) || 0;
}

export async function getProvisionalFilledByShowIds(
  db: Db,
  showIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (showIds.length === 0) return out;

  // GROUP BY show_id so per-row stats on the Artist Dashboard cost one
  // query instead of N. Shows with zero assignments don't appear in the
  // GROUP BY result — we backfill those below so the caller doesn't have
  // to special-case missing keys.
  const rows = await db
    .select({
      showId: seatAssignments.showId,
      filled: sql<number>`COALESCE(SUM(array_length(${seatAssignments.seatNumbers}, 1)), 0)::int`,
    })
    .from(seatAssignments)
    .where(inArray(seatAssignments.showId, showIds))
    .groupBy(seatAssignments.showId);

  for (const row of rows) {
    out.set(row.showId, Number(row.filled) || 0);
  }
  for (const showId of showIds) {
    if (!out.has(showId)) out.set(showId, 0);
  }
  return out;
}

