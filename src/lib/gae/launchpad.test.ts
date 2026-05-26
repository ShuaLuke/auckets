import { describe, expect, it } from "vitest";

import { launchPad } from "./launchpad";
import { computeRankKey } from "./rankkey";
import type {
  RankedOffer,
  TierPreference,
  VenueArchitecture,
  VenueRow,
} from "./types";

type RowSpec = {
  id: string;
  rowRank: number;
  capacity: number;
  holds?: string[];
  tier?: string;
  isGa?: boolean;
  seatNumbers?: string[];
  lean?: VenueRow["lean"];
};

function makeRow(spec: RowSpec): VenueRow {
  const seatNumbers =
    spec.seatNumbers ??
    Array.from({ length: spec.capacity }, (_, i) => String(i + 1));
  return {
    id: spec.id,
    area: "orchestra",
    section: "center",
    rowName: spec.id,
    rowRank: spec.rowRank,
    capacity: spec.capacity,
    parity: "ODD",
    lean: spec.lean ?? "CENTER",
    seatNumbers,
    holds: spec.holds ?? [],
    ...(spec.tier !== undefined && { tier: spec.tier }),
    ...(spec.isGa !== undefined && { isGa: spec.isGa }),
  };
}

function makeVenue(rows: VenueRow[], activeRowIds?: string[]): VenueArchitecture {
  return {
    venueId: "venue-1",
    rows,
    activeRowIds: activeRowIds ?? rows.map((r) => r.id),
  };
}

type OfferSpec = {
  id: string;
  pricePerTicketCents: number;
  groupSize: number;
  tierPreference?: TierPreference;
  submittedAt?: Date;
};

function makeOffer(spec: OfferSpec): RankedOffer {
  return {
    id: spec.id,
    userId: `user-${spec.id}`,
    showId: "show-1",
    groupSize: spec.groupSize,
    pricePerTicketCents: spec.pricePerTicketCents,
    rankKey: computeRankKey(spec.pricePerTicketCents, spec.groupSize),
    submittedAt: spec.submittedAt ?? new Date("2026-01-01T00:00:00Z"),
    tierPreference: spec.tierPreference ?? { type: "any" },
  };
}

describe("launchPad — clean cases", () => {
  it("places offers totaling exactly capacity with zero orphans", () => {
    const row = makeRow({ id: "row-1", rowRank: 1, capacity: 14 });
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 5000, groupSize: 6 }),
      makeOffer({ id: "B", pricePerTicketCents: 4900, groupSize: 4 }),
      makeOffer({ id: "C", pricePerTicketCents: 4800, groupSize: 4 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    expect(result.assignments).toHaveLength(14);
    expect(result.remainingOffers).toEqual([]);
    expect(
      result.decisions.filter((d) => d.action === "PLACED"),
    ).toHaveLength(3);
    expect(
      result.decisions.filter((d) => d.action === "ORPHAN_DETECTED"),
    ).toHaveLength(0);
  });

  it("places offers in strict rank order across multiple rows", () => {
    const rows = [
      makeRow({ id: "row-A", rowRank: 1, capacity: 4 }),
      makeRow({ id: "row-B", rowRank: 2, capacity: 4 }),
    ];
    const offers = [
      makeOffer({ id: "high", pricePerTicketCents: 9000, groupSize: 4 }),
      makeOffer({ id: "low", pricePerTicketCents: 3000, groupSize: 4 }),
    ];

    const result = launchPad(makeVenue(rows), offers);

    // Best row (rowRank=1) gets the best offer.
    const inRowA = result.assignments
      .filter((a) => a.venueRowId === "row-A")
      .map((a) => a.offerId);
    const inRowB = result.assignments
      .filter((a) => a.venueRowId === "row-B")
      .map((a) => a.offerId);
    expect(new Set(inRowA)).toEqual(new Set(["high"]));
    expect(new Set(inRowB)).toEqual(new Set(["low"]));
  });
});

