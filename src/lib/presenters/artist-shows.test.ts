import { describe, expect, it } from "vitest";

import type {
  OfferStats,
  OfferTierBucket,
  ShowSummary,
  VenueArchitecture,
} from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import {
  computeShowCapacity,
  presentArtistShowSummary,
  presentArtistSnapshotStats,
  presentTierBreakdown,
  type ArtistShowSummaryView,
  type ArtistSnapshotStatsView,
} from "./artist-shows";

function makeSummary(overrides: Partial<ShowSummary> = {}): ShowSummary {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    artistId: "11111111-1111-1111-1111-111111111111",
    venueId: "22222222-2222-2222-2222-222222222222",
    venueArchitectureId: "33333333-3333-3333-3333-333333333333",
    status: "open",
    doorsAt: new Date("2026-06-13T21:00:00-04:00"),
    offerWindowOpensAt: new Date("2026-05-25T16:00:00-04:00"),
    bindingAllocationAt: new Date("2026-06-12T21:00:00-04:00"),
    pausedAt: null,
    activeRowIds: ["row_a", "row_b"],
    artistName: "Citizen Cope",
    venueName: "Cope's place",
    venueCity: "Brooklyn, NY",
    ...overrides,
  };
}

function makeRow(overrides: Partial<VenueRow> = {}): VenueRow {
  return {
    id: "row_a",
    area: "orchestra",
    section: "main",
    rowName: "A",
    rowRank: 1,
    capacity: 8,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: ["1", "2", "3", "4", "5", "6", "7", "8"],
    holds: [],
    tier: "premium",
    ...overrides,
  };
}

function makeArchitecture(
  rows: VenueRow[],
): Pick<VenueArchitecture, "rows"> {
  return { rows };
}

describe("computeShowCapacity", () => {
  it("returns 0 for an empty architecture", () => {
    expect(computeShowCapacity(makeArchitecture([]), [])).toBe(0);
  });

  it("sums capacity across the intersection of architecture rows and activeRowIds", () => {
    const arch = makeArchitecture([
      makeRow({ id: "row_a", capacity: 8 }),
      makeRow({ id: "row_b", capacity: 8 }),
      makeRow({ id: "row_ga", capacity: 22 }),
    ]);
    expect(computeShowCapacity(arch, ["row_a", "row_ga"])).toBe(30);
  });

  it("ignores activeRowIds that don't exist in the architecture", () => {
    const arch = makeArchitecture([makeRow({ id: "row_a", capacity: 8 })]);
    expect(computeShowCapacity(arch, ["row_a", "row_zz"])).toBe(8);
  });
});

