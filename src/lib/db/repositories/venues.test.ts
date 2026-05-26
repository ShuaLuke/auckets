import { describe, expect, expectTypeOf, it } from "vitest";

import type { VenueRow } from "@/lib/gae/types";
import {
  getVenueArchitectureById,
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
