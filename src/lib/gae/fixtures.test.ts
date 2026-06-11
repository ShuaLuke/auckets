// Integration-style fixtures for the GAE (spec §Tests "Integration
// tests (still in the GAE module, no DB)").
//
// These run the full public pipeline — allocate() = launchPad +
// waterfall + stats — against committed venue architectures and offer
// pools, and pin the COMPLETE expected output: every seat assignment,
// the decision-action sequence, the unplaced list, and the stats
// envelope. They are both regression protection and the canonical
// reference for "what does the GAE produce for X input".
//
// ── Changing these assertions is an act of explicit acknowledgment ──
// If an algorithm change moves a seat here, the spec requires the PR to
// say so out loud and explain why the new output is correct. Do not
// "fix the test to match" silently.
//
// Three scenarios, per the spec's list:
//
//   1. The Lincoln Theatre scenario — a proscenium house with
//      orchestra / front balcony / upper balcony areas mapped to
//      premium / mid / rear tiers, partial house holds, and an offer
//      pool exercising every preference type plus a waterfall. The real
//      Lincoln Theatre row data is still pending from Cope (see
//      docs/ROADMAP.md); this is the spec-shaped synthetic stand-in.
//      When the real data lands, add it as a second fixture — don't
//      replace this one, its numbers are hand-verified.
//
//   2. Cope's place — a 50-seat untraditional venue (cabaret tables, a
//      bench, GA standing) with a small offer pool. Exercises GA
//      bucket fill, a row no offer is compatible with (SKIPPED), and
//      heavy orphan/unfilled accounting at low demand.
//
//   3. A sectioned-off Austin theater — partial venue activation
//      (NEW-4) with mixed reserved + GA. Only some sections are active;
//      tier preferences cross the active/inactive boundary. This is the
//      fixture that pins the active-rows tier-index behavior: an
//      inactive box at rowRank 1 must not outrank the open sections,
//      and a tier whose rows are all inactive must classify as
//      no_compatible_tier.

import { describe, expect, it } from "vitest";

import { allocate } from "./index";
import { computeRankKey } from "./rankkey";
import type {
  AllocationConfig,
  AllocationResult,
  RankedOffer,
  TierPreference,
  VenueRow,
} from "./types";

const config: AllocationConfig = {
  mode: "preview",
  allowOrphans: true,
  maxGroupSize: 10,
  orphanPolicy: "leave",
};

type RowSpec = {
  id: string;
  area: VenueRow["area"];
  rowRank: number;
  capacity: number;
  tier: string;
  lean?: VenueRow["lean"];
  seatPrefix: string;
  holds?: string[];
  isGa?: boolean;
};

