// Read-path queries for the venues + venue_architectures tables.
//
// venue_architectures.rows is camelCase JSONB matching src/lib/gae/types.ts —
// the GAE consumes it directly, so we narrow the unknown jsonb type to
// VenueRow[] here and pass through. No other transformation.

import { eq } from "drizzle-orm";

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
