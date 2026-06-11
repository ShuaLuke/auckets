import { describe, expect, it } from "vitest";

import { launchPad } from "./launchpad";
import { computeRankKey } from "./rankkey";
import type {
  RankedOffer,
  TierPreference,
  VenueArchitecture,
  VenueRow,
} from "./types";
import { waterfall } from "./waterfall";

type RowSpec = {
  id: string;
  rowRank: number;
  capacity: number;
  tier?: string;
  holds?: string[];
  isGa?: boolean;
  seatNumbers?: string[];
  lean?: VenueRow["lean"];
};

function makeRow(spec: RowSpec): VenueRow {
  const seatNumbers =
    spec.seatNumbers ??
    Array.from({ length: spec.capacity }, (_, i) => `${spec.id}-${i + 1}`);
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
  tierPreference: TierPreference;
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
    tierPreference: spec.tierPreference,
  };
}

// Common helper: run launchPad and waterfall in sequence, return the
// combined result so tests can assert on end-to-end behavior easily.
function runFull(
  venue: VenueArchitecture,
  offers: RankedOffer[],
): {
  assignments: ReturnType<typeof launchPad>["assignments"];
  decisions: ReturnType<typeof launchPad>["decisions"];
  unplaced: ReturnType<typeof waterfall>["unplaced"];
} {
  const phase1 = launchPad(venue, offers);
  const phase2 = waterfall(venue, phase1.remainingOffers, phase1.assignments);
  return {
    assignments: [...phase1.assignments, ...phase2.assignments],
    decisions: [...phase1.decisions, ...phase2.decisions],
    unplaced: phase2.unplaced,
  };
}

describe("waterfall — this_or_worse cascading", () => {
  it("places a this_or_worse offer in a lower tier when its preferred tier is full", () => {
    const rows = [
      makeRow({ id: "premium-1", rowRank: 1, capacity: 4, tier: "premium" }),
      makeRow({ id: "mid-1", rowRank: 5, capacity: 4, tier: "mid" }),
    ];
    const offers = [
      // Strict-premium fills the premium row.
      makeOffer({
        id: "fills-premium",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "premium" },
      }),
      // Wants premium-or-down. After LaunchPad: premium full, so
      // unplaced; should waterfall down to mid.
      makeOffer({
        id: "flexible-premium-fan",
        pricePerTicketCents: 8000,
        groupSize: 4,
        tierPreference: { type: "this_or_worse", tier: "premium" },
      }),
    ];

    const result = runFull(makeVenue(rows), offers);

    expect(result.unplaced).toEqual([]);
    const waterfalled = result.decisions.find(
      (d) => d.action === "WATERFALLED",
    );
    expect(waterfalled?.offerId).toBe("flexible-premium-fan");
    expect(waterfalled?.snapshot["preferredTier"]).toBe("premium");
    expect(waterfalled?.snapshot["placedTier"]).toBe("mid");
    expect(waterfalled?.snapshot["tierDistance"]).toBe(1);
    expect(waterfalled?.snapshot["originalAction"]).toBe("PLACED");
    const flexibleSeats = result.assignments
      .filter((a) => a.offerId === "flexible-premium-fan")
      .map((a) => a.venueRowId);
    expect(flexibleSeats.every((r) => r === "mid-1")).toBe(true);
  });

  it("does not waterfall a specific-tier offer even when other tiers have space", () => {
    const rows = [
      makeRow({ id: "premium-1", rowRank: 1, capacity: 4, tier: "premium" }),
      makeRow({ id: "mid-1", rowRank: 5, capacity: 8, tier: "mid" }),
    ];
    const offers = [
      makeOffer({
        id: "fills-premium",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "premium" },
      }),
      makeOffer({
        id: "strict-premium-fan",
        pricePerTicketCents: 8000,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "premium" },
      }),
    ];

    const result = runFull(makeVenue(rows), offers);

    expect(
      result.decisions.filter((d) => d.action === "WATERFALLED"),
    ).toHaveLength(0);
    expect(result.unplaced.map((u) => u.offerId)).toEqual([
      "strict-premium-fan",
    ]);
    expect(result.unplaced[0]?.reason).toBe("no_fit_anywhere");
  });
});

