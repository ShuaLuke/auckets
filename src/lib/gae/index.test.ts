import { describe, expect, it } from "vitest";

import { allocate } from "./index";
import { computeRankKey } from "./rankkey";
import type {
  AllocationConfig,
  RankedOffer,
  TierPreference,
  VenueArchitecture,
  VenueRow,
} from "./types";

const baseConfig: AllocationConfig = {
  mode: "preview",
  allowOrphans: true,
  maxGroupSize: 10,
  orphanPolicy: "leave",
};

type RowSpec = {
  id: string;
  rowRank: number;
  capacity: number;
  tier?: string;
  holds?: string[];
  isGa?: boolean;
  lean?: VenueRow["lean"];
};

function makeRow(spec: RowSpec): VenueRow {
  return {
    id: spec.id,
    area: "orchestra",
    section: "center",
    rowName: spec.id,
    rowRank: spec.rowRank,
    capacity: spec.capacity,
    parity: "ODD",
    lean: spec.lean ?? "LEFT",
    seatNumbers: Array.from(
      { length: spec.capacity },
      (_, i) => `${spec.id}-${i + 1}`,
    ),
    holds: spec.holds ?? [],
    ...(spec.tier !== undefined && { tier: spec.tier }),
    ...(spec.isGa !== undefined && { isGa: spec.isGa }),
  };
}

function makeVenue(rows: VenueRow[]): VenueArchitecture {
  return {
    venueId: "venue-1",
    rows,
    activeRowIds: rows.map((r) => r.id),
  };
}

type OfferSpec = {
  id: string;
  pricePerTicketCents: number;
  groupSize: number;
  tierPreference?: TierPreference;
};

function makeOffer(spec: OfferSpec): RankedOffer {
  return {
    id: spec.id,
    userId: `user-${spec.id}`,
    showId: "show-1",
    groupSize: spec.groupSize,
    pricePerTicketCents: spec.pricePerTicketCents,
    rankKey: computeRankKey(spec.pricePerTicketCents, spec.groupSize),
    submittedAt: new Date("2026-01-01T00:00:00Z"),
    tierPreference: spec.tierPreference ?? { type: "any" },
  };
}

describe("allocate — total-accounting invariant", () => {
  it("placedSeats + orphanSeats + unfilledSeats equals total available capacity", () => {
    const rows = [
      makeRow({ id: "row-1", rowRank: 1, capacity: 10, holds: ["row-1-5"] }),
      makeRow({ id: "row-2", rowRank: 2, capacity: 8 }),
      makeRow({ id: "row-3", rowRank: 3, capacity: 6, holds: ["row-3-1", "row-3-2"] }),
    ];
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 9000, groupSize: 6 }),
      makeOffer({ id: "B", pricePerTicketCents: 8000, groupSize: 4 }),
      makeOffer({ id: "C", pricePerTicketCents: 7000, groupSize: 3 }),
      // Way too big — should land in unplaced and contribute to unfilledSeats.
      makeOffer({ id: "huge", pricePerTicketCents: 5000, groupSize: 9 }),
    ];

    const result = allocate(makeVenue(rows), offers, baseConfig);

    const totalAvailable = 10 - 1 + 8 + (6 - 2); // 9 + 8 + 4 = 21
    expect(
      result.stats.placedSeats +
        result.stats.orphanSeats +
        result.stats.unfilledSeats,
    ).toBe(totalAvailable);
  });

  it("derives placedOffers from unique offer IDs in assignments", () => {
    const rows = [makeRow({ id: "row-1", rowRank: 1, capacity: 10 })];
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 9000, groupSize: 4 }),
      makeOffer({ id: "B", pricePerTicketCents: 8000, groupSize: 4 }),
    ];

    const result = allocate(makeVenue(rows), offers, baseConfig);

    expect(result.stats.totalOffers).toBe(2);
    expect(result.stats.placedOffers).toBe(2);
    expect(result.stats.placedSeats).toBe(8);
  });

  it("computes fillRate as placedSeats / totalAvailable, in [0, 1]", () => {
    const rows = [makeRow({ id: "row-1", rowRank: 1, capacity: 10 })];
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 9000, groupSize: 7 }),
    ];
    const result = allocate(makeVenue(rows), offers, baseConfig);
    expect(result.stats.fillRate).toBeCloseTo(0.7, 5);
  });

  it("returns fillRate 0 when there's no available capacity (no division by zero)", () => {
    // Active row exists but all seats are held.
    const rows = [
      makeRow({
        id: "row-1",
        rowRank: 1,
        capacity: 2,
        holds: ["row-1-1", "row-1-2"],
      }),
    ];
    const result = allocate(makeVenue(rows), [], baseConfig);
    expect(result.stats.fillRate).toBe(0);
    expect(result.stats.placedSeats).toBe(0);
    expect(result.stats.orphanSeats).toBe(0);
    expect(result.stats.unfilledSeats).toBe(0);
  });
});

