import { describe, expect, expectTypeOf, it } from "vitest";

import type { Db } from "@/lib/db";

import { artistMembers, artists } from "../../../../drizzle/schema";
import {
  addArtistMember,
  createArtist,
  getArtistById,
  getArtistBySlug,
  listAllArtists,
  listArtistMembershipsForUser,
  listArtistsManageableByUser,
  onboardArtist,
  userCanManageArtist,
} from "./artists";
import { makeMockDb, makeQueuedMockDb } from "./_mock-db";

type Artist = typeof artists.$inferSelect;
type ArtistMember = typeof artistMembers.$inferSelect;

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

// --- write path -----------------------------------------------------------

const MEMBER_ROW: ArtistMember = {
  artistId: COPE.id,
  userId: "user_member",
  canManage: true,
  createdAt: new Date("2026-05-01T00:00:00Z"),
};

// A Db whose INSERT rejects with a given Postgres-style error code. Lets us
// exercise createArtist / onboardArtist's unique-violation → typed-result path
// without a real DB (the porsager driver puts the SQLSTATE on err.code).
function makeInsertThrowsDb(code: string): Db {
  const err = Object.assign(new Error("insert failed"), { code });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    values: () => chain,
    onConflictDoNothing: () => chain,
    returning: () => chain,
    then: (_onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
      Promise.reject(err).then(_onF, onR),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    insert: () => chain,
    // onboardArtist runs inside a transaction; pass through so the failing
    // INSERT rejects from within the callback (rolling back, then mapped).
    transaction: async <R>(cb: (tx: Db) => Promise<R>) => cb(db as Db),
  };
  return db as Db;
}

// A recording Db that queues a result per top-level call and counts how many
// times update() was invoked — so onboardArtist tests can assert the role bump
// actually issued an UPDATE, not just flipped a return flag.
function makeRecordingDb(results: unknown[][]): {
  db: Db;
  record: { updateCount: number };
} {
  let i = 0;
  const record = { updateCount: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain = (result: unknown[]): any => ({
    from: () => chain(result),
    values: () => chain(result),
    set: () => chain(result),
    where: () => chain(result),
    onConflictDoNothing: () => chain(result),
    returning: () => chain(result),
    then: (onF: (v: unknown[]) => unknown) => Promise.resolve(onF(result)),
  });
  const next = () => chain(results[i++] ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    insert: () => next(),
    update: () => {
      record.updateCount++;
      return next();
    },
    select: () => next(),
    delete: () => next(),
    transaction: async <R>(cb: (tx: Db) => Promise<R>) => cb(db as Db),
  };
  return { db: db as Db, record };
}

describe("createArtist", () => {
  it("returns ok with the inserted row", async () => {
    const db = makeMockDb([COPE]);
    expect(await createArtist(db, { name: COPE.name, slug: COPE.slug })).toEqual(
      { ok: true, artist: COPE },
    );
  });

  it("maps a unique-violation (23505) to slug_taken", async () => {
    const db = makeInsertThrowsDb("23505");
    expect(
      await createArtist(db, { name: COPE.name, slug: COPE.slug }),
    ).toEqual({ ok: false, reason: "slug_taken" });
  });

  it("rethrows a non-unique-violation error", async () => {
    const db = makeInsertThrowsDb("23502"); // not-null violation
    await expect(
      createArtist(db, { name: COPE.name, slug: COPE.slug }),
    ).rejects.toThrow("insert failed");
  });
});

describe("addArtistMember", () => {
  it("returns the new membership row on a fresh link", async () => {
    const db = makeMockDb([MEMBER_ROW]);
    expect(
      await addArtistMember(db, {
        artistId: COPE.id,
        userId: MEMBER_ROW.userId,
      }),
    ).toEqual(MEMBER_ROW);
  });

  it("returns null when the link already exists (onConflictDoNothing → no row)", async () => {
    // A re-link conflicts on (artist_id, user_id); onConflictDoNothing means
    // RETURNING yields nothing. Idempotent.
    const db = makeMockDb<ArtistMember>([]);
    expect(
      await addArtistMember(db, {
        artistId: COPE.id,
        userId: MEMBER_ROW.userId,
      }),
    ).toBeNull();
  });
});

describe("onboardArtist", () => {
  it("creates the artist with no member when none is given", async () => {
    const db = makeMockDb([COPE]);
    expect(await onboardArtist(db, { name: COPE.name, slug: COPE.slug })).toEqual(
      { ok: true, artist: COPE, memberLinked: false, roleBumped: false },
    );
  });

  it("links a member and bumps their role when bumpToArtist is set", async () => {
    // Queue: artist insert → member insert → (role update consumes a slot).
    const { db, record } = makeRecordingDb([[COPE], [MEMBER_ROW], []]);
    const result = await onboardArtist(db, {
      name: COPE.name,
      slug: COPE.slug,
      member: { userId: MEMBER_ROW.userId, bumpToArtist: true },
    });
    expect(result).toEqual({
      ok: true,
      artist: COPE,
      memberLinked: true,
      roleBumped: true,
    });
    // The bump issued exactly one UPDATE (the role change).
    expect(record.updateCount).toBe(1);
  });

  it("links a member WITHOUT touching their role when bumpToArtist is false", async () => {
    const { db, record } = makeRecordingDb([[COPE], [MEMBER_ROW]]);
    const result = await onboardArtist(db, {
      name: COPE.name,
      slug: COPE.slug,
      member: { userId: MEMBER_ROW.userId, bumpToArtist: false },
    });
    expect(result).toEqual({
      ok: true,
      artist: COPE,
      memberLinked: true,
      roleBumped: false,
    });
    // No UPDATE — an admin / already-elevated member keeps their role.
    expect(record.updateCount).toBe(0);
  });

  it("reports memberLinked:false when the person was already a member", async () => {
    // Member insert hits the conflict → empty RETURNING → null link.
    const { db } = makeRecordingDb([[COPE], []]);
    const result = await onboardArtist(db, {
      name: COPE.name,
      slug: COPE.slug,
      member: { userId: MEMBER_ROW.userId, bumpToArtist: false },
    });
    expect(result).toEqual({
      ok: true,
      artist: COPE,
      memberLinked: false,
      roleBumped: false,
    });
  });

  it("maps a slug collision to slug_taken (transaction rolled back)", async () => {
    const db = makeInsertThrowsDb("23505");
    expect(
      await onboardArtist(db, {
        name: COPE.name,
        slug: COPE.slug,
        member: { userId: MEMBER_ROW.userId, bumpToArtist: true },
      }),
    ).toEqual({ ok: false, reason: "slug_taken" });
  });
});