function makeRow(spec: RowSpec): VenueRow {
  return {
    id: spec.id,
    area: spec.area,
    section: "center",
    rowName: spec.id,
    rowRank: spec.rowRank,
    capacity: spec.capacity,
    parity: "ODD",
    lean: spec.lean ?? "CENTER",
    seatNumbers: Array.from(
      { length: spec.capacity },
      (_, i) => `${spec.seatPrefix}-${i + 1}`,
    ),
    holds: spec.holds ?? [],
    tier: spec.tier,
    ...(spec.isGa !== undefined && { isGa: spec.isGa }),
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

function seatsOf(result: AllocationResult, offerId: string): string[] {
  return result.assignments
    .filter((a) => a.offerId === offerId)
    .map((a) => a.seatNumber);
}

function rowsOf(result: AllocationResult, offerId: string): Set<string> {
  return new Set(
    result.assignments
      .filter((a) => a.offerId === offerId)
      .map((a) => a.venueRowId),
  );
}

describe("fixture 1 — the Lincoln Theatre scenario", () => {
  // Synthetic Lincoln-shaped architecture (real data pending from Cope):
  // two premium orchestra rows (one with house holds), two mid front-
  // balcony rows, one rear upper-balcony row. 57 sellable seats.
  const venueRows = [
    makeRow({
      id: "orch-AA",
      area: "orchestra",
      rowRank: 1,
      capacity: 12,
      tier: "premium",
      lean: "CENTER",
      seatPrefix: "AA",
    }),
    makeRow({
      id: "orch-BB",
      area: "orchestra",
      rowRank: 2,
      capacity: 12,
      tier: "premium",
      lean: "CENTER",
      seatPrefix: "BB",
      holds: ["BB-1", "BB-2"], // house holds: sound desk
    }),
    makeRow({
      id: "fbal-A",
      area: "front_balcony",
      rowRank: 3,
      capacity: 10,
      tier: "mid",
      lean: "DUAL_AISLE",
      seatPrefix: "FA",
    }),
    makeRow({
      id: "fbal-B",
      area: "front_balcony",
      rowRank: 4,
      capacity: 13,
      tier: "mid",
      lean: "LEFT",
      seatPrefix: "FB",
    }),
    makeRow({
      id: "ubal-A",
      area: "upper_balcony",
      rowRank: 5,
      capacity: 12,
      tier: "rear",
      lean: "CENTER",
      seatPrefix: "UA",
    }),
  ];
  const venue = {
    venueId: "lincoln-theatre",
    rows: venueRows,
    activeRowIds: venueRows.map((r) => r.id),
  };

  // Known offer pool, listed in rank order (price descending). Covers
  // all four preference types, a FitResolver deferral, and a waterfall.
  const offers = [
    makeOffer({
      id: "big-spender",
      pricePerTicketCents: 15000,
      groupSize: 4,
      tierPreference: { type: "specific", tier: "premium" },
    }),
    makeOffer({
      id: "premium-flex",
      pricePerTicketCents: 12000,
      groupSize: 6,
      tierPreference: { type: "this_or_worse", tier: "premium" },
    }),
    makeOffer({
      id: "anywhere-large",
      pricePerTicketCents: 10000,
      groupSize: 8,
      tierPreference: { type: "any" },
    }),
    makeOffer({
      id: "mid-pair",
      pricePerTicketCents: 9000,
      groupSize: 2,
      tierPreference: { type: "specific", tier: "mid" },
    }),
    makeOffer({
      id: "premium-pair",
      pricePerTicketCents: 8500,
      groupSize: 2,
      tierPreference: { type: "this_or_worse", tier: "premium" },
    }),
    makeOffer({
      id: "balcony-any",
      pricePerTicketCents: 8000,
      groupSize: 4,
      tierPreference: { type: "this_or_better", tier: "rear" },
    }),
    makeOffer({
      id: "mid-flex",
      pricePerTicketCents: 7500,
      groupSize: 4,
      tierPreference: { type: "this_or_worse", tier: "mid" },
    }),
    makeOffer({
      id: "rear-fan",
      pricePerTicketCents: 6000,
      groupSize: 5,
      tierPreference: { type: "specific", tier: "rear" },
    }),
    makeOffer({
      id: "any-trio",
      pricePerTicketCents: 5500,
      groupSize: 3,
      tierPreference: { type: "any" },
    }),
    makeOffer({
      id: "big-group",
      pricePerTicketCents: 5000,
      groupSize: 10,
      tierPreference: { type: "any" },
    }),
    makeOffer({
      id: "late-premium-trio",
      pricePerTicketCents: 4500,
      groupSize: 3,
      tierPreference: { type: "this_or_worse", tier: "premium" },
    }),
  ];

  it("places every offer and pins the full seat map", () => {
    const result = allocate(venue, offers, config);

    expect(result.unplaced).toEqual([]);

    // orch-AA (CENTER): big-spender(4) center-most, premium-flex(6) to
    // its left, premium-pair(2) — FIT_RESOLVED past the 8-seat
    // anywhere-large that no longer fit — to its right. Filled exactly.
    expect(seatsOf(result, "premium-flex")).toEqual([
      "AA-1",
      "AA-2",
      "AA-3",
      "AA-4",
      "AA-5",
      "AA-6",
    ]);
    expect(seatsOf(result, "big-spender")).toEqual([
      "AA-7",
      "AA-8",
      "AA-9",
      "AA-10",
    ]);
    expect(seatsOf(result, "premium-pair")).toEqual(["AA-11", "AA-12"]);

    // orch-BB (CENTER, BB-1/BB-2 held → run BB-3..BB-12): the 8-strong
    // anywhere-large is centered in the 10-seat run; BB-3 and BB-12
    // are orphans.
    expect(seatsOf(result, "anywhere-large")).toEqual([
      "BB-4",
      "BB-5",
      "BB-6",
      "BB-7",
      "BB-8",
      "BB-9",
      "BB-10",
      "BB-11",
    ]);

    // fbal-A (DUAL_AISLE): mid-pair takes the left aisle, mid-flex the
    // right aisle, any-trio next-from-left. FA-6 is an orphan.
    expect(seatsOf(result, "mid-pair")).toEqual(["FA-1", "FA-2"]);
    expect(seatsOf(result, "mid-flex")).toEqual([
      "FA-7",
      "FA-8",
      "FA-9",
      "FA-10",
    ]);
    expect(seatsOf(result, "any-trio")).toEqual(["FA-3", "FA-4", "FA-5"]);

    // fbal-B (LEFT): big-group fills from the left; FB-11..FB-13 stay
    // free after the first pass — exactly the contiguous run the
    // waterfalled offer needs.
    expect(seatsOf(result, "big-group")).toEqual([
      "FB-1",
      "FB-2",
      "FB-3",
      "FB-4",
      "FB-5",
      "FB-6",
      "FB-7",
      "FB-8",
      "FB-9",
      "FB-10",
    ]);

    // ubal-A (CENTER): rear-fan(5) and balcony-any(4) cluster centered;
    // UA-1, UA-11, UA-12 are orphans.
    expect(seatsOf(result, "rear-fan")).toEqual([
      "UA-2",
      "UA-3",
      "UA-4",
      "UA-5",
      "UA-6",
    ]);
    expect(seatsOf(result, "balcony-any")).toEqual([
      "UA-7",
      "UA-8",
      "UA-9",
      "UA-10",
    ]);

    // late-premium-trio: premium filled in the first pass with no
    // 3-contiguous leftover, so it waterfalls (premium → mid) into the
    // tail of fbal-B.
    expect(seatsOf(result, "late-premium-trio")).toEqual([
      "FB-11",
      "FB-12",
      "FB-13",
    ]);
    expect(rowsOf(result, "late-premium-trio")).toEqual(new Set(["fbal-B"]));
  });

  it("pins the decision trail, including the FIT_RESOLVED deferral and the WATERFALLED hop", () => {
    const result = allocate(venue, offers, config);

    expect(result.decisions.map((d) => d.action)).toEqual([
      // launchPad first pass, rows by rank:
      "PLACED", // orch-AA: big-spender
      "PLACED", // orch-AA: premium-flex
      "FIT_RESOLVED", // orch-AA: premium-pair (anywhere-large deferred)
      "PLACED", // orch-BB: anywhere-large
      "ORPHAN_DETECTED", // orch-BB: BB-3, BB-12
      "PLACED", // fbal-A: mid-pair
      "PLACED", // fbal-A: mid-flex
      "PLACED", // fbal-A: any-trio
      "ORPHAN_DETECTED", // fbal-A: FA-6
      "PLACED", // fbal-B: big-group
      "ORPHAN_DETECTED", // fbal-B: FB-11..FB-13 (filled later by the waterfall)
      "PLACED", // ubal-A: balcony-any
      "PLACED", // ubal-A: rear-fan
      "ORPHAN_DETECTED", // ubal-A: UA-1, UA-11, UA-12
      // waterfall pass (late-premium-trio):
      "SKIPPED", // orch-BB: leftovers not contiguous enough
      "SKIPPED", // fbal-A: single leftover seat
      "WATERFALLED", // fbal-B: late-premium-trio placed
      "SKIPPED", // ubal-A: leftovers not contiguous enough
    ]);

    const fitResolved = result.decisions.find(
      (d) => d.action === "FIT_RESOLVED",
    );
    expect(fitResolved?.offerId).toBe("premium-pair");
    expect(fitResolved?.snapshot["skippedOfferIds"]).toEqual([
      "anywhere-large",
    ]);

    const waterfalled = result.decisions.find(
      (d) => d.action === "WATERFALLED",
    );
    expect(waterfalled?.offerId).toBe("late-premium-trio");
    expect(waterfalled?.venueRowId).toBe("fbal-B");
    expect(waterfalled?.snapshot["preferredTier"]).toBe("premium");
    expect(waterfalled?.snapshot["placedTier"]).toBe("mid");
    expect(waterfalled?.snapshot["tierDistance"]).toBe(1);
  });

  it("pins the stats envelope and the total-accounting invariant", () => {
    const result = allocate(venue, offers, config);

    const totalAvailable = 12 + 10 + 10 + 13 + 12; // 57 (BB holds 2)
    expect(result.stats).toEqual({
      totalOffers: 11,
      placedOffers: 11,
      placedSeats: 51,
      unplacedOffers: 0,
      orphanSeats: 6, // BB×2 + FA×1 + UA×3
      unfilledSeats: 0,
      fillRate: 51 / totalAvailable,
    });
    expect(
      result.stats.placedSeats +
        result.stats.orphanSeats +
        result.stats.unfilledSeats,
    ).toBe(totalAvailable);
  });
});

describe("fixture 2 — Cope's place, 50-seat untraditional venue", () => {
  // Four cabaret tables of 6 up front, a bench of 8, GA standing for
  // 18 at the back. 50 seats total, low demand (24 seats requested).
  const venueRows = [
    makeRow({
      id: "table-1",
      area: "floor",
      rowRank: 1,
      capacity: 6,
      tier: "table",
      lean: "CENTER",
      seatPrefix: "T1",
    }),
    makeRow({
      id: "table-2",
      area: "floor",
      rowRank: 2,
      capacity: 6,
      tier: "table",
      lean: "CENTER",
      seatPrefix: "T2",
    }),
    makeRow({
      id: "table-3",
      area: "floor",
      rowRank: 3,
      capacity: 6,
      tier: "table",
      lean: "CENTER",
      seatPrefix: "T3",
    }),
    makeRow({
      id: "table-4",
      area: "floor",
      rowRank: 4,
      capacity: 6,
      tier: "table",
      lean: "CENTER",
      seatPrefix: "T4",
    }),
    makeRow({
      id: "bench",
      area: "floor",
      rowRank: 5,
      capacity: 8,
      tier: "bench",
      lean: "LEFT",
      seatPrefix: "BN",
    }),
    makeRow({
      id: "ga-floor",
      area: "ga",
      rowRank: 6,
      capacity: 18,
      tier: "ga",
      isGa: true,
      seatPrefix: "GA",
    }),
  ];
  const venue = {
    venueId: "copes-place",
    rows: venueRows,
    activeRowIds: venueRows.map((r) => r.id),
  };

  const offers = [
    makeOffer({
      id: "couple-front",
      pricePerTicketCents: 20000,
      groupSize: 2,
      tierPreference: { type: "specific", tier: "table" },
    }),
    makeOffer({
      id: "foursome",
      pricePerTicketCents: 15000,
      groupSize: 4,
      tierPreference: { type: "this_or_worse", tier: "table" },
    }),
    makeOffer({
      id: "six-pack",
      pricePerTicketCents: 12000,
      groupSize: 6,
      tierPreference: { type: "any" },
    }),
    makeOffer({
      id: "trio-bench",
      pricePerTicketCents: 9000,
      groupSize: 3,
      tierPreference: { type: "this_or_worse", tier: "bench" },
    }),
    makeOffer({
      id: "ga-crew",
      pricePerTicketCents: 7000,
      groupSize: 8,
      tierPreference: { type: "specific", tier: "ga" },
    }),
    makeOffer({
      id: "solo",
      pricePerTicketCents: 6500,
      groupSize: 1,
      tierPreference: { type: "any" },
    }),
  ];

  it("places everyone, fills GA as a bucket, and accounts for the empty table", () => {
    const result = allocate(venue, offers, config);

    expect(result.unplaced).toEqual([]);

    // table-1 (CENTER): couple-front center-most, foursome to its left.
    expect(seatsOf(result, "foursome")).toEqual([
      "T1-1",
      "T1-2",
      "T1-3",
      "T1-4",
    ]);
    expect(seatsOf(result, "couple-front")).toEqual(["T1-5", "T1-6"]);

    // table-2: six-pack fills it exactly.
    expect(seatsOf(result, "six-pack")).toEqual([
      "T2-1",
      "T2-2",
      "T2-3",
      "T2-4",
      "T2-5",
      "T2-6",
    ]);

    // table-3 (CENTER): the solo sits centered; 5 orphans around them.
    expect(seatsOf(result, "solo")).toEqual(["T3-3"]);

    // table-4: nobody compatible left → SKIPPED, contributes to
    // unfilledSeats.
    const table4Skip = result.decisions.find(
      (d) => d.action === "SKIPPED" && d.venueRowId === "table-4",
    );
    expect(table4Skip).toBeDefined();

    // bench (LEFT) + GA bucket (next-available, lean ignored).
    expect(seatsOf(result, "trio-bench")).toEqual(["BN-1", "BN-2", "BN-3"]);
    expect(seatsOf(result, "ga-crew")).toEqual([
      "GA-1",
      "GA-2",
      "GA-3",
      "GA-4",
      "GA-5",
      "GA-6",
      "GA-7",
      "GA-8",
    ]);
  });

  it("pins the stats envelope at low demand", () => {
    const result = allocate(venue, offers, config);

    expect(result.stats).toEqual({
      totalOffers: 6,
      placedOffers: 6,
      placedSeats: 24,
      unplacedOffers: 0,
      orphanSeats: 20, // table-3×5 + bench×5 + GA×10
      unfilledSeats: 6, // table-4, untouched
      fillRate: 24 / 50,
    });
    expect(
      result.stats.placedSeats +
        result.stats.orphanSeats +
        result.stats.unfilledSeats,
    ).toBe(50);
  });
});

describe("fixture 3 — sectioned-off Austin theater (partial activation, mixed reserved + GA)", () => {
  // The building has VIP boxes, a reserved main floor, a GA pit, and a
  // balcony. For THIS show only the main floor, the pit, and the rear
  // box are active (activeRowIds, NEW-4). Two traps this fixture pins:
  //
  //   * box-1 (rowRank 1) is INACTIVE. If the waterfall's tier index
  //     were built from all rows, the 'box' tier would rank above
  //     'main'/'ga' and the active box-2 would never accept a
  //     this_or_worse cascade from below — leaving its 4 seats empty
  //     and the fan unplaced. Active-rows ordering puts box LAST
  //     (min active rowRank 5).
  //   * The balcony exists but is fully inactive: an offer anchored to
  //     it must classify as no_compatible_tier, not no_fit_anywhere
  //     (spec §"Tier preferences with no compatible rows").
  const venueRows = [
    makeRow({
      id: "box-1",
      area: "boxes",
      rowRank: 1,
      capacity: 4,
      tier: "box",
      lean: "LEFT",
      seatPrefix: "B1",
    }),
    makeRow({
      id: "main-A",
      area: "orchestra",
      rowRank: 2,
      capacity: 8,
      tier: "main",
      lean: "CENTER",
      seatPrefix: "MA",
    }),
    makeRow({
      id: "ga-pit",
      area: "ga",
      rowRank: 3,
      capacity: 12,
      tier: "ga",
      isGa: true,
      seatPrefix: "GA",
    }),
    makeRow({
      id: "balc-A",
      area: "front_balcony",
      rowRank: 4,
      capacity: 10,
      tier: "balcony",
      lean: "CENTER",
      seatPrefix: "BA",
    }),
    makeRow({
      id: "box-2",
      area: "boxes",
      rowRank: 5,
      capacity: 4,
      tier: "box",
      lean: "LEFT",
      seatPrefix: "B2",
    }),
  ];
  const venue = {
    venueId: "austin-theater",
    rows: venueRows,
    activeRowIds: ["main-A", "ga-pit", "box-2"],
  };

  const offers = [
    makeOffer({
      id: "main-filler",
      pricePerTicketCents: 10000,
      groupSize: 8,
      tierPreference: { type: "specific", tier: "main" },
    }),
    makeOffer({
      id: "ga-crowd",
      pricePerTicketCents: 9000,
      groupSize: 8,
      tierPreference: { type: "specific", tier: "ga" },
    }),
    makeOffer({
      id: "ga-topup",
      pricePerTicketCents: 8500,
      groupSize: 4,
      tierPreference: { type: "this_or_worse", tier: "ga" },
    }),
    // Wants main-or-worse. Main fills in the first pass, so this must
    // waterfall — and the only space left is the ACTIVE box. Under the
    // all-rows tier index this went unplaced with 4 box seats empty.
    makeOffer({
      id: "flex-fan",
      pricePerTicketCents: 8000,
      groupSize: 4,
      tierPreference: { type: "this_or_worse", tier: "main" },
    }),
    // Anchored to the balcony, which exists but is inactive this show.
    makeOffer({
      id: "balcony-lover",
      pricePerTicketCents: 7000,
      groupSize: 2,
      tierPreference: { type: "specific", tier: "balcony" },
    }),
  ];

  it("waterfalls into the active box and never touches inactive rows", () => {
    const result = allocate(venue, offers, config);

    expect(seatsOf(result, "main-filler")).toEqual([
      "MA-1",
      "MA-2",
      "MA-3",
      "MA-4",
      "MA-5",
      "MA-6",
      "MA-7",
      "MA-8",
    ]);
    expect(seatsOf(result, "ga-crowd")).toEqual([
      "GA-1",
      "GA-2",
      "GA-3",
      "GA-4",
      "GA-5",
      "GA-6",
      "GA-7",
      "GA-8",
    ]);
    expect(seatsOf(result, "ga-topup")).toEqual([
      "GA-9",
      "GA-10",
      "GA-11",
      "GA-12",
    ]);
    expect(seatsOf(result, "flex-fan")).toEqual([
      "B2-1",
      "B2-2",
      "B2-3",
      "B2-4",
    ]);

    // No assignment lands in an inactive row, ever.
    const assignedRows = new Set(result.assignments.map((a) => a.venueRowId));
    expect(assignedRows.has("box-1")).toBe(false);
    expect(assignedRows.has("balc-A")).toBe(false);

    const waterfalled = result.decisions.find(
      (d) => d.action === "WATERFALLED",
    );
    expect(waterfalled?.offerId).toBe("flex-fan");
    expect(waterfalled?.venueRowId).toBe("box-2");
    expect(waterfalled?.snapshot["preferredTier"]).toBe("main");
    expect(waterfalled?.snapshot["placedTier"]).toBe("box");
    expect(waterfalled?.snapshot["tierDistance"]).toBe(2); // main(0) → box(2) in the ACTIVE ordering
  });

  it("classifies the inactive-tier offer as no_compatible_tier and fills the active house", () => {
    const result = allocate(venue, offers, config);

    expect(result.unplaced).toEqual([
      { offerId: "balcony-lover", reason: "no_compatible_tier" },
    ]);

    // Active capacity only: 8 + 12 + 4. Inactive rows are not counted.
    expect(result.stats).toEqual({
      totalOffers: 5,
      placedOffers: 4,
      placedSeats: 24,
      unplacedOffers: 1,
      orphanSeats: 0,
      unfilledSeats: 0,
      fillRate: 1,
    });
  });
});
