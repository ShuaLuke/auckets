// Development seed. Run with `npm run db:seed` after `npm run db:migrate`.
//
// Seeds the minimum set of rows we need to develop against:
//   - Citizen Cope (the only artist for MVP per docs/CONTEXT.md)
//   - Cope's place — ~50-cap private venue in Brooklyn (Q7, Q9)
//   - venue_architectures v1 — 4 seated rows + a GA section, totaling 50
//   - One open show ~30 days out, offers already open
//
// Deliberately NOT seeded:
//   - users — Clerk owns user creation; seeding synthetic Clerk-style IDs
//     would create footguns when real sign-ups happen
//   - offers, seat_assignments, tickets — those need real users; come once
//     the offer submission API lands (slice 5)
//   - Lincoln Theatre, Paramount Theatre — separate seed slices when we
//     have real seat-map data
//
// Idempotency: every insert uses upsert-by-fixed-UUID, so re-running the
// seed refreshes data (especially time fields) without duplicating rows.
//
// Per docs/CONVENTIONS.md "All env vars are typed", we'd normally route
// DATABASE_URL through src/lib/env.ts. This script reads process.env
// directly — same pattern as drizzle.config.ts, for the same reason: it
// runs in a plain Node context outside the Next.js request lifecycle, and
// the seed has to bootstrap env loading itself before any module that
// would trigger Zod validation gets imported.

import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  artists,
  shows,
  venueArchitectures,
  venues,
} from "./schema";

// Fixed UUIDs make the seeded rows easy to spot in Drizzle Studio and let
// upsert-by-id stay idempotent without juggling natural keys.
const COPE_ARTIST_ID = "11111111-1111-1111-1111-111111111111";
const COPE_PLACE_VENUE_ID = "22222222-2222-2222-2222-222222222222";
const COPE_PLACE_ARCH_V1_ID = "33333333-3333-3333-3333-333333333333";
const COPE_PLACE_SHOW_ID = "44444444-4444-4444-4444-444444444444";

// Venue row IDs — strings, referenced by activeRowIds on shows and (once
// it exists) by seat_assignments.venue_row_id.
const ROW_A = "row_a";
const ROW_B = "row_b";
const ROW_C = "row_c";
const ROW_D = "row_d";
const ROW_GA = "row_ga";

// The shape stored in venue_architectures.rows (JSONB). Matches
// src/lib/gae/types.ts VenueRow (camelCase) — the GAE consumes this
// directly, so storing camelCase avoids a casing adapter at the read
// boundary.
//
// Note: docs/SCHEMA_PLAN.md §4's example JSONB uses snake_case
// (row_rank, seat_numbers). That's an inconsistency in the plan vs. the
// GAE types; the GAE types win because they're code, not docs. Flagged
// in the PR.
type SeededVenueRow = {
  id: string;
  area: string;
  section: string;
  rowName: string;
  rowRank: number;
  capacity: number;
  parity: "ODD" | "EVEN";
  lean: "CENTER" | "LEFT" | "RIGHT" | "DUAL_AISLE";
  seatNumbers: string[];
  holds: string[];
  tier?: string;
  isGa?: boolean;
};

function range(start: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(start + i));
}