describe("presentArtistShowSummary", () => {
  it("renders offers/medianPrice/topPrice for a healthy pool", () => {
    // Matches ArtistDashboard.jsx row 1 / row 2 shape: numeric offers
    // count, formatted median + top prices.
    const now = new Date("2026-05-28T16:00:00-04:00");
    const stats: OfferStats = {
      count: 142,
      ticketsCount: 487,
      medianCents: 2800,
      topCents: 12000,
    };
    const arch = makeArchitecture([
      makeRow({ id: "row_a", capacity: 8 }),
      makeRow({ id: "row_b", capacity: 8 }),
    ]);
    const view = presentArtistShowSummary(
      makeSummary(),
      stats,
      0,
      arch,
      ["row_a", "row_b"],
      now,
    );

    expect(view.offers).toBe(142);
    expect(view.ticketsCount).toBe(487);
    expect(view.medianPrice).toBe("$28.00");
    expect(view.topPrice).toBe("$120.00");
  });

  it("renders em-dash for both prices when the pool is empty (matches row 3 of the prototype)", () => {
    // ArtistDashboard.jsx row 3: offers: 0, medianPrice: '—', topPrice: '—'.
    // The em-dash is U+2014; the prototype uses it literally.
    const now = new Date("2026-05-26T12:00:00-04:00");
    const stats: OfferStats = { count: 0, ticketsCount: 0, medianCents: null, topCents: null };
    const view = presentArtistShowSummary(
      makeSummary(),
      stats,
      0,
      makeArchitecture([makeRow({ capacity: 50 })]),
      ["row_a"],
      now,
    );

    expect(view.offers).toBe(0);
    expect(view.medianPrice).toBe("—");
    expect(view.topPrice).toBe("—");
  });

  it("carries through the base ShowSummaryView fields unchanged (dateLong/statusLabel/etc)", () => {
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentArtistShowSummary(
      makeSummary(),
      { count: 0, ticketsCount: 0, medianCents: null, topCents: null },
      0,
      makeArchitecture([]),
      [],
      now,
    );
    expect(view.dateLong).toBe("Sat · Jun 13 · 9pm");
    expect(view.dateShort).toBe("Jun 13");
    expect(view.statusLabel).toBe("Offers open");
    expect(view.closes).toBe("15d until binding");
  });

  it("does not attach yourOffer (artist rows are aggregates, not personal offers)", () => {
    // The Artist Dashboard never shows the artist's own fan-offer on
    // their show — it shows the aggregate stats instead. Make sure the
    // yourOffer key doesn't sneak in.
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentArtistShowSummary(
      makeSummary(),
      { count: 5, ticketsCount: 18, medianCents: 3000, topCents: 4000 },
      12,
      makeArchitecture([makeRow({ capacity: 50 })]),
      ["row_a"],
      now,
    );
    expect(view).not.toHaveProperty("yourOffer");
  });

  it("exposes provisionalFilled + capacity for the per-row capacity bar (ArtistDashboard.jsx line 12)", () => {
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentArtistShowSummary(
      makeSummary(),
      { count: 142, ticketsCount: 487, medianCents: 2800, topCents: 12000 },
      487,
      makeArchitecture([
        makeRow({ id: "row_a", capacity: 200 }),
        makeRow({ id: "row_b", capacity: 200 }),
        makeRow({ id: "row_c", capacity: 224 }),
      ]),
      ["row_a", "row_b", "row_c"],
      now,
    );
    expect(view.provisionalFilled).toBe(487);
    expect(view.capacity).toBe(624);
  });

  it("falls back to capacity=0 when the architecture is missing", () => {
    // Shouldn't happen in production (RESTRICT FK), but the presenter
    // degrades rather than crashing.
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentArtistShowSummary(
      makeSummary(),
      { count: 0, ticketsCount: 0, medianCents: null, topCents: null },
      0,
      null,
      null,
      now,
    );
    expect(view.capacity).toBe(0);
    expect(view.provisionalFilled).toBe(0);
  });

  it("falls back to summing the full architecture when activeRowIds is null", () => {
    // The fallback over-counts a partial-venue show but never under-
    // counts. Acceptable as a safety net.
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentArtistShowSummary(
      makeSummary(),
      { count: 0, ticketsCount: 0, medianCents: null, topCents: null },
      0,
      makeArchitecture([
        makeRow({ id: "row_a", capacity: 8 }),
        makeRow({ id: "row_b", capacity: 8 }),
      ]),
      null,
      now,
    );
    expect(view.capacity).toBe(16);
  });

  it("matches the declared ArtistShowSummaryView type", () => {
    // Compile-time + runtime check that the merged shape stays exact.
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view: ArtistShowSummaryView = presentArtistShowSummary(
      makeSummary(),
      { count: 3, ticketsCount: 9, medianCents: 2200, topCents: 3500 },
      0,
      makeArchitecture([makeRow({ capacity: 50 })]),
      ["row_a"],
      now,
    );
    expect(view.offers).toBe(3);
    expect(view.medianPrice).toBe("$22.00");
    expect(view.topPrice).toBe("$35.00");
    expect(view.capacity).toBe(50);
  });
});

