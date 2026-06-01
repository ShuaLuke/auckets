// Read-path queries for the artists table.

import { and, eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  artistMembers,
  artists,
  users,
} from "../../../../drizzle/schema";

type Artist = typeof artists.$inferSelect;
type ArtistMember = typeof artistMembers.$inferSelect;

// Accepts the singleton Db or a transaction handle, so the write helpers below
// compose inside onboardArtist's transaction without a cast.
type WriteExecutor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// Postgres unique-violation SQLSTATE. The `postgres` (porsager) driver surfaces
// it as `err.code === "23505"`. Used to turn a slug collision into a typed
// result instead of a raw 500.
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "23505"
  );
}

// Minimal artist shape for building role-aware navigation — id (for the
// link target) + name (for the label). Deliberately not the full Artist
// row; this feeds nav links, not an artist view.
export type ManageableArtist = { id: string; name: string };

export async function getArtistById(
  db: Db,
  artistId: string,
): Promise<Artist | null> {
  const rows = await db
    .select()
    .from(artists)
    .where(eq(artists.id, artistId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getArtistBySlug(
  db: Db,
  slug: string,
): Promise<Artist | null> {
  const rows = await db
    .select()
    .from(artists)
    .where(eq(artists.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

// Authorization helper for artist-scoped read APIs. The caller is allowed if
// they're either an AUCKETS_ADMIN (platform-wide grant) or a member of the
// specific artist via artist_members (per-artist grant). Two SELECTs is
// cheaper to reason about than a UNION here — both are indexed lookups.
//
// Lives in this file rather than a generic auth helper because the privilege
// is "view/manage this artist," which conceptually belongs to the artists
// aggregate. Callers stay declarative: `if (!await userCanManageArtist(...))`.
export async function userCanManageArtist(
  db: Db,
  userId: string,
  artistId: string,
): Promise<boolean> {
  const adminRows = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "AUCKETS_ADMIN")))
    .limit(1);
  if (adminRows.length > 0) return true;

  const memberRows = await db
    .select({ userId: artistMembers.userId })
    .from(artistMembers)
    .where(
      and(
        eq(artistMembers.artistId, artistId),
        eq(artistMembers.userId, userId),
      ),
    )
    .limit(1);
  return memberRows.length > 0;
}

// Lists the artists a user is allowed to manage, for building role-aware
// navigation. Mirrors the grant logic in userCanManageArtist, but returns
// the whole set rather than answering a single-artist yes/no:
//   - AUCKETS_ADMIN  → every artist (platform-wide grant)
//   - everyone else  → only the artists they belong to via artist_members
//
// NOTE: do not use this to render a per-artist nav tab — for an admin it
// returns the entire roster, which floods the header once there's more than
// one artist. The site nav drives its per-artist tabs off
// listArtistMembershipsForUser (membership only) and gives admins a single
// "Artists" index link (/admin/artists) instead. This function remains for
// callers that genuinely want "every artist this user could open."
//
// The nav is convenience only — every artist/admin page re-checks
// authorization server-side, so this query reveals destinations, it doesn't
// grant access.
export async function listArtistsManageableByUser(
  db: Db,
  userId: string,
): Promise<ManageableArtist[]> {
  const adminRows = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "AUCKETS_ADMIN")))
    .limit(1);

  if (adminRows.length > 0) {
    return db
      .select({ id: artists.id, name: artists.name })
      .from(artists)
      .orderBy(artists.name);
  }

  return listArtistMembershipsForUser(db, userId);
}

// Membership-only version of the above: the artists a user belongs to via
// artist_members, with NO admin-all branch. This is what the site nav uses
// to render per-artist tabs, so an admin doesn't get one tab per artist in
// the roster. A real artist member (e.g. Cope) sees a tab per act they're a
// member of — usually one — and nothing else.
export async function listArtistMembershipsForUser(
  db: Db,
  userId: string,
): Promise<ManageableArtist[]> {
  return db
    .select({ id: artists.id, name: artists.name })
    .from(artists)
    .innerJoin(artistMembers, eq(artistMembers.artistId, artists.id))
    .where(eq(artistMembers.userId, userId))
    .orderBy(artists.name);
}

