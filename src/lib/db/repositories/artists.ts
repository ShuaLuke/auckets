// Read-path queries for the artists table.

import { and, eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  artistMembers,
  artists,
  users,
} from "../../../../drizzle/schema";

type Artist = typeof artists.$inferSelect;

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