describe("waterfall — this_or_better cascading", () => {
  it("places a this_or_better offer in a higher tier when its preferred tier is full", () => {
    const rows = [
      makeRow({ id: "premium-1", rowRank: 1, capacity: 4, tier: "premium" }),
      makeRow({ id: "mid-1", rowRank: 5, capacity: 4, tier: "mid" }),
    ];
    const offers = [
      // Fills mid (the preferred tier of the flexible offer).
      makeOffer({
        id: "fills-mid",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "mid" },
      }),
      // Wants mid-or-better. After LaunchPad: mid full. Should waterfall
      // UP to premium.
      makeOffer({
        id: "wants-mid-or-up",
        pricePerTicketCents: 8000,
        groupSize: 4,
        tierPreference: { type: "this_or_better", tier: "mid" },
      }),
    ];

    const result = runFull(makeVenue(rows), offers);

    expect(result.unplaced).toEqual([]);
    const waterfalled = result.decisions.find(
      (d) => d.action === "WATERFALLED",
    );
    expect(waterfalled?.offerId).toBe("wants-mid-or-up");
    expect(waterfalled?.snapshot["preferredTier"]).toBe("mid");
    expect(waterfalled?.snapshot["placedTier"]).toBe("premium");
  });
});

describe("waterfall — `any` is not relabeled", () => {
  it("does not waterfall offers with tierPreference 'any' (LaunchPad already placed them)", () => {
    const rows = [
      makeRow({ id: "premium-1", rowRank: 1, capacity: 4, tier: "premium" }),
      makeRow({ id: "mid-1", rowRank: 5, capacity: 4, tier: "mid" }),
    ];
    const offers = [
      makeOffer({
        id: "anywhere",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "any" },
      }),
    ];

    const result = runFull(makeVenue(rows), offers);

    expect(
      result.decisions.filter((d) => d.action === "WATERFALLED"),
    ).toHaveLength(0);
    expect(
      result.decisions.find((d) => d.action === "PLACED")?.offerId,
    ).toBe("anywhere");
  });

  it("when an `any` offer doesn't fit in LaunchPad either, it lands in unplaced with no_fit_anywhere", () => {
    const rows = [
      makeRow({ id: "tiny", rowRank: 1, capacity: 2, tier: "mid" }),
    ];
    const offers = [
      makeOffer({
        id: "too-big",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "any" },
      }),
    ];

    const result = runFull(makeVenue(rows), offers);

    expect(result.assignments).toEqual([]);
    expect(result.unplaced).toEqual([
      { offerId: "too-big", reason: "no_fit_anywhere" },
    ]);
  });
});

describe("waterfall — multi-tier cascade", () => {
  it("cascades a this_or_worse offer past a full intermediate tier to the next available one", () => {
    const rows = [
      makeRow({ id: "premium-1", rowRank: 1, capacity: 4, tier: "premium" }),
      makeRow({ id: "mid-1", rowRank: 5, capacity: 4, tier: "mid" }),
      makeRow({ id: "rear-1", rowRank: 10, capacity: 4, tier: "rear" }),
    ];
    const offers = [
      // Fill premium and mid via strict-tier offers.
      makeOffer({
        id: "fills-premium",
        pricePerTicketCents: 9500,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "premium" },
      }),
      makeOffer({
        id: "fills-mid",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "mid" },
      }),
      // This one prefers premium but is happy with anything from premium
      // down. Premium is full; mid is full; should land in rear (3 tier
      // levels below preferred).
      makeOffer({
        id: "cascades",
        pricePerTicketCents: 8000,
        groupSize: 4,
        tierPreference: { type: "this_or_worse", tier: "premium" },
      }),
    ];

    const result = runFull(makeVenue(rows), offers);

    const waterfalled = result.decisions.find(
      (d) => d.action === "WATERFALLED",
    );
    expect(waterfalled?.offerId).toBe("cascades");
    expect(waterfalled?.snapshot["preferredTier"]).toBe("premium");
    expect(waterfalled?.snapshot["placedTier"]).toBe("rear");
    expect(waterfalled?.snapshot["tierDistance"]).toBe(2);
    expect(result.unplaced).toEqual([]);
  });
});