// Every artist on the platform, ordered by name. Backs the admin-only
// /admin/artists index — the searchable roster page that replaces the
// flooded per-artist nav tabs for admins. Caller is responsible for the
// admin gate (the page does notFound() on non-admins).
export async function listAllArtists(db: Db): Promise<ManageableArtist[]> {
  return db
    .select({ id: artists.id, name: artists.name })
    .from(artists)
    .orderBy(artists.name);
}

// ---------------------------------------------------------------------------
// Write path — artist onboarding. Typed-result shape (ok | reason) mirrors the
// guarded transitions in shows.ts (announceShow / pauseShow): the slug UNIQUE
// constraint is the real collision guard, and we surface it as `slug_taken`
// rather than letting a raw Postgres error become a 500.
// ---------------------------------------------------------------------------

export type CreateArtistResult =
  | { ok: true; artist: Artist }
  | { ok: false; reason: "slug_taken" };

// Inserts a new artist. On a slug collision (the artists.slug UNIQUE
// constraint) returns { ok: false, reason: "slug_taken" } so the caller can
// map it to a 409 and the form can say "that slug is in use". Any other error
// is genuinely unexpected and rethrown.
export async function createArtist(
  db: WriteExecutor,
  input: { name: string; slug: string },
): Promise<CreateArtistResult> {
  try {
    const rows = await db.insert(artists).values(input).returning();
    // The INSERT either returns the row or throws — a missing row here would
    // be a driver contract break, so the non-null assertion is safe.
    return { ok: true, artist: rows[0]! };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "slug_taken" };
    throw err;
  }
}

// Links a user to an artist. Idempotent: onConflictDoNothing on the
// (artist_id, user_id) UNIQUE means re-linking the same person is a no-op.
// Returns the new membership row, or null if it already existed (no row comes
// back from a do-nothing conflict) — so callers can tell "linked" from
// "already a member".
export async function addArtistMember(
  db: WriteExecutor,
  input: { artistId: string; userId: string; canManage?: boolean },
): Promise<ArtistMember | null> {
  const rows = await db
    .insert(artistMembers)
    .values({
      artistId: input.artistId,
      userId: input.userId,
      canManage: input.canManage ?? true,
    })
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

// A member to attach during onboarding. `bumpToArtist` is decided by the
// caller (the route bumps a plain FAN → ARTIST so they can actually manage,
// but never touches an AUCKETS_ADMIN) — this repo just applies the decision.
export type OnboardMember = {
  userId: string;
  canManage?: boolean;
  bumpToArtist: boolean;
};

export type OnboardArtistResult =
  | { ok: true; artist: Artist; memberLinked: boolean; roleBumped: boolean }
  | { ok: false; reason: "slug_taken" };

// Creates an artist and (optionally) links its first member + bumps their
// role, all in one transaction — so a slug collision or a failed link can
// never leave a half-onboarded artist behind. The slug violation propagates
// out of the transaction (rolling it back) and is mapped to `slug_taken`
// here; the member statements never run in that case because the artist
// INSERT fails first.
//
// Resolving the member email → userId happens in the route BEFORE this call:
// an email with no AUCKETS account is rejected there, so by the time we're in
// the transaction the member (if any) is known to exist.
export async function onboardArtist(
  db: Db,
  input: { name: string; slug: string; member?: OnboardMember },
): Promise<OnboardArtistResult> {
  try {
    return await db.transaction(async (tx) => {
      const rows = await tx
        .insert(artists)
        .values({ name: input.name, slug: input.slug })
        .returning();
      const artist = rows[0]!;

      let memberLinked = false;
      let roleBumped = false;
      if (input.member) {
        const linked = await addArtistMember(tx, {
          artistId: artist.id,
          userId: input.member.userId,
          canManage: input.member.canManage ?? true,
        });
        memberLinked = linked !== null;
        if (input.member.bumpToArtist) {
          // "ARTIST" is the documented role (CLAUDE.md / ADR-0012). The role
          // column is plain TEXT, so no enum migration is needed.
          await tx
            .update(users)
            .set({ role: "ARTIST" })
            .where(eq(users.id, input.member.userId));
          roleBumped = true;
        }
      }

      return { ok: true, artist, memberLinked, roleBumped };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: "slug_taken" };
    throw err;
  }
}
