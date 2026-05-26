// Read-path queries for the artists table.

import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { artists } from "../../../../drizzle/schema";

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
