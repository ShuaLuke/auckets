/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { allocate } from "@/lib/gae";
import type { AllocationConfig } from "@/lib/gae/types";

import { checkInvariants } from "./invariants";
import { computeMetrics } from "./metrics";
import { offer, row, venue } from "./test-helpers";

const config: AllocationConfig = { mode: "preview", allowOrphans: true, maxGroupSize: 10, orphanPolicy: "leave" };

// Two rows of 4. Greedy: row 1 takes A(4). Row 2 takes B(2); C(3) no longer
// fits, FitResolver takes D(1); one seat empty. C is unplaced even though it
// would have fit row 2 — and a cheaper fan (D) sits there.
const v = venue([row({ id: "r1", rank: 1, cap: 4, tier: "premium" }), row({ id: "r2", rank: 2, cap: 4, tier: "mid", area: "front_balcony" })]);
const offers = [offer("A", 4, 10000), offer("B", 2, 9000), offer("C", 3, 8000), offer("D", 1, 7000)];

describe("computeMetrics on a hand-worked case", () => {
  const result = allocate({ venueId: v.venueId, rows: v.rows, activeRowIds: v.activeRowIds }, offers, config);
  const m = computeMetrics(v, offers, result, { venue: 0, artist: 0, comp: 0, production: 0 }, 1);

  it("fill and capacity", () => {
    expect(m.capacity).toMatchObject({ totalSeats: 8, heldSeats: 0, availableSeats: 8, activeRows: 2 });
    expect(m.fill).toMatchObject({ placedSeats: 7, emptySeats: 1, orphanSeats: 1, unfilledSeats: 0, rowsFull: 1, rowsPartial: 1, rowsEmpty: 0 });
    expect(m.fill.holesBySize).toEqual({ 1: 1 });
  });

  it("revenue in integer cents", () => {
    expect(m.revenue.grossPlacedCents).toBe(4 * 10000 + 2 * 9000 + 1 * 7000);
    expect(m.revenue.unplacedValueCents).toBe(3 * 8000);
    expect(m.revenue.unplacedFittableValueCents).toBe(3 * 8000);
    expect(m.revenue.avgPlacedPriceCents).toBe(Math.round(65000 / 7));
    expect(m.revenue.medianPlacedPriceCents).toBe(10000);
  });

  it("slices by tier / area and by group size", () => {
    expect(m.byTier.premium).toMatchObject({ availableSeats: 4, placedSeats: 4, fillRate: 1, offersPlaced: 1, grossCents: 40000 });
    expect(m.byTier.mid).toMatchObject({ availableSeats: 4, placedSeats: 3, emptySeats: 1, offersPlaced: 2, grossCents: 25000 });
    expect(m.byArea.front_balcony!.placedSeats).toBe(3);
    expect(m.byGroupSize[3]).toMatchObject({ offers: 1, placed: 0, placedRate: 0, ticketsRequested: 3, ticketsPlaced: 0, medianRowRank: null });
    expect(m.byGroupSize[1]).toMatchObject({ offers: 1, placed: 1, medianRowRank: 2, bestRowRank: 2, worstRowRank: 2 });
  });

  it("rank-respect: C lost row 2 to D, but D's seat plus the empty one next to it hold 2, not 3 — no violation, one deferral", () => {
    expect(m.rankRespect).toMatchObject({ passedOver: 0, passedOverOfferIds: [], priceGapMaxCents: 0, fitResolvedDeferrals: 1, waterfalled: 0, rowsLostSum: 0 });
    expect(m.preference.any).toMatchObject({ offers: 4, placedPreferred: 3, unplaced: 1 });
    expect(m.offers).toMatchObject({ total: 4, placed: 3, unplaced: 1, ticketsRequested: 10, ticketsPlaced: 7 });
  });

  it("the engine result passes every invariant", () => {
    expect(checkInvariants(v, offers, result)).toEqual([]);
  });
});

describe("preference honouring + waterfall show up in metrics", () => {
  it("counts a this_or_worse fan seated below their tier as waterfalled down, and rows lost when a placed offer is passed over", () => {
    const v2 = venue([
      row({ id: "p", rank: 1, cap: 2, tier: "premium" }),
      row({ id: "m", rank: 2, cap: 4, tier: "mid" }),
      row({ id: "r", rank: 3, cap: 4, tier: "rear" }),
    ]);
    const pool = [
      offer("top", 2, 20000, { type: "specific", tier: "premium" }),
      offer("flex", 4, 15000, { type: "this_or_worse", tier: "premium" }), // premium full → waterfalls to mid
      offer("mid-any", 2, 14000), // "any": placed in mid during the strict pass, before flex waterfalls
    ];
    const result = allocate({ venueId: "x", rows: v2.rows, activeRowIds: v2.activeRowIds }, pool, config);
    const m = computeMetrics(v2, pool, result, {}, 0);
    expect(m.preference.this_or_worse).toMatchObject({ offers: 1, placedWorse: 1 });
    expect(m.rankRespect.waterfalled).toBe(1);
    // flex (rank 2) ends in rear because mid-any (rank 3) took mid first — a passed-over with one row lost.
    expect(m.byTier.rear!.offersPlaced).toBe(1);
    // mid-any's 2-seat block + the 2 empty seats beside it = 4: flex would have fit.
    expect(m.rankRespect).toMatchObject({ passedOver: 1, passedOverOfferIds: ["flex"], rowsLostSum: 1, rowsLostMax: 1, priceGapMaxCents: 1000 });
  });

  it("a single filling a 1-seat hole does not count as passing a pair", () => {
    const v3 = venue([row({ id: "a", rank: 1, cap: 5, tier: "premium" }), row({ id: "b", rank: 2, cap: 4, tier: "premium" })]);
    const pool = [offer("p1", 4, 10000), offer("p2", 2, 9000), offer("p3", 2, 8500), offer("s", 1, 100)];
    const result = allocate({ venueId: "x", rows: v3.rows, activeRowIds: v3.activeRowIds }, pool, config);
    const m = computeMetrics(v3, pool, result, {}, 0);
    expect(m.byGroupSize[1]!.medianRowRank).toBe(1); // the $1 single sits in row 1
    expect(m.rankRespect.passedOver).toBe(0);
  });
});
