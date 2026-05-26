// Read-path queries for the venues + venue_architectures tables.
//
// venue_architectures.rows is camelCase JSONB matching src/lib/gae/types.ts —
// the GAE consumes it directly, so we narrow the unknown jsonb type to
// VenueRow[] here and pass through. No other transformation.

import { eq, inArray } from "drizzle-orm";

import type { Db } from "@/lib/db";
import type { VenueRow } from "@/lib/gae/types";
import { venueArchitectures, venues } from "../../../../drizzle/schema";

type Venue = typeof venues.$inferSelect;
type VenueArchitectureRow = typeof venueArchitectures.$inferSelect;

export type VenueArchitecture = Omit<VenueArchitectureRow, "rows"> & {
  rows: VenueRow[];
};

export async function getVenueById(
  db: Db,
  venueId: string,
): Promise<Venue | null> {
  const rows = await db
    .select()
    .from(venues)
    .where(eq(venues.id, venueId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getVenueArchitectureById(
  db: Db,
  architectureId: string,
): Promise<VenueArchitecture | null> {
  const rows = await db
    .select()
    .from(venueArchitectures)
    .where(eq(venueArchitectures.id, architectureId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    rows: row.rows as VenueRow[],
  };
}

// Batched fetcher used by GET /api/shows and GET /api/artists/[id]/shows:
// each show row in the list response references an architecture (for the
// yourOffer.preview / capacity / provisionalFilled view fields), and we
// don't want to fire one architecture query per show. Empty input
// short-circuits to an empty map — otherwise we'd emit
// `WHERE id IN ()` which Postgres rejects.
export async function getVenueArchitecturesByIds(
  db: Db,
  ids: string[],
): Promise<Map<string, VenueArchitecture>> {
  const out = new Map<string, VenueArchitecture>();
  if (ids.length === 0) return out;
  const rows = await db
    .select()
    .from(venueArchitectures)
    .where(inArray(venueArchitectures.id, ids));
  for (const row of rows) {
    out.set(row.id, { ...row, rows: row.rows as VenueRow[] });
  }
  return out;
}