describe("waterfall — stop condition", () => {
  it("halts immediately when there are no unplaced offers", () => {
    const venue = makeVenue([
      makeRow({ id: "row-1", rowRank: 1, capacity: 4 }),
    ]);
    // Empty unplaced → waterfall is a no-op.
    const result = waterfall(venue, [], []);
    expect(result.assignments).toEqual([]);
    expect(result.decisions).toEqual([]);
    expect(result.unplaced).toEqual([]);
  });

  it("emits an unplaced reason when no relaxation can place an offer", () => {
    // Single premium row already full; this_or_worse premium fan has
    // nowhere to cascade.
    const rows = [
      makeRow({ id: "premium-1", rowRank: 1, capacity: 4, tier: "premium" }),
    ];
    const offers = [
      makeOffer({
        id: "fills-premium",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "premium" },
      }),
      makeOffer({
        id: "premium-fan-no-cascade",
        pricePerTicketCents: 8000,
        groupSize: 4,
        tierPreference: { type: "this_or_worse", tier: "premium" },
      }),
    ];

    const result = runFull(makeVenue(rows), offers);

    expect(result.unplaced.map((u) => u.offerId)).toEqual([
      "premium-fan-no-cascade",
    ]);
    expect(result.unplaced[0]?.reason).toBe("no_fit_anywhere");
  });

  it("marks an offer no_compatible_tier when its preferred tier doesn't exist on the venue", () => {
    // Venue has no 'premium' tier; the offer can't waterfall because
    // there's no anchor to expand from.
    const rows = [
      makeRow({ id: "mid-1", rowRank: 1, capacity: 4, tier: "mid" }),
    ];
    const offers = [
      makeOffer({
        id: "premium-only",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "premium" },
      }),
    ];

    const result = runFull(makeVenue(rows), offers);

    expect(result.unplaced.map((u) => u.offerId)).toEqual(["premium-only"]);
    expect(result.unplaced[0]?.reason).toBe("no_compatible_tier");
  });
});

describe("waterfall — already-placed seats become holds in subsequent passes", () => {
  it("does not double-assign a seat already taken by LaunchPad", () => {
    // mid-1 uses LEFT so mid-partial lands at positions 0,1 and leaves
    // a contiguous run of 4 at the back for the cascading offer. With
    // the default CENTER lean, mid-partial would split mid-1 into two
    // runs of 2 and the size-4 cascade would have nowhere to go —
    // worth testing separately, not here.
    const rows = [
      makeRow({ id: "premium-1", rowRank: 1, capacity: 4, tier: "premium" }),
      makeRow({
        id: "mid-1",
        rowRank: 5,
        capacity: 6,
        tier: "mid",
        lean: "LEFT",
      }),
    ];
    const offers = [
      // LaunchPad places this in mid (2 seats used).
      makeOffer({
        id: "mid-partial",
        pricePerTicketCents: 9000,
        groupSize: 2,
        tierPreference: { type: "specific", tier: "mid" },
      }),
      // Fills premium so we have something for waterfall to do.
      makeOffer({
        id: "fills-premium",
        pricePerTicketCents: 8500,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "premium" },
      }),
      // Wants premium-or-down. Premium full; should waterfall to mid,
      // taking the 4 remaining seats (NOT the 2 already held by
      // mid-partial).
      makeOffer({
        id: "cascades-to-mid",
        pricePerTicketCents: 8000,
        groupSize: 4,
        tierPreference: { type: "this_or_worse", tier: "premium" },
      }),
    ];

    const result = runFull(makeVenue(rows), offers);

    expect(result.unplaced).toEqual([]);
    // The two assignments in mid must not collide.
    const midSeats = result.assignments
      .filter((a) => a.venueRowId === "mid-1")
      .map((a) => a.seatNumber);
    expect(new Set(midSeats).size).toBe(midSeats.length); // no duplicates
    expect(midSeats).toHaveLength(6); // 2 mid-partial + 4 cascades-to-mid
  });
});