describe("launchPad — capacity edge cases", () => {
  it("emits ORPHAN_DETECTED when offers underfill the row", () => {
    const row = makeRow({ id: "row-1", rowRank: 1, capacity: 14 });
    // Three offers summing to 10; 4 seats left unfilled.
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 5000, groupSize: 4 }),
      makeOffer({ id: "B", pricePerTicketCents: 4900, groupSize: 4 }),
      makeOffer({ id: "C", pricePerTicketCents: 4800, groupSize: 2 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    expect(result.assignments).toHaveLength(10);
    const orphan = result.decisions.find((d) => d.action === "ORPHAN_DETECTED");
    expect(orphan).toBeDefined();
    expect(orphan?.snapshot["orphanCount"]).toBe(4);
  });

  it("oversubscribed: places rank-best until greedy stops, defers the rest", () => {
    const row = makeRow({ id: "row-1", rowRank: 1, capacity: 14 });
    // [6, 4, 4, 6] in rank order. Greedy: 6 + 4 + 4 = 14, the trailing
    // 6 is deferred. Total of 20 seats requested, 14 capacity.
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 5000, groupSize: 6 }),
      makeOffer({ id: "B", pricePerTicketCents: 4900, groupSize: 4 }),
      makeOffer({ id: "C", pricePerTicketCents: 4800, groupSize: 4 }),
      makeOffer({ id: "D", pricePerTicketCents: 4700, groupSize: 6 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    expect(result.assignments).toHaveLength(14);
    expect(result.remainingOffers.map((o) => o.id)).toEqual(["D"]);
  });

  it("skip-and-defer: greedy stops at first non-fit; offer waits for next row", () => {
    // Spec docstring (GAE_SPEC.md §Tests launchpad) writes this case as
    // [6, 6, 4] which is unreachable under pure greedy — the correct
    // form for the described outcome is [6, 4, 6] in rank order. PR
    // body flags this as a spec typo to clean up later.
    const rows = [
      makeRow({ id: "row-1", rowRank: 1, capacity: 14 }),
      makeRow({ id: "row-2", rowRank: 2, capacity: 8 }),
    ];
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 5000, groupSize: 6 }),
      makeOffer({ id: "B", pricePerTicketCents: 4900, groupSize: 4 }),
      makeOffer({ id: "C", pricePerTicketCents: 4800, groupSize: 6 }),
    ];

    const result = launchPad(makeVenue(rows), offers);

    const inRow1 = new Set(
      result.assignments
        .filter((a) => a.venueRowId === "row-1")
        .map((a) => a.offerId),
    );
    const inRow2 = new Set(
      result.assignments
        .filter((a) => a.venueRowId === "row-2")
        .map((a) => a.offerId),
    );
    expect(inRow1).toEqual(new Set(["A", "B"]));
    expect(inRow2).toEqual(new Set(["C"]));
    expect(result.remainingOffers).toEqual([]);
  });
});

