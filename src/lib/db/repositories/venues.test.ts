import { describe, expect, expectTypeOf, it } from "vitest";

import type { VenueRow } from "@/lib/gae/types";
import {
  getVenueArchitectureById,
  getVenueArchitecturesByIds,
  getVenueById,
  type VenueArchitecture,
} from "./venues";
import { makeMockDb } from "./_mock-db";

describe("getVenueById", () => {
  it("returns null when no row matches", async () => {
    const db = makeMockDb([]);
    expect(await getVenueById(db, "missing")).toBeNull();
  });

  it("returns the venue row as-is when found", async () => {
    const venue = {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Cope's place",
      city: "Brooklyn, NY",
      // numeric() columns come back as strings from postgres-js; keep raw.
      geoLat: null,
      geoLon: null,
      geoRadiusM: 500,
      createdAt: new Date("2026-05-01T00:00:00Z"),
    };
    const db = makeMockDb([venue]);
    expect(await getVenueById(db, venue.id)).toEqual(venue);
  });
});

describe("getVenueArchitectureById", () => {
  it("returns null when no row matches", async () => {
    const db = makeMockDb([]);
    expect(await getVenueArchitectureById(db, "missing")).toBeNull();
  });

  it("narrows rows to VenueRow[] without transforming", async () => {
    const rows: VenueRow[] = [
      {
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
        isGa: false,
      },
    ];
    const arch = {
      id: "33333333-3333-3333-3333-333333333333",
      venueId: "22222222-2222-2222-2222-222222222222",
      version: 1,
      rows,
      createdAt: new Date("2026-05-01T00:00:00Z"),
    };
    const db = makeMockDb([arch]);
    const result = await getVenueArchitectureById(db, arch.id);
    expect(result).not.toBeNull();
    // Pass-through: same reference, not a copy.
    expect(result?.rows).toBe(rows);
    expect(result?.rows[0]?.rowName).toBe("A");
  });

  it("has the expected return type", () => {
    expectTypeOf(getVenueArchitectureById).returns.resolves.toEqualTypeOf<
      VenueArchitecture | null
    >();
  });
});

describe("getVenueArchitecturesByIds", () => {
  it("short-circuits to an empty map when no IDs are passed (skips the query)", async () => {
    const db = makeMockDb([]);
    const result = await getVenueArchitecturesByIds(db, []);
    expect(result.size).toBe(0);
  });

  it("returns a map keyed by architecture id", async () => {
    const rows: VenueRow[] = [
      {
        id: "row_a",
        area: "orchestra",
        section: "main",
        rowName: "A",
        rowRank: 1,
        capacity: 8,
        parity: "EVEN",
        lean: "CENTER",
        seatNumbers: ["1", "2"],
        holds: [],
        tier: "premium",
      },
    ];
    const archA = {
      id: "33333333-3333-3333-3333-333333333333",
      venueId: "22222222-2222-2222-2222-222222222222",
      version: 1,
      rows,
      createdAt: new Date("2026-05-01T00:00:00Z"),
    };
    const archB = { ...archA, id: "33333333-3333-3333-3333-333333333334" };
    const db = makeMockDb([archA, archB]);
    const result = await getVenueArchitecturesByIds(db, [archA.id, archB.id]);
    expect(result.size).toBe(2);
    expect(result.get(archA.id)?.rows[0]?.rowName).toBe("A");
  });

  it("omits architectures that don't exist (caller .get() returns undefined)", async () => {
    const arch = {
      id: "33333333-3333-3333-3333-333333333333",
      venueId: "22222222-2222-2222-2222-222222222222",
      version: 1,
      rows: [] as VenueRow[],
      createdAt: new Date("2026-05-01T00:00:00Z"),
    };
    const db = makeMockDb([arch]);
    const result = await getVenueArchitecturesByIds(db, [
      arch.id,
      "33333333-3333-3333-3333-333333333334",
    ]);
    expect(result.size).toBe(1);
    expect(result.has(arch.id)).toBe(true);
  });

  it("has the expected return type", () => {
    expectTypeOf(getVenueArchitecturesByIds).returns.resolves.toEqualTypeOf<
      Map<string, VenueArchitecture>
    >();
  });
});