describe("waterfall — partial venue activation (activeRowIds, NEW-4)", () => {
  it("orders tiers by ACTIVE rows only: an inactive better-ranked row must not poison the tier ordering", () => {
    // Venue: gold has rows at rowRank 1 (INACTIVE this show) and
    // rowRank 10 (active); silver is active at rowRank 5. For THIS
    // show, the seating reality is silver (rank 5) above gold (rank 10).
    //
    // A this_or_worse:silver fan whose silver row fills must waterfall
    // into the active gold row — gold is "worse" in the active ordering.
    // The bug: building the tier index from ALL rows ranks gold above
    // silver via the inactive rank-1 row, so the matcher rejects the
    // gold row, the fan goes unplaced, and 4 free active gold seats sit
    // empty (lost revenue + a wrong "no seat" email).
    const rows = [
      makeRow({ id: "gold-inactive", rowRank: 1, capacity: 4, tier: "gold" }),
      makeRow({ id: "silver-1", rowRank: 5, capacity: 4, tier: "silver" }),
      makeRow({ id: "gold-active", rowRank: 10, capacity: 4, tier: "gold" }),
    ];
    const venue = makeVenue(rows, ["silver-1", "gold-active"]);
    const offers = [
      makeOffer({
        id: "fills-silver",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "silver" },
      }),
      makeOffer({
        id: "silver-or-worse",
        pricePerTicketCents: 8000,
        groupSize: 4,
        tierPreference: { type: "this_or_worse", tier: "silver" },
      }),
    ];

    const result = runFull(venue, offers);

    expect(result.unplaced).toEqual([]);
    const waterfalled = result.decisions.find(
      (d) => d.action === "WATERFALLED",
    );
    expect(waterfalled?.offerId).toBe("silver-or-worse");
    expect(waterfalled?.snapshot["preferredTier"]).toBe("silver");
    expect(waterfalled?.snapshot["placedTier"]).toBe("gold");
    const placedRows = result.assignments
      .filter((a) => a.offerId === "silver-or-worse")
      .map((a) => a.venueRowId);
    expect(placedRows).toHaveLength(4);
    expect(placedRows.every((r) => r === "gold-active")).toBe(true);
  });

  it("classifies a specific-tier offer as no_compatible_tier when that tier's rows exist but are all inactive", () => {
    // Spec §"Tier preferences with no compatible rows": no premium rows
    // *active in this show* → reason must be no_compatible_tier. The
    // bug: the all-rows tier index still contains 'premium', so the
    // offer was misclassified as no_fit_anywhere.
    const rows = [
      makeRow({ id: "premium-1", rowRank: 1, capacity: 4, tier: "premium" }),
      makeRow({ id: "mid-1", rowRank: 5, capacity: 4, tier: "mid" }),
    ];
    const venue = makeVenue(rows, ["mid-1"]);
    const offers = [
      makeOffer({
        id: "premium-only",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "premium" },
      }),
    ];

    const result = runFull(venue, offers);

    expect(result.assignments).toEqual([]);
    expect(result.unplaced).toEqual([
      { offerId: "premium-only", reason: "no_compatible_tier" },
    ]);
  });
});

describe("waterfall — tier ordering inference", () => {
  it("infers tier order from min rowRank per tier (lower = better)", () => {
    // premium spans rowRanks [3, 4], mid spans [1, 2]. Despite the
    // names, mid is "better" by row position. A this_or_worse mid offer
    // should waterfall DOWN to premium (the only tier with higher
    // rowRank).
    const rows = [
      makeRow({ id: "mid-1", rowRank: 1, capacity: 4, tier: "mid" }),
      makeRow({ id: "mid-2", rowRank: 2, capacity: 4, tier: "mid" }),
      makeRow({ id: "prem-1", rowRank: 3, capacity: 4, tier: "premium" }),
      makeRow({ id: "prem-2", rowRank: 4, capacity: 4, tier: "premium" }),
    ];
    const offers = [
      // Fill mid completely.
      makeOffer({
        id: "fills-mid-1",
        pricePerTicketCents: 9500,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "mid" },
      }),
      makeOffer({
        id: "fills-mid-2",
        pricePerTicketCents: 9000,
        groupSize: 4,
        tierPreference: { type: "specific", tier: "mid" },
      }),
      // Mid-preferring fan with this_or_worse. Should waterfall to
      // premium (which is "worse" by the inferred order).
      makeOffer({
        id: "mid-fan-cascade",
        pricePerTicketCents: 8000,
        groupSize: 4,
        tierPreference: { type: "this_or_worse", tier: "mid" },
      }),
    ];

    const result = runFull(makeVenue(rows), offers);

    const waterfalled = result.decisions.find(
      (d) => d.action === "WATERFALLED",
    );
    expect(waterfalled?.snapshot["placedTier"]).toBe("premium");
    expect(result.unplaced).toEqual([]);
  });
});