describe("presentArtistSnapshotStats", () => {
  it("renders the populated cross-show snapshot (no fill totals passed → capacityFilled defaults to '—')", () => {
    const stats: OfferStats = {
      count: 180,
      ticketsCount: 612,
      medianCents: 2600,
      topCents: 12000,
    };
    const view = presentArtistSnapshotStats(stats);
    expect(view).toEqual<ArtistSnapshotStatsView>({
      offersInPool: 180,
      ticketsInPool: 612,
      medianOffer: "$26.00",
      topOffer: "$120.00",
      capacityFilled: "—",
      capacityFilledSub: "no shows yet",
    });
  });

  it("renders zero/em-dash when the artist has no live offers anywhere", () => {
    const view = presentArtistSnapshotStats({
      count: 0,
      ticketsCount: 0,
      medianCents: null,
      topCents: null,
    });
    expect(view).toEqual<ArtistSnapshotStatsView>({
      offersInPool: 0,
      ticketsInPool: 0,
      medianOffer: "—",
      topOffer: "—",
      capacityFilled: "—",
      capacityFilledSub: "no shows yet",
    });
  });

  it("renders capacityFilled as a rounded percentage when totals are passed", () => {
    // 487 / 624 = 0.7804... → 78%
    const stats: OfferStats = {
      count: 180,
      ticketsCount: 612,
      medianCents: 2600,
      topCents: 12000,
    };
    const view = presentArtistSnapshotStats(stats, {
      totalFilled: 487,
      totalCapacity: 624,
    });
    expect(view.capacityFilled).toBe("78%");
    expect(view.capacityFilledSub).toBe("487 / 624 provisionally placed");
  });

  it("renders 0% (not NaN) when totalCapacity is positive but nothing is placed yet", () => {
    const view = presentArtistSnapshotStats(
      { count: 0, ticketsCount: 0, medianCents: null, topCents: null },
      { totalFilled: 0, totalCapacity: 200 },
    );
    expect(view.capacityFilled).toBe("0%");
    expect(view.capacityFilledSub).toBe("0 / 200 provisionally placed");
  });

  it("falls back to '—' when totalCapacity is 0 (no architecture for any show) — never renders NaN%", () => {
    const view = presentArtistSnapshotStats(
      { count: 12, ticketsCount: 40, medianCents: 3000, topCents: 6000 },
      { totalFilled: 0, totalCapacity: 0 },
    );
    expect(view.capacityFilled).toBe("—");
    expect(view.capacityFilledSub).toBe("no shows yet");
  });
});

describe("presentTierBreakdown", () => {
  it("returns three zero-buckets for an empty pool", () => {
    const view = presentTierBreakdown([]);
    expect(view.totalOffers).toBe(0);
    expect(view.totalTickets).toBe(0);
    expect(view.buckets.map((b) => b.key)).toEqual([
      "premium-only",
      "premium-or-below",
      "anywhere",
    ]);
    for (const b of view.buckets) {
      expect(b.offers).toBe(0);
      expect(b.tickets).toBe(0);
    }
  });

  it("maps composer tier_preference values to the three visible buckets", () => {
    const rows: OfferTierBucket[] = [
      { tierPreference: "specific", preferredTier: "premium", count: 4, ticketsCount: 12 },
      { tierPreference: "this_or_worse", preferredTier: "premium", count: 7, ticketsCount: 28 },
      { tierPreference: "any", preferredTier: null, count: 11, ticketsCount: 41 },
    ];
    const view = presentTierBreakdown(rows);
    expect(view.totalOffers).toBe(22);
    expect(view.totalTickets).toBe(81);
    expect(view.buckets.find((b) => b.key === "premium-only")).toMatchObject({
      offers: 4,
      tickets: 12,
    });
    expect(view.buckets.find((b) => b.key === "premium-or-below")).toMatchObject({
      offers: 7,
      tickets: 28,
    });
    expect(view.buckets.find((b) => b.key === "anywhere")).toMatchObject({
      offers: 11,
      tickets: 41,
    });
  });

  it("folds the deferred 'this_or_better' option into 'anywhere'", () => {
    // The composer doesn't surface this_or_better today. If a row ever
    // shows up with it, it lands in 'anywhere' — at worst the fan is
    // willing to take a seat — rather than silently dropping.
    const rows: OfferTierBucket[] = [
      { tierPreference: "this_or_better", preferredTier: "mid", count: 2, ticketsCount: 5 },
      { tierPreference: "any", preferredTier: null, count: 3, ticketsCount: 9 },
    ];
    const view = presentTierBreakdown(rows);
    expect(view.buckets.find((b) => b.key === "anywhere")).toMatchObject({
      offers: 5,
      tickets: 14,
    });
  });

  it("carries the composer-matching labels through", () => {
    const view = presentTierBreakdown([]);
    expect(view.buckets[0]?.label).toBe("Premium only");
    expect(view.buckets[1]?.label).toBe("Premium or below");
    expect(view.buckets[2]?.label).toBe("Anywhere I fit");
  });
});