describe("launchPad — holds and runs", () => {
  it("respects contiguous runs: a group larger than the longest run skips, FitResolver picks up the next compatible smaller fit", () => {
    // Row of 10 with holds at seats '5' and '6' → runs of length 4 + 4.
    const row = makeRow({
      id: "row-1",
      rowRank: 1,
      capacity: 10,
      holds: ["5", "6"],
    });
    const offers = [
      // Group of 5 won't fit in either 4-seat run — direct placement misses.
      makeOffer({ id: "too-big", pricePerTicketCents: 9000, groupSize: 5 }),
      // FitResolver should reach this one and place it in the first run.
      makeOffer({ id: "would-fit", pricePerTicketCents: 4000, groupSize: 3 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    expect(result.assignments.map((a) => a.offerId)).toEqual([
      "would-fit",
      "would-fit",
      "would-fit",
    ]);
    const fitResolved = result.decisions.find(
      (d) => d.action === "FIT_RESOLVED",
    );
    expect(fitResolved?.offerId).toBe("would-fit");
    expect(fitResolved?.snapshot["skippedOfferIds"]).toEqual(["too-big"]);
    // The larger offer stays in the pool for the next row.
    expect(result.remainingOffers.map((o) => o.id)).toEqual(["too-big"]);
  });

  it("places groups inside their fitting run when multiple runs exist", () => {
    const row = makeRow({
      id: "row-1",
      rowRank: 1,
      capacity: 10,
      holds: ["5", "6"],
    });
    const offers = [
      // Fits in either run; placed in the first (positions 0..3).
      makeOffer({ id: "A", pricePerTicketCents: 9000, groupSize: 4 }),
      // First run now exhausted; B fits the second run (positions 6..9).
      makeOffer({ id: "B", pricePerTicketCents: 4000, groupSize: 4 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    const aSeats = result.assignments
      .filter((s) => s.offerId === "A")
      .map((s) => s.seatNumber);
    const bSeats = result.assignments
      .filter((s) => s.offerId === "B")
      .map((s) => s.seatNumber);
    expect(aSeats).toEqual(["1", "2", "3", "4"]);
    expect(bSeats).toEqual(["7", "8", "9", "10"]);
  });
});

describe("launchPad — FitResolver integration", () => {
  it("defers a too-big leader and fills the row from smaller offers behind it", () => {
    // 14-seat row. Pool: [16, 6, 4] in rank order.
    // Greedy alone would have stopped at 16. With FitResolver, the 16
    // is deferred and the row fills cleanly with 6 + 4 (10 of 14 used).
    const row = makeRow({ id: "row-1", rowRank: 1, capacity: 14 });
    const offers = [
      makeOffer({ id: "leader-too-big", pricePerTicketCents: 9000, groupSize: 16 }),
      makeOffer({ id: "fits-1", pricePerTicketCents: 4000, groupSize: 6 }),
      makeOffer({ id: "fits-2", pricePerTicketCents: 3000, groupSize: 4 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    expect(result.assignments).toHaveLength(10);
    expect(result.remainingOffers.map((o) => o.id)).toEqual([
      "leader-too-big",
    ]);
    const fitResolved = result.decisions.find(
      (d) => d.action === "FIT_RESOLVED",
    );
    expect(fitResolved?.offerId).toBe("fits-1");
    expect(fitResolved?.snapshot["skippedOfferIds"]).toEqual([
      "leader-too-big",
    ]);
  });

  it("fires FitResolver multiple times in one row when each fit triggers another non-fit", () => {
    // 14-seat row, pool: [16, 6, 4, 8, 2].
    //  - 16 misses → scan: 6 fits. Place 6. Run = 8. FIT_RESOLVED ([16]).
    //  - 4 fits directly. Place 4. Run = 4. PLACED.
    //  - 8 misses → scan: 2 fits. Place 2. Run = 2. FIT_RESOLVED ([8]).
    //  - End of pool. Orphan = 2.
    const row = makeRow({ id: "row-1", rowRank: 1, capacity: 14 });
    const offers = [
      makeOffer({ id: "big-leader", pricePerTicketCents: 9000, groupSize: 16 }),
      makeOffer({ id: "med-1", pricePerTicketCents: 8000, groupSize: 6 }),
      makeOffer({ id: "small-1", pricePerTicketCents: 7000, groupSize: 4 }),
      makeOffer({ id: "big-mid", pricePerTicketCents: 6000, groupSize: 8 }),
      makeOffer({ id: "small-2", pricePerTicketCents: 5000, groupSize: 2 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    const fitResolved = result.decisions.filter(
      (d) => d.action === "FIT_RESOLVED",
    );
    expect(fitResolved.map((d) => d.offerId)).toEqual(["med-1", "small-2"]);
    expect(fitResolved[0]?.snapshot["skippedOfferIds"]).toEqual(["big-leader"]);
    expect(fitResolved[1]?.snapshot["skippedOfferIds"]).toEqual(["big-mid"]);
    expect(result.assignments).toHaveLength(12);
    expect(result.remainingOffers.map((o) => o.id).sort()).toEqual([
      "big-leader",
      "big-mid",
    ]);
  });

  it("does not retry skipped offers in the same row even when later runs would fit", () => {
    // Row with two equal runs of 4 (capacity 10 minus holds at 5,6).
    // Pool: [5 (won't fit), 3 (fits), 4 (would fit second run)].
    // After placing 3 via FitResolver, run 1 has 1 seat left and run 2
    // has 4 seats. The 5 is NOT retried (proved-impossible this row),
    // but the loop advances past the placed 3 and tries the 4 — which
    // fits run 2. So we expect 3 + 4 placed, 5 deferred.
    const row = makeRow({
      id: "row-1",
      rowRank: 1,
      capacity: 10,
      holds: ["5", "6"],
    });
    const offers = [
      makeOffer({ id: "too-big", pricePerTicketCents: 9000, groupSize: 5 }),
      makeOffer({ id: "fits-first", pricePerTicketCents: 8000, groupSize: 3 }),
      makeOffer({ id: "fits-second", pricePerTicketCents: 7000, groupSize: 4 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    expect(result.assignments).toHaveLength(7);
    const placedIds = new Set(result.assignments.map((a) => a.offerId));
    expect(placedIds).toEqual(new Set(["fits-first", "fits-second"]));
    expect(result.remainingOffers.map((o) => o.id)).toEqual(["too-big"]);
  });

  it("a deferred offer survives to be placed in a later row that does fit it", () => {
    // Pool: [10, 4]. Row 1 capacity 8 (10 won't fit, 4 does via FitResolver).
    // Row 2 capacity 12 (10 fits directly).
    const rows = [
      makeRow({ id: "row-1", rowRank: 1, capacity: 8 }),
      makeRow({
        id: "row-2",
        rowRank: 2,
        capacity: 12,
        seatNumbers: Array.from({ length: 12 }, (_, i) => `R2-${i + 1}`),
      }),
    ];
    const offers = [
      makeOffer({ id: "big", pricePerTicketCents: 9000, groupSize: 10 }),
      makeOffer({ id: "small", pricePerTicketCents: 4000, groupSize: 4 }),
    ];

    const result = launchPad(makeVenue(rows), offers);

    const row1Placed = result.assignments
      .filter((a) => a.venueRowId === "row-1")
      .map((a) => a.offerId);
    const row2Placed = result.assignments
      .filter((a) => a.venueRowId === "row-2")
      .map((a) => a.offerId);
    expect(new Set(row1Placed)).toEqual(new Set(["small"]));
    expect(new Set(row2Placed)).toEqual(new Set(["big"]));
    expect(result.remainingOffers).toEqual([]);
  });
});

describe("launchPad — tier filtering", () => {
  it("'specific' offers only place in rows of the matching tier", () => {
    const rows = [
      makeRow({ id: "premium", rowRank: 1, capacity: 4, tier: "premium" }),
      makeRow({ id: "general", rowRank: 2, capacity: 4, tier: "general" }),
    ];
    const offers = [
      makeOffer({
        id: "general-only",
        pricePerTicketCents: 9000, // Best rank, but locked to general tier.
        groupSize: 4,
        tierPreference: { type: "specific", tier: "general" },
      }),
      makeOffer({
        id: "anywhere",
        pricePerTicketCents: 3000,
        groupSize: 4,
        tierPreference: { type: "any" },
      }),
    ];

    const result = launchPad(makeVenue(rows), offers);

    // 'general-only' skips the premium row even though it ranks higher.
    // 'anywhere' fills premium; 'general-only' fills general.
    const premiumOccupant = result.assignments.find(
      (s) => s.venueRowId === "premium",
    )?.offerId;
    const generalOccupant = result.assignments.find(
      (s) => s.venueRowId === "general",
    )?.offerId;
    expect(premiumOccupant).toBe("anywhere");
    expect(generalOccupant).toBe("general-only");
    expect(result.remainingOffers).toEqual([]);
  });

  it("treats this_or_worse / this_or_better as exact-tier-only in the first pass", () => {
    // Slice 11 does not cross-tier waterfall; that's the waterfall slice.
    const rows = [makeRow({ id: "rear", rowRank: 1, capacity: 4, tier: "rear" })];
    const offers = [
      makeOffer({
        id: "wants-premium-or-down",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "this_or_worse", tier: "premium" },
      }),
    ];

    const result = launchPad(makeVenue(rows), offers);

    // In a full pipeline this offer would waterfall down to 'rear'. In
    // LaunchPad's first pass, it stays put — waterfall is a separate
    // module.
    expect(result.assignments).toEqual([]);
    expect(result.remainingOffers).toHaveLength(1);
  });
});

describe("launchPad — GA rows", () => {
  it("fills a GA row sequentially using its synthetic seat numbers", () => {
    const row = makeRow({
      id: "ga",
      rowRank: 1,
      capacity: 5,
      isGa: true,
      seatNumbers: ["GA-1", "GA-2", "GA-3", "GA-4", "GA-5"],
    });
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 5000, groupSize: 3 }),
      makeOffer({ id: "B", pricePerTicketCents: 4000, groupSize: 2 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    expect(result.assignments.map((s) => s.seatNumber)).toEqual([
      "GA-1",
      "GA-2",
      "GA-3",
      "GA-4",
      "GA-5",
    ]);
  });
});

describe("launchPad — empty and degenerate inputs", () => {
  it("returns an empty result when there are no offers", () => {
    const venue = makeVenue([
      makeRow({ id: "row-1", rowRank: 1, capacity: 4 }),
    ]);
    const result = launchPad(venue, []);
    expect(result.assignments).toEqual([]);
    expect(result.remainingOffers).toEqual([]);
    // Empty row still produces a SKIPPED decision.
    expect(result.decisions.every((d) => d.action === "SKIPPED")).toBe(true);
  });

  it("returns all offers in remainingOffers when no rows are active", () => {
    const venue = makeVenue(
      [makeRow({ id: "row-1", rowRank: 1, capacity: 4 })],
      [], // No active rows.
    );
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 5000, groupSize: 2 }),
    ];
    const result = launchPad(venue, offers);
    expect(result.assignments).toEqual([]);
    expect(result.remainingOffers.map((o) => o.id)).toEqual(["A"]);
    expect(result.decisions).toEqual([]);
  });

  it("skips rows whose seats are entirely held without emitting a decision", () => {
    const row = makeRow({
      id: "row-held",
      rowRank: 1,
      capacity: 3,
      holds: ["1", "2", "3"],
    });
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 5000, groupSize: 2 }),
    ];
    const result = launchPad(makeVenue([row]), offers);
    expect(result.assignments).toEqual([]);
    expect(result.decisions).toEqual([]);
    expect(result.remainingOffers.map((o) => o.id)).toEqual(["A"]);
  });

  it("does not mutate the input offers array", () => {
    const offers = [
      makeOffer({ id: "B", pricePerTicketCents: 3000, groupSize: 2 }),
      makeOffer({ id: "A", pricePerTicketCents: 5000, groupSize: 2 }),
    ];
    const snapshot = offers.map((o) => o.id);
    const row = makeRow({ id: "row-1", rowRank: 1, capacity: 4 });
    launchPad(makeVenue([row]), offers);
    expect(offers.map((o) => o.id)).toEqual(snapshot);
  });
});

describe("launchPad — lean-aware placement", () => {
  it("CENTER puts the best-ranked group in the middle of the cluster", () => {
    // Three equal groups of 4 fill a 12-seat row exactly. CENTER layout
    // left-to-right: [rank-1, rank-0, rank-2].
    const row = makeRow({ id: "row-1", rowRank: 1, capacity: 12, lean: "CENTER" });
    const offers = [
      makeOffer({ id: "best", pricePerTicketCents: 9000, groupSize: 4 }),
      makeOffer({ id: "mid", pricePerTicketCents: 8000, groupSize: 4 }),
      makeOffer({ id: "low", pricePerTicketCents: 7000, groupSize: 4 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    const seatsOf = (id: string) =>
      result.assignments
        .filter((a) => a.offerId === id)
        .map((a) => a.seatNumber);
    expect(seatsOf("mid")).toEqual(["1", "2", "3", "4"]);
    expect(seatsOf("best")).toEqual(["5", "6", "7", "8"]);
    expect(seatsOf("low")).toEqual(["9", "10", "11", "12"]);
  });

  it("RIGHT puts the best-ranked group at the rightmost run-tail", () => {
    const row = makeRow({ id: "row-1", rowRank: 1, capacity: 8, lean: "RIGHT" });
    const offers = [
      makeOffer({ id: "best", pricePerTicketCents: 9000, groupSize: 3 }),
      makeOffer({ id: "low", pricePerTicketCents: 3000, groupSize: 2 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    const seatsOf = (id: string) =>
      result.assignments
        .filter((a) => a.offerId === id)
        .map((a) => a.seatNumber);
    expect(seatsOf("best")).toEqual(["6", "7", "8"]);
    expect(seatsOf("low")).toEqual(["4", "5"]);
  });

  it("DUAL_AISLE places best at left aisle, second at right aisle", () => {
    const row = makeRow({
      id: "row-1",
      rowRank: 1,
      capacity: 12,
      lean: "DUAL_AISLE",
    });
    const offers = [
      makeOffer({ id: "best", pricePerTicketCents: 9000, groupSize: 3 }),
      makeOffer({ id: "second", pricePerTicketCents: 8000, groupSize: 3 }),
      makeOffer({ id: "third", pricePerTicketCents: 7000, groupSize: 3 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    const seatsOf = (id: string) =>
      result.assignments
        .filter((a) => a.offerId === id)
        .map((a) => a.seatNumber);
    expect(seatsOf("best")).toEqual(["1", "2", "3"]);
    expect(seatsOf("second")).toEqual(["10", "11", "12"]);
    expect(seatsOf("third")).toEqual(["4", "5", "6"]);
  });

  it("GA rows ignore lean and assign next-available regardless of row.lean", () => {
    // Same row as the DUAL_AISLE test above, but isGa: true → LEFT semantics.
    const row = makeRow({
      id: "ga",
      rowRank: 1,
      capacity: 9,
      isGa: true,
      lean: "DUAL_AISLE",
      seatNumbers: Array.from({ length: 9 }, (_, i) => `GA-${i + 1}`),
    });
    const offers = [
      makeOffer({ id: "best", pricePerTicketCents: 9000, groupSize: 3 }),
      makeOffer({ id: "second", pricePerTicketCents: 8000, groupSize: 3 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    const seatsOf = (id: string) =>
      result.assignments
        .filter((a) => a.offerId === id)
        .map((a) => a.seatNumber);
    expect(seatsOf("best")).toEqual(["GA-1", "GA-2", "GA-3"]);
    expect(seatsOf("second")).toEqual(["GA-4", "GA-5", "GA-6"]);
  });

  it("CENTER centers the cluster within an under-filled row", () => {
    // Single group of 6 in a 10-seat row → padding of 2 on each side.
    const row = makeRow({ id: "row-1", rowRank: 1, capacity: 10, lean: "CENTER" });
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 9000, groupSize: 6 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    expect(result.assignments.map((a) => a.seatNumber)).toEqual([
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
  });

  it("lean is applied per run when holds split the row", () => {
    // Row of 10 with holds at seats 5 and 6 → two CENTER-lean runs of 4.
    // Each run gets its own single group of 4 → fills the run exactly.
    const row = makeRow({
      id: "row-1",
      rowRank: 1,
      capacity: 10,
      holds: ["5", "6"],
      lean: "CENTER",
    });
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 9000, groupSize: 4 }),
      makeOffer({ id: "B", pricePerTicketCents: 8000, groupSize: 4 }),
    ];

    const result = launchPad(makeVenue([row]), offers);

    const seatsOf = (id: string) =>
      result.assignments
        .filter((a) => a.offerId === id)
        .map((a) => a.seatNumber);
    expect(seatsOf("A")).toEqual(["1", "2", "3", "4"]);
    expect(seatsOf("B")).toEqual(["7", "8", "9", "10"]);
  });
});
