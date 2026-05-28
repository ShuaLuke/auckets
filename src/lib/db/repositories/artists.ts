// Read-path queries for the artists table.

import { and, eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  artistMembers,
  artists,
  users,
} from "../../../../drizzle/schema";

type Artist = typeof artists.$inferSelect;

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
// At MVP scale (one artist) the admin branch returning "all artists" is
// fine; once the roster grows this should become a searchable index page
// rather than a flat nav list. The nav is convenience only — every
// artist/admin page re-checks authorization server-side, so this query
// reveals destinations, it doesn't grant access.
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

  return db
    .select({ id: artists.id, name: artists.name })
    .from(artists)
    .innerJoin(artistMembers, eq(artistMembers.artistId, artists.id))
    .where(eq(artistMembers.userId, userId))
    .orderBy(artists.name);
}
