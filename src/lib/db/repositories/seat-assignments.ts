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

// Captured-money totals per show, from the binding seat assignments: the sum
// of charged_amount_cents and the count of seats that actually captured. The
// admin reconciliation surface compares these against the placed-seat count
// and the charged-offer count to prove "seats ↔ charges" line up after a
// binding run. charged_amount_cents is null until capture, so a seat held but
// not yet charged contributes 0 — exactly what reconciliation wants to catch.
export type ChargedTotals = { amountCents: number; chargedSeats: number };

export async function getChargedTotalsByShowIds(
  db: Db,
  showIds: string[],
): Promise<Map<string, ChargedTotals>> {
  const out = new Map<string, ChargedTotals>();
  if (showIds.length === 0) return out;

  const rows = await db
    .select({
      showId: seatAssignments.showId,
      // bigint sum comes back as a string from postgres-js; Number() is safe
      // for any realistic gross (a 5,000-seat house at $1,000 is 5e8 cents,
      // far under Number.MAX_SAFE_INTEGER).
      amountCents: sql<string>`COALESCE(SUM(${seatAssignments.chargedAmountCents}), 0)::bigint`,
      chargedSeats: sql<number>`COALESCE(SUM(CASE WHEN ${seatAssignments.chargedAmountCents} IS NOT NULL THEN array_length(${seatAssignments.seatNumbers}, 1) ELSE 0 END), 0)::int`,
    })
    .from(seatAssignments)
    .where(inArray(seatAssignments.showId, showIds))
    .groupBy(seatAssignments.showId);

  for (const row of rows) {
    out.set(row.showId, {
      amountCents: Number(row.amountCents) || 0,
      chargedSeats: Number(row.chargedSeats) || 0,
    });
  }

  return out;
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

