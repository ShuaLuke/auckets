import { describe, expect, expectTypeOf, it } from "vitest";

import { artists } from "../../../../drizzle/schema";
import {
  getArtistById,
  getArtistBySlug,
  listAllArtists,
  listArtistMembershipsForUser,
  listArtistsManageableByUser,
  userCanManageArtist,
} from "./artists";
import { makeMockDb, makeQueuedMockDb } from "./_mock-db";

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

describe("userCanManageArtist", () => {
  const userId = "user_2abcdefghijklmnop";

  it("returns true when the user has role AUCKETS_ADMIN (short-circuits the membership check)", async () => {
    // Queue: first select (admin lookup) returns a hit. Second slot is
    // empty but should never be consumed.
    const db = makeQueuedMockDb<{ role: string } | { userId: string }>([
      [{ role: "AUCKETS_ADMIN" }],
      [],
    ]);
    expect(await userCanManageArtist(db, userId, COPE.id)).toBe(true);
  });

  it("returns true when the user is in artist_members for this artist", async () => {
    // Admin lookup empty; membership lookup hits.
    const db = makeQueuedMockDb<{ role: string } | { userId: string }>([
      [],
      [{ userId }],
    ]);
    expect(await userCanManageArtist(db, userId, COPE.id)).toBe(true);
  });

  it("returns false when neither admin nor a member", async () => {
    const db = makeQueuedMockDb<{ role: string } | { userId: string }>([
      [],
      [],
    ]);
    expect(await userCanManageArtist(db, userId, COPE.id)).toBe(false);
  });

  it("has the expected return type", () => {
    expectTypeOf(userCanManageArtist).returns.resolves.toEqualTypeOf<boolean>();
  });
});

describe("listArtistsManageableByUser", () => {
  const userId = "user_2abcdefghijklmnop";
  const OTHER = {
    id: "99999999-9999-9999-9999-999999999999",
    name: "Another Artist",
  };

  it("returns every artist when the user is AUCKETS_ADMIN", async () => {
    // Queue: admin lookup hits, then the all-artists select resolves.
    const db = makeQueuedMockDb<
      { role: string } | { id: string; name: string }
    >([
      [{ role: "AUCKETS_ADMIN" }],
      [
        { id: COPE.id, name: COPE.name },
        { id: OTHER.id, name: OTHER.name },
      ],
    ]);
    expect(await listArtistsManageableByUser(db, userId)).toEqual([
      { id: COPE.id, name: COPE.name },
      { id: OTHER.id, name: OTHER.name },
    ]);
  });

  it("returns only the user's member artists when not an admin", async () => {
    // Admin lookup misses; the membership-joined select resolves.
    const db = makeQueuedMockDb<
      { role: string } | { id: string; name: string }
    >([[], [{ id: COPE.id, name: COPE.name }]]);
    expect(await listArtistsManageableByUser(db, userId)).toEqual([
      { id: COPE.id, name: COPE.name },
    ]);
  });

  it("returns an empty list when the user manages no artists", async () => {
    const db = makeQueuedMockDb<
      { role: string } | { id: string; name: string }
    >([[], []]);
    expect(await listArtistsManageableByUser(db, userId)).toEqual([]);
  });
});

// Membership-only variant the site nav uses. Crucially it does NOT have an
// admin-all branch — so it issues a single SELECT (the membership join), not
// the admin-role lookup + all-artists query listArtistsManageableByUser
// does. The single-result queue below proves that: if the function tried a
// second select, it would consume a slot that isn't there.
describe("listArtistMembershipsForUser", () => {
  const userId = "user_2abcdefghijklmnop";

  it("returns the user's member artists from one select (no admin branch)", async () => {
    const db = makeQueuedMockDb<{ id: string; name: string }>([
      [{ id: COPE.id, name: COPE.name }],
    ]);
    expect(await listArtistMembershipsForUser(db, userId)).toEqual([
      { id: COPE.id, name: COPE.name },
    ]);
  });

  it("returns an empty list when the user belongs to no artists", async () => {
    const db = makeQueuedMockDb<{ id: string; name: string }>([[]]);
    expect(await listArtistMembershipsForUser(db, userId)).toEqual([]);
  });
});

describe("listAllArtists", () => {
  const OTHER = {
    id: "99999999-9999-9999-9999-999999999999",
    name: "Another Artist",
  };

  it("returns every artist", async () => {
    const db = makeMockDb([
      { id: COPE.id, name: COPE.name },
      { id: OTHER.id, name: OTHER.name },
    ]);
    expect(await listAllArtists(db)).toEqual([
      { id: COPE.id, name: COPE.name },
      { id: OTHER.id, name: OTHER.name },
    ]);
  });
});
