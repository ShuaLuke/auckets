import { sql } from "drizzle-orm";
import { beforeEach } from "vitest";

import { db } from "@/lib/db";

// Per-test truncation. CASCADE means we don't have to maintain a child→parent
// order; RESTART IDENTITY resets the (currently unused) sequences too so a
// printed row id from one test never leaks into another.
//
// We list tables explicitly rather than walking pg_catalog because:
//   (a) it forces a code change when a new table is added, which is the
//       right pressure point to think about whether that table needs to
//       be cleared between tests (it almost certainly does);
//   (b) we don't want to ever blow away drizzle's __drizzle_migrations
//       bookkeeping table — re-running migrations on every test would be
//       slow and pointless.
const TABLES_TO_TRUNCATE = [
  "ticket_scans",
  "tickets",
  "seat_assignments",
  "allocation_logs",
  "offer_revisions",
  "offer_idempotency_keys",
  "resales",
  "offers",
  "bond_events",
  "artist_requests",
  "holds",
  "shows",
  "venue_architectures",
  "venues",
  "artist_members",
  "artists",
  "users",
];

beforeEach(async () => {
  await db.execute(
    sql.raw(
      `TRUNCATE TABLE ${TABLES_TO_TRUNCATE.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
    ),
  );
});
