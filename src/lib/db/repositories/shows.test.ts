import { describe, expect, expectTypeOf, it } from "vitest";

import {
  announceShow,
  closeShow,
  getShowById,
  listAllShows,
  listOpenShows,
  listShowsForArtist,
  pauseShow,
  resumeShow,
  type ShowSummary,
  type ShowWithRelations,
} from "./shows";
import { makeMockDb, makeQueuedMockDb } from "./_mock-db";

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
      activeRowIds: ["row_a", "row_b", "row_c", "row_d", "row_ga"],
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

describe("listAllShows", () => {
  it("returns an empty array when there are no shows", async () => {
    const db = makeMockDb<ShowSummary>([]);
    expect(await listAllShows(db)).toEqual([]);
  });

  it("returns the projected summary shape for every status (no filter)", async () => {
    const draft: ShowSummary = {
      id: "44444444-4444-4444-4444-444444444444",
      artistId: "11111111-1111-1111-1111-111111111111",
      venueId: "22222222-2222-2222-2222-222222222222",
      venueArchitectureId: "33333333-3333-3333-3333-333333333333",
      status: "draft",
      doorsAt: new Date("2026-06-25T00:00:00Z"),
      offerWindowOpensAt: new Date("2026-05-25T00:00:00Z"),
      bindingAllocationAt: new Date("2026-06-24T00:00:00Z"),
      pausedAt: null,
      activeRowIds: ["row_a"],
      artistName: "Citizen Cope",
      venueName: "Cope's place",
      venueCity: "Brooklyn, NY",
    };
    const complete: ShowSummary = {
      ...draft,
      id: "55555555-5555-5555-5555-555555555555",
      status: "complete",
    };

    const db = makeMockDb([draft, complete]);
    const result = await listAllShows(db);

    expect(result).toEqual([draft, complete]);
    // No presenter-derived fields leaked into the summary.
    expect(result[0]).not.toHaveProperty("statusLabel");
  });

  it("has the expected return type", () => {
    expectTypeOf(listAllShows).returns.resolves.toEqualTypeOf<ShowSummary[]>();
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

describe("announceShow", () => {
  it("returns ok with the updated row when the draft → open UPDATE hits", async () => {
    // The guarded UPDATE matched the draft row; only the one query runs and
    // the follow-up existence SELECT is never reached.
    const opened = { id: "show-1", status: "open" };
    const db = makeQueuedMockDb<typeof opened>([[opened]]);
    const result = await announceShow(db, "show-1");
    expect(result).toEqual({ ok: true, show: opened });
  });

  it("returns not_found when the UPDATE misses and no row exists", async () => {
    // Batch 0: UPDATE returning [] (no draft matched). Batch 1: the
    // follow-up existence SELECT also empty → the show doesn't exist.
    const db = makeQueuedMockDb<Record<string, unknown>>([[], []]);
    const result = await announceShow(db, "missing");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_draft with the current status when the show isn't a draft", async () => {
    // Batch 0: UPDATE returning [] (status guard failed). Batch 1: the
    // existence SELECT finds the row in a non-draft status.
    const db = makeQueuedMockDb<Record<string, unknown>>([
      [],
      [{ status: "open" }],
    ]);
    const result = await announceShow(db, "show-1");
    expect(result).toEqual({ ok: false, reason: "not_draft", status: "open" });
  });
});

// Guarded status transitions (pause / resume / close) share one core, so the
// cases below exercise its three outcomes through each public fn: ok (UPDATE
// hit), not_found (no row), wrong_status (row in an ineligible state). The mock
// db can't evaluate the WHERE guard, so "ok" cases assert the row is threaded
// through; the not-ok cases assert the follow-up SELECT drives the right typed
// failure.
describe("pauseShow", () => {
  const now = new Date("2026-05-31T12:00:00Z");

  it("returns ok with the updated row when the open → paused UPDATE hits", async () => {
    const paused = { id: "show-1", status: "paused" };
    const db = makeQueuedMockDb<typeof paused>([[paused]]);
    expect(await pauseShow(db, "show-1", now)).toEqual({
      ok: true,
      show: paused,
    });
  });

  it("returns not_found when the UPDATE misses and no row exists", async () => {
    const db = makeQueuedMockDb<Record<string, unknown>>([[], []]);
    expect(await pauseShow(db, "missing", now)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns wrong_status with the current status when the show isn't open", async () => {
    const db = makeQueuedMockDb<Record<string, unknown>>([
      [],
      [{ status: "closed" }],
    ]);
    expect(await pauseShow(db, "show-1", now)).toEqual({
      ok: false,
      reason: "wrong_status",
      status: "closed",
    });
  });
});

describe("resumeShow", () => {
  it("returns ok with the updated row when the paused → open UPDATE hits", async () => {
    const opened = { id: "show-1", status: "open" };
    const db = makeQueuedMockDb<typeof opened>([[opened]]);
    expect(await resumeShow(db, "show-1")).toEqual({ ok: true, show: opened });
  });

  it("returns wrong_status when the show isn't paused", async () => {
    const db = makeQueuedMockDb<Record<string, unknown>>([
      [],
      [{ status: "open" }],
    ]);
    expect(await resumeShow(db, "show-1")).toEqual({
      ok: false,
      reason: "wrong_status",
      status: "open",
    });
  });
});

describe("closeShow", () => {
  it("returns ok with the updated row when the → closed UPDATE hits", async () => {
    const closed = { id: "show-1", status: "closed" };
    const db = makeQueuedMockDb<typeof closed>([[closed]]);
    expect(await closeShow(db, "show-1")).toEqual({ ok: true, show: closed });
  });

  it("returns not_found when the show doesn't exist", async () => {
    const db = makeQueuedMockDb<Record<string, unknown>>([[], []]);
    expect(await closeShow(db, "missing")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns wrong_status when the show is already allocated", async () => {
    const db = makeQueuedMockDb<Record<string, unknown>>([
      [],
      [{ status: "allocated" }],
    ]);
    expect(await closeShow(db, "show-1")).toEqual({
      ok: false,
      reason: "wrong_status",
      status: "allocated",
    });
  });
});