describe("allocate — orphan vs unfilled classification", () => {
  it("a partially-filled row contributes its remainder to orphanSeats", () => {
    // Row of 10, single offer of 6 → 4 orphan seats.
    const rows = [makeRow({ id: "row-1", rowRank: 1, capacity: 10 })];
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 9000, groupSize: 6 }),
    ];
    const result = allocate(makeVenue(rows), offers, baseConfig);
    expect(result.stats.placedSeats).toBe(6);
    expect(result.stats.orphanSeats).toBe(4);
    expect(result.stats.unfilledSeats).toBe(0);
  });

  it("a row with zero placements contributes its full available to unfilledSeats", () => {
    const rows = [
      makeRow({ id: "row-1", rowRank: 1, capacity: 4 }),
      makeRow({ id: "row-2", rowRank: 2, capacity: 6 }), // never used
    ];
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 9000, groupSize: 4 }),
    ];
    const result = allocate(makeVenue(rows), offers, baseConfig);
    expect(result.stats.placedSeats).toBe(4);
    expect(result.stats.orphanSeats).toBe(0);
    expect(result.stats.unfilledSeats).toBe(6);
  });
});

describe("allocate — parity / fill instrumentation", () => {
  it("reports hole sizes and flags odd-shaped holes", () => {
    // Row of 7 (odd capacity), one group of 4 placed LEFT → a 3-seat hole.
    const rows = [makeRow({ id: "row-1", rowRank: 1, capacity: 7 })];
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 9000, groupSize: 4 }),
    ];
    const result = allocate(makeVenue(rows), offers, baseConfig);

    expect(result.stats.emptySeats).toBe(3);
    expect(result.stats.holesBySize).toEqual({ 3: 1 });
    expect(result.stats.oddHoleSeats).toBe(3);
    expect(result.stats.emptySeatsOddRows).toBe(3);
    expect(result.stats.emptySeatsEvenRows).toBe(0);
  });

  it("a held seat splits empty seats into separate holes", () => {
    // Row of 6 (even), hold at the 4th seat, no offers. Open positions
    // 1-3 and 5-6 → a 3-hole and a 2-hole.
    const rows = [
      makeRow({ id: "row-1", rowRank: 1, capacity: 6, holds: ["row-1-4"] }),
    ];
    const result = allocate(makeVenue(rows), [], baseConfig);

    expect(result.stats.emptySeats).toBe(5);
    expect(result.stats.holesBySize).toEqual({ 3: 1, 2: 1 });
    expect(result.stats.oddHoleSeats).toBe(3);
    expect(result.stats.emptySeatsEvenRows).toBe(5);
    expect(result.stats.emptySeatsOddRows).toBe(0);
  });

  it("counts GA empty seats in emptySeats but excludes them from hole shapes", () => {
    // GA bucket of 5, one group of 2 → 3 empty, but GA carries no seat
    // geometry: no holes, no odd/even-row attribution.
    const rows = [makeRow({ id: "ga-1", rowRank: 1, capacity: 5, isGa: true })];
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 9000, groupSize: 2 }),
    ];
    const result = allocate(makeVenue(rows), offers, baseConfig);

    expect(result.stats.emptySeats).toBe(3);
    expect(result.stats.holesBySize).toEqual({});
    expect(result.stats.oddHoleSeats).toBe(0);
    expect(result.stats.emptySeatsOddRows).toBe(0);
    expect(result.stats.emptySeatsEvenRows).toBe(0);
  });

  it("emptySeats equals orphanSeats + unfilledSeats", () => {
    const rows = [
      makeRow({ id: "row-1", rowRank: 1, capacity: 10 }),
      makeRow({ id: "row-2", rowRank: 2, capacity: 6 }),
    ];
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 9000, groupSize: 6 }),
    ];
    const result = allocate(makeVenue(rows), offers, baseConfig);

    expect(result.stats.emptySeats).toBe(
      result.stats.orphanSeats + result.stats.unfilledSeats,
    );
  });
});

describe("allocate — end-to-end pipeline (launchpad + waterfall)", () => {
  it("waterfalls a soft-preference offer when its preferred tier filled in launchpad", () => {
    const rows = [
      makeRow({ id: "prem-1", rowRank: 1, capacity: 4, tier: "premium" }),
      makeRow({ id: "mid-1", rowRank: 5, capacity: 4, tier: "mid" }),
    ];
    const offers = [
      makeOffer({
        id: "prem-strict",
        pricePerTicketCents: 9500,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "premium" },
      }),
      makeOffer({
        id: "prem-flex",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "this_or_worse", tier: "premium" },
      }),
    ];

    const result = allocate(makeVenue(rows), offers, baseConfig);

    expect(result.unplaced).toEqual([]);
    expect(result.stats.placedOffers).toBe(2);
    // Decisions span both phases.
    const actions = result.decisions.map((d) => d.action);
    expect(actions).toContain("PLACED");
    expect(actions).toContain("WATERFALLED");
  });

  it("emits unplaced with no_fit_anywhere when an offer can't be placed in any phase", () => {
    const rows = [makeRow({ id: "row-1", rowRank: 1, capacity: 4 })];
    const offers = [
      makeOffer({ id: "fits", pricePerTicketCents: 9000, groupSize: 4 }),
      makeOffer({ id: "too-big", pricePerTicketCents: 8000, groupSize: 6 }),
    ];

    const result = allocate(makeVenue(rows), offers, baseConfig);

    expect(result.unplaced).toEqual([
      { offerId: "too-big", reason: "no_fit_anywhere" },
    ]);
    expect(result.stats.unplacedOffers).toBe(1);
  });
});

