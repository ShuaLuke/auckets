import { describe, expect, it } from "vitest";

import type {
  OfferStats,
  ShowSummary,
} from "@/lib/db/repositories";

import {
  presentArtistShowSummary,
  presentArtistSnapshotStats,
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
    artistName: "Citizen Cope",
    venueName: "Cope's place",
    venueCity: "Brooklyn, NY",
    ...overrides,
  };
}

describe("presentArtistShowSummary", () => {
  it("renders offers/medianPrice/topPrice for a healthy pool", () => {
    // Matches ArtistDashboard.jsx row 1 / row 2 shape: numeric offers
    // count, formatted median + top prices.
    const now = new Date("2026-05-28T16:00:00-04:00");
    const stats: OfferStats = {
      count: 142,
      medianCents: 2800,
      topCents: 12000,
    };
    const view = presentArtistShowSummary(makeSummary(), stats, now);

    expect(view.offers).toBe(142);
    expect(view.medianPrice).toBe("$28.00");
    expect(view.topPrice).toBe("$120.00");
  });

  it("renders em-dash for both prices when the pool is empty (matches row 3 of the prototype)", () => {
    // ArtistDashboard.jsx row 3: offers: 0, medianPrice: '—', topPrice: '—'.
    // The em-dash is U+2014; the prototype uses it literally.
    const now = new Date("2026-05-26T12:00:00-04:00");
    const stats: OfferStats = { count: 0, medianCents: null, topCents: null };
    const view = presentArtistShowSummary(makeSummary(), stats, now);

    expect(view.offers).toBe(0);
    expect(view.medianPrice).toBe("—");
    expect(view.topPrice).toBe("—");
  });

  it("carries through the base ShowSummaryView fields unchanged (dateLong/statusLabel/etc)", () => {
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentArtistShowSummary(
      makeSummary(),
      { count: 0, medianCents: null, topCents: null },
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
      { count: 5, medianCents: 3000, topCents: 4000 },
      now,
    );
    expect(view).not.toHaveProperty("yourOffer");
  });

  it("matches the declared ArtistShowSummaryView type", () => {
    // Compile-time + runtime check that the merged shape stays exact.
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view: ArtistShowSummaryView = presentArtistShowSummary(
      makeSummary(),
      { count: 3, medianCents: 2200, topCents: 3500 },
      now,
    );
    expect(view.offers).toBe(3);
    expect(view.medianPrice).toBe("$22.00");
    expect(view.topPrice).toBe("$35.00");
  });
});

describe("presentArtistSnapshotStats", () => {
  it("renders the populated cross-show snapshot", () => {
    const stats: OfferStats = {
      count: 180,
      medianCents: 2600,
      topCents: 12000,
    };
    const view = presentArtistSnapshotStats(stats);
    expect(view).toEqual<ArtistSnapshotStatsView>({
      offersInPool: 180,
      medianOffer: "$26.00",
      topOffer: "$120.00",
    });
  });

  it("renders zero/em-dash when the artist has no live offers anywhere", () => {
    const view = presentArtistSnapshotStats({
      count: 0,
      medianCents: null,
      topCents: null,
    });
    expect(view).toEqual<ArtistSnapshotStatsView>({
      offersInPool: 0,
      medianOffer: "—",
      topOffer: "—",
    });
  });
});
