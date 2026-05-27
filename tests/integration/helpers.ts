// Minimal seed helpers for integration tests. Each helper inserts ONE row
// with sensible defaults and returns the inserted record so the test can
// chain further inserts off the generated UUID.
//
// These intentionally do not use the seed.ts fixed-UUID pattern — every test
// row is created fresh after the per-test TRUNCATE, so UUID stability across
// tests doesn't matter and unique slugs/emails per test avoids accidental
// cross-test coupling if isolation is ever weakened.

import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import {
  artists,
  shows,
  users,
  venueArchitectures,
  venues,
} from "../../drizzle/schema";

type Artist = typeof artists.$inferSelect;
type Show = typeof shows.$inferSelect;
type User = typeof users.$inferSelect;
type Venue = typeof venues.$inferSelect;
type VenueArchitecture = typeof venueArchitectures.$inferSelect;

// Minimal venue row shape — mirrors the camelCase GAE shape used by the
// production seed. We only need enough rows for the offers/artist-requests
// tests to have a referenceable show; placement isn't exercised here.
const DEFAULT_ROWS = [
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

export async function seedUser(
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<User> {
  const id = overrides.id ?? `user_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const email = overrides.email ?? `${id}@example.test`;
  const rows = await db
    .insert(users)
    .values({ id, email, ...overrides })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("seedUser: no row returned");
  return row;
}

export async function seedArtist(
  overrides: Partial<typeof artists.$inferInsert> = {},
): Promise<Artist> {
  const slug = overrides.slug ?? `artist-${randomUUID().slice(0, 8)}`;
  const rows = await db
    .insert(artists)
    .values({ name: "Test Artist", slug, ...overrides })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("seedArtist: no row returned");
  return row;
}

export async function seedVenue(
  overrides: Partial<typeof venues.$inferInsert> = {},
): Promise<Venue> {
  const rows = await db
    .insert(venues)
    .values({ name: "Test Venue", city: "Testville, NY", ...overrides })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("seedVenue: no row returned");
  return row;
}

export async function seedVenueArchitecture(
  venueId: string,
  overrides: Partial<typeof venueArchitectures.$inferInsert> = {},
): Promise<VenueArchitecture> {
  const rows = await db
    .insert(venueArchitectures)
    .values({
      venueId,
      version: 1,
      rows: DEFAULT_ROWS,
      ...overrides,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("seedVenueArchitecture: no row returned");
  return row;
}

// One-call shortcut: artist + venue + architecture + open show wired
// together with sensible timings (offers open now, doors in 30 days).
export async function seedShow(overrides: {
  artistId?: string;
  venueId?: string;
  venueArchitectureId?: string;
  status?: Show["status"];
} = {}): Promise<{
  artist: Artist;
  venue: Venue;
  architecture: VenueArchitecture;
  show: Show;
}> {
  const artist = overrides.artistId
    ? ({ id: overrides.artistId } as Artist)
    : await seedArtist();
  const venue = overrides.venueId
    ? ({ id: overrides.venueId } as Venue)
    : await seedVenue();
  const architecture = overrides.venueArchitectureId
    ? ({ id: overrides.venueArchitectureId } as VenueArchitecture)
    : await seedVenueArchitecture(venue.id);

  const now = new Date();
  const doorsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const bindingAt = new Date(doorsAt.getTime() - 24 * 60 * 60 * 1000);
  const offerWindowOpensAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const rows = await db
    .insert(shows)
    .values({
      artistId: artist.id,
      venueId: venue.id,
      venueArchitectureId: architecture.id,
      doorsAt,
      offerWindowOpensAt,
      bindingAllocationAt: bindingAt,
      status: overrides.status ?? "open",
      tierFloorsCents: { premium: 5000, mid: 3500, ga: 2500 },
      maxGroupSize: 10,
      activeRowIds: ["row_a"],
    })
    .returning();
  const show = rows[0];
  if (!show) throw new Error("seedShow: no row returned");

  return { artist, venue, architecture, show };
}

// Sentinel Stripe IDs for the dev-stub-equivalent inserts in integration
// tests. The offers schema requires non-null payment method / setup intent
// IDs even though the real Stripe path is gated behind ADR-0003.
export const STUB_PAYMENT_METHOD_ID = "pm_test_stub";
export const STUB_SETUP_INTENT_ID = "seti_test_stub";