const COPE_PLACE_ROWS: SeededVenueRow[] = [
  {
    id: ROW_A,
    area: "orchestra",
    section: "main",
    rowName: "A",
    rowRank: 1,
    capacity: 8,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: range(1, 8),
    holds: [],
    tier: "premium",
    isGa: false,
  },
  {
    id: ROW_B,
    area: "orchestra",
    section: "main",
    rowName: "B",
    rowRank: 2,
    capacity: 8,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: range(1, 8),
    holds: [],
    tier: "premium",
    isGa: false,
  },
  {
    id: ROW_C,
    area: "orchestra",
    section: "main",
    rowName: "C",
    rowRank: 3,
    capacity: 6,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: range(1, 6),
    holds: [],
    tier: "mid",
    isGa: false,
  },
  {
    id: ROW_D,
    area: "orchestra",
    section: "main",
    rowName: "D",
    rowRank: 4,
    capacity: 6,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: range(1, 6),
    holds: [],
    tier: "mid",
    isGa: false,
  },
  {
    id: ROW_GA,
    area: "ga",
    section: "ga",
    rowName: "GA",
    rowRank: 5,
    capacity: 22,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: Array.from({ length: 22 }, (_, i) => `GA-${i + 1}`),
    holds: [],
    tier: "ga",
    isGa: true,
  },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "drizzle/seed.ts refuses to run when NODE_ENV=production. Seeds " +
        "are dev/staging only. If you really need to seed a prod-equivalent, " +
        "run against staging and back-load via your normal write path.",
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. The seed expects to find it in .env.local. " +
        "If the migration hasn't been applied yet, run `npm run db:migrate` first.",
    );
  }

  const client = postgres(databaseUrl, { prepare: false, max: 1 });
  const db = drizzle(client);

  const now = new Date();
  const offerWindowOpensAt = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
  const doorsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const bindingAllocationAt = new Date(
    doorsAt.getTime() - 24 * 60 * 60 * 1000,
  );

  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(artists)
        .values({
          id: COPE_ARTIST_ID,
          name: "Citizen Cope",
          slug: "citizen-cope",
        })
        .onConflictDoUpdate({
          target: artists.id,
          set: { name: "Citizen Cope", slug: "citizen-cope" },
        });

      await tx
        .insert(venues)
        .values({
          id: COPE_PLACE_VENUE_ID,
          name: "Cope's place",
          city: "Brooklyn, NY",
          // Geo intentionally null — per docs/SCHEMA_PLAN.md §3 Open, a null
          // centroid means "no geo check," appropriate for a private venue.
          geoLat: null,
          geoLon: null,
          geoRadiusM: 500,
        })
        .onConflictDoUpdate({
          target: venues.id,
          set: {
            name: "Cope's place",
            city: "Brooklyn, NY",
            geoRadiusM: 500,
          },
        });

      await tx
        .insert(venueArchitectures)
        .values({
          id: COPE_PLACE_ARCH_V1_ID,
          venueId: COPE_PLACE_VENUE_ID,
          version: 1,
          rows: COPE_PLACE_ROWS,
        })
        .onConflictDoUpdate({
          target: venueArchitectures.id,
          set: { rows: COPE_PLACE_ROWS },
        });

      await tx
        .insert(shows)
        .values({
          id: COPE_PLACE_SHOW_ID,
          artistId: COPE_ARTIST_ID,
          venueId: COPE_PLACE_VENUE_ID,
          venueArchitectureId: COPE_PLACE_ARCH_V1_ID,
          doorsAt,
          offerWindowOpensAt,
          bindingAllocationAt,
          status: "open",
          tierFloorsCents: { premium: 5000, mid: 3500, ga: 2500 },
          maxGroupSize: 10,
          activeRowIds: [ROW_A, ROW_B, ROW_C, ROW_D, ROW_GA],
          // bleacher_* + channel use schema defaults. Cope's NEW-8 still
          // open; safe to ship with bleacher_enabled=false.
        })
        .onConflictDoUpdate({
          target: shows.id,
          set: {
            doorsAt,
            offerWindowOpensAt,
            bindingAllocationAt,
            status: "open",
            tierFloorsCents: { premium: 5000, mid: 3500, ga: 2500 },
            maxGroupSize: 10,
            activeRowIds: [ROW_A, ROW_B, ROW_C, ROW_D, ROW_GA],
          },
        });
    });

    const totalCapacity = COPE_PLACE_ROWS.reduce(
      (sum, r) => sum + r.capacity,
      0,
    );
    console.log("Seed complete:");
    console.log(`  artist:        Citizen Cope (${COPE_ARTIST_ID})`);
    console.log(
      `  venue:         Cope's place — ${totalCapacity}-cap (${COPE_PLACE_VENUE_ID})`,
    );
    console.log(
      `  architecture:  v1, ${COPE_PLACE_ROWS.length} rows (${COPE_PLACE_ARCH_V1_ID})`,
    );
    console.log(
      `  show:          doors ${doorsAt.toISOString().slice(0, 10)}, offers open now (${COPE_PLACE_SHOW_ID})`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
