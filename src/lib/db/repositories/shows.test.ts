import { describe, expect, expectTypeOf, it } from "vitest";

import {
  getShowById,
  listOpenShows,
  listShowsForArtist,
  type ShowSummary,
  type ShowWithRelations,
} from "./shows";
import { makeMockDb } from "./_mock-db";

function fakeJoinedShowRow(): {
  shows: ShowWithRelations;
  artists: ShowWithRelations["artist"];
  venues: ShowWithRelations["venue"];
  venue_architectures: ShowWithRelations["venueArchitecture"];
} {
  const artist = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Citizen Cope",
    slug: "citizen-cope",
    stripeConnectId: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
  };
  const venue = {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Cope's place",
    city: "Brooklyn, NY",
    geoLat: null,
    geoLon: null,
    geoRadiusM: 500,
    createdAt: new Date("2026-05-01T00:00:00Z"),
  };
  const architecture = {
    id: "33333333-3333-3333-3333-333333333333",
    venueId: venue.id,
    version: 1,
    rows: [],
    createdAt: new Date("2026-05-01T00:00:00Z"),
  };
  const show = {
    id: "44444444-4444-4444-4444-444444444444",
    artistId: artist.id,
    venueId: venue.id,
    venueArchitectureId: architecture.id,
    doorsAt: new Date("2026-06-25T00:00:00Z"),
    offerWindowOpensAt: new Date("2026-05-25T00:00:00Z"),
    bindingAllocationAt: new Date("2026-06-24T00:00:00Z"),
    pausedAt: null,
    status: "open",
    tierFloorsCents: { premium: 5000, mid: 3500, ga: 2500 },
    maxGroupSize: 10,
    activeRowIds: ["row_a", "row_b", "row_c", "row_d", "row_ga"],
    bleacherEnabled: false,
    bleacherCapacity: 0,
    bleacherPriceCents: null,
    showHolds: [],
    emailCustomization: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    artist,
    venue,
    venueArchitecture: architecture,
  };
  return {
    shows: show,
    artists: artist,
    venues: venue,
    venue_architectures: architecture,
  };
}

describe("getShowById", () => {
  it("returns null when no row matches", async () => {
    const db = makeMockDb([]);
    expect(await getShowById(db, "missing")).toBeNull();
  });

  it("reshapes the joined row into a nested object", async () => {
    const row = fakeJoinedShowRow();
    const db = makeMockDb([row]);

    const result = await getShowById(db, row.shows.id);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(row.shows.id);
    expect(result?.artist).toBe(row.artists);
    expect(result?.venue).toBe(row.venues);
    expect(result?.venueArchitecture.id).toBe(row.venue_architectures.id);
    // Money stays integer cents; no formatting.
    expect(result?.tierFloorsCents).toEqual({
      premium: 5000,
      mid: 3500,
      ga: 2500,
    });
    // Timestamps remain Date instances.
    expect(result?.doorsAt).toBeInstanceOf(Date);
  });

  it("has the expected return type", () => {
    expectTypeOf(getShowById).returns.resolves.toEqualTypeOf<
      ShowWithRelations | null
    >();
  });
});

describe("listOpenShows", () => {
  it("returns an empty array when no shows are open", async () => {
    const db = makeMockDb<ShowSummary>([]);
    expect(await listOpenShows(db)).toEqual([]);
  });

  it("returns the projected summary shape (no formatting)", async () => {
    const summary: ShowSummary = {
      id: "44444444-4444-4444-4444-444444444444",
      artistId: "11111111-1111-1111-1111-111111111111",
      venueId: "22222222-2222-2222-2222-222222222222",
      venueArchitectureId: "33333333-3333-3333-3333-333333333333",
      status: "open",
      doorsAt: new Date("2026-06-25T00:00:00Z"),
      offerWindowOpensAt: new Date("2026-05-25T00:00:00Z"),
      bindingAllocationAt: new Date("2026-06-24T00:00:00Z"),
      pausedAt: null,
      artistName: "Citizen Cope",
      venueName: "Cope's place",
      venueCity: "Brooklyn, NY",
    };

    const db = makeMockDb([summary]);
    const result = await listOpenShows(db);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(summary);
    // No presenter-derived fields leaked into the summary.
    expect(result[0]).not.toHaveProperty("dateLong");
    expect(result[0]).not.toHaveProperty("statusLabel");
  });

  it("has the expected return type", () => {
    expectTypeOf(listOpenShows).returns.resolves.toEqualTypeOf<ShowSummary[]>();
  });
});

describe("listShowsForArtist", () => {
  it("returns an empty array when the artist has no shows", async () => {
    const db = makeMockDb<ShowSummary>([]);
    expect(
      await listShowsForArtist(db, "11111111-1111-1111-1111-111111111111"),
    ).toEqual([]);
  });

  it("has the expected return type", () => {
    expectTypeOf(listShowsForArtist).returns.resolves.toEqualTypeOf<
      ShowSummary[]
    >();
    expectTypeOf(listShowsForArtist).parameter(1).toEqualTypeOf<string>();
  });
});
