import { describe, expect, expectTypeOf, it } from "vitest";

import { artists } from "../../../../drizzle/schema";
import { getArtistById, getArtistBySlug } from "./artists";
import { makeMockDb } from "./_mock-db";

type Artist = typeof artists.$inferSelect;

const COPE = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Citizen Cope",
  slug: "citizen-cope",
  stripeConnectId: null,
  createdAt: new Date("2026-05-01T00:00:00Z"),
};

describe("getArtistById", () => {
  it("returns null when no row matches", async () => {
    const db = makeMockDb([]);
    expect(await getArtistById(db, "missing")).toBeNull();
  });

  it("returns the artist row when found", async () => {
    const db = makeMockDb([COPE]);
    expect(await getArtistById(db, COPE.id)).toEqual(COPE);
  });

  it("has the expected return type", () => {
    expectTypeOf(getArtistById).returns.resolves.toEqualTypeOf<Artist | null>();
  });
});

describe("getArtistBySlug", () => {
  it("returns null when no row matches", async () => {
    const db = makeMockDb([]);
    expect(await getArtistBySlug(db, "no-such-artist")).toBeNull();
  });

  it("returns the artist row when found", async () => {
    const db = makeMockDb([COPE]);
    expect(await getArtistBySlug(db, "citizen-cope")).toEqual(COPE);
  });
});