describe("allocate — degenerates", () => {
  it("handles empty offers cleanly", () => {
    const rows = [makeRow({ id: "row-1", rowRank: 1, capacity: 4 })];
    const result = allocate(makeVenue(rows), [], baseConfig);
    expect(result.assignments).toEqual([]);
    expect(result.unplaced).toEqual([]);
    expect(result.stats.totalOffers).toBe(0);
    expect(result.stats.placedOffers).toBe(0);
    expect(result.stats.unfilledSeats).toBe(4);
  });

  it("handles empty venue (no active rows) cleanly", () => {
    const venue: VenueArchitecture = {
      venueId: "empty",
      rows: [],
      activeRowIds: [],
    };
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 9000, groupSize: 2 }),
    ];
    const result = allocate(venue, offers, baseConfig);
    expect(result.assignments).toEqual([]);
    expect(result.unplaced).toHaveLength(1);
    expect(result.stats.fillRate).toBe(0);
  });
});

describe("allocate — determinism", () => {
  it("same input + same config produces identical output", () => {
    const rows = [
      makeRow({ id: "prem-1", rowRank: 1, capacity: 6, tier: "premium" }),
      makeRow({ id: "mid-1", rowRank: 5, capacity: 8, tier: "mid" }),
      makeRow({ id: "rear-1", rowRank: 10, capacity: 4, tier: "rear" }),
    ];
    const offers = [
      makeOffer({
        id: "A",
        pricePerTicketCents: 9500,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "premium" },
      }),
      makeOffer({
        id: "B",
        pricePerTicketCents: 9000,
        groupSize: 3,
        tierPreference: { type: "this_or_worse", tier: "premium" },
      }),
      makeOffer({
        id: "C",
        pricePerTicketCents: 8500,
        groupSize: 5,
        tierPreference: { type: "any" },
      }),
      makeOffer({
        id: "D",
        pricePerTicketCents: 8000,
        groupSize: 4,
        tierPreference: { type: "this_or_better", tier: "rear" },
      }),
    ];

    const venue = makeVenue(rows);
    const first = allocate(venue, offers, baseConfig);
    const second = allocate(venue, offers, baseConfig);

    expect(second.assignments).toEqual(first.assignments);
    expect(second.unplaced).toEqual(first.unplaced);
    expect(second.stats).toEqual(first.stats);
    // Decisions also identical in order and content.
    expect(second.decisions).toEqual(first.decisions);
  });
});

describe("allocate — small mixed-tier scenario", () => {
  it("produces a coherent allocation across all tiers with a mix of preference types", () => {
    // Capacities sized so that wants-premium-flex (size 3) has nowhere
    // to fit in premium (exactly filled) and waterfalls to mid (which
    // still has 4 seats after `anywhere` takes 4).
    const rows = [
      makeRow({ id: "prem-1", rowRank: 1, capacity: 4, tier: "premium" }),
      makeRow({ id: "mid-1", rowRank: 5, capacity: 8, tier: "mid" }),
      makeRow({ id: "rear-1", rowRank: 10, capacity: 6, tier: "rear" }),
    ];
    const offers = [
      // High roller, locked to premium. Fills it exactly.
      makeOffer({
        id: "premium-locked",
        pricePerTicketCents: 12000,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "premium" },
      }),
      // Wants premium but flexible. Premium has zero leftover after
      // premium-locked, so this should waterfall to mid (which has room
      // for a size-3 group after the size-4 anywhere offer goes in).
      makeOffer({
        id: "wants-premium-flex",
        pricePerTicketCents: 10000,
        groupSize: 3,
        tierPreference: { type: "this_or_worse", tier: "premium" },
      }),
      makeOffer({
        id: "anywhere",
        pricePerTicketCents: 8000,
        groupSize: 4,
        tierPreference: { type: "any" },
      }),
      makeOffer({
        id: "rear-specific",
        pricePerTicketCents: 5000,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "rear" },
      }),
    ];

    const result = allocate(makeVenue(rows), offers, baseConfig);

    expect(result.unplaced).toEqual([]);
    expect(result.stats.placedOffers).toBe(4);
    expect(result.stats.placedSeats).toBe(4 + 3 + 4 + 4); // 15
    const totalAvailable = 4 + 8 + 6; // 18
    expect(result.stats.fillRate).toBeCloseTo(15 / totalAvailable, 5);

    // The accounting property holds.
    expect(
      result.stats.placedSeats +
        result.stats.orphanSeats +
        result.stats.unfilledSeats,
    ).toBe(totalAvailable);

    // wants-premium-flex got placed via waterfall.
    const waterfalled = result.decisions.filter(
      (d) => d.action === "WATERFALLED",
    );
    expect(waterfalled.map((d) => d.offerId)).toContain("wants-premium-flex");
  });
});
