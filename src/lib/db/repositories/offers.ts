// Read-path queries for the offers table.
//
// Repositories return raw DB shapes — Date timestamps, integer cents, raw
// enum strings. Formatting (price strings, em-dash for empty pool, etc.)
// lives in src/lib/presenters/.
//
// Active-pool filter for aggregate stats: status IN ('pool', 'placed'). Both
// statuses are live offers contributing to provisional revenue. 'unplaced',
// 'charged', 'refunded', 'resold', 'gifted', 'card_failure' are excluded —
// 'unplaced' didn't make it into a seat, 'charged' is post-binding (no
// longer part of the pre-binding signal the dashboards show), and the rest
// are post-resale or terminal failure states.
//
// Median is computed in Postgres via
//   percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_ticket_cents)
// because the pool can reach 10,000+ rows on a popular show and we'd
// rather not stream all of them into Node just to sort them. Postgres
// returns numeric → we cast to integer at the repository boundary so the
// view layer always sees `number | null`.
//
// Private offers (ADR-0017): `private_threshold_cents` is server-only and
// never leaks to other users. `listOffersForUser` returns the calling
// user's own offers with all fields (they own the data); artist-side
// aggregates DO include private offers (the artist sees their full show
// data); `getOfferByShowAndUser` strictly filters by the calling userId
// so it can only ever return the caller's own offer.

import { and, eq, inArray, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { offers, shows } from "../../../../drizzle/schema";

type Offer = typeof offers.$inferSelect;
type OfferInsert = typeof offers.$inferInsert;

export type OfferStats = {
  count: number;
  medianCents: number | null;
  topCents: number | null;
};

// Statuses that count toward "active pool" aggregates. See the file-level
// comment for why these two and not the rest.
const ACTIVE_POOL_STATUSES = ["pool", "placed"] as const;

// Statuses on the parent show that are still pre-binding — i.e. offer
// pool is meaningfully open and the artist snapshot should aggregate
// across them. 'allocated' / 'complete' are post-binding (seat
// assignments are the source of truth at that point, not offers); 'draft'
// has no real offers yet.
const PRE_BINDING_SHOW_STATUSES = [
  "open",
  "paused",
  "closed",
  "allocating",
] as const;

const EMPTY_STATS: OfferStats = {
  count: 0,
  medianCents: null,
  topCents: null,
};

// percentile_cont returns numeric; postgres-js hands numeric back as a
// string ("4250.5") to avoid silently truncating beyond JS's safe-int
// range. Cents are integer in the schema by invariant, but we still
// floor here to guarantee `number | null` at the view layer.
function parseMedian(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const asNumber = typeof raw === "string" ? Number.parseFloat(raw) : Number(raw);
  if (!Number.isFinite(asNumber)) return null;
  return Math.floor(asNumber);
}

function parseTop(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const asNumber = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(asNumber) ? asNumber : null;
}

export async function getOfferByShowAndUser(
  db: Db,
  showId: string,
  userId: string,
): Promise<Offer | null> {
  // The (show_id, user_id) unique constraint on offers (drizzle/schema.ts
  // line 237) guarantees at-most-one row. `.limit(1)` is belt-and-braces.
  const rows = await db
    .select()
    .from(offers)
    .where(and(eq(offers.showId, showId), eq(offers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listOffersForUser(
  db: Db,
  userId: string,
): Promise<Offer[]> {
  return db.select().from(offers).where(eq(offers.userId, userId));
}

export async function getOfferStatsForShow(
  db: Db,
  showId: string,
): Promise<OfferStats> {
  // Single round-trip. COUNT/MAX/percentile_cont all over the same
  // filtered set; Postgres reads the pool index once. percentile_cont
  // returns NULL on an empty group (so do COUNT-of-rows = 0 and MAX).
  // Mock-Db tests can't verify the SQL itself — that lands when the
  // postgres-js auth issue is resolved and the integration-test slice
  // exercises this against a real DB.
  const rows = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
      medianCents: sql<string | null>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${offers.pricePerTicketCents})`,
      topCents: sql<number | null>`MAX(${offers.pricePerTicketCents})`,
    })
    .from(offers)
    .where(
      and(
        eq(offers.showId, showId),
        inArray(offers.status, [...ACTIVE_POOL_STATUSES]),
      ),
    );

  const row = rows[0];
  if (!row) return EMPTY_STATS;
  return {
    count: Number(row.count) || 0,
    medianCents: parseMedian(row.medianCents),
    topCents: parseTop(row.topCents),
  };
}

export async function getOfferStatsByShowIds(
  db: Db,
  showIds: string[],
): Promise<Map<string, OfferStats>> {
  const out = new Map<string, OfferStats>();
  if (showIds.length === 0) return out;

  // GROUP BY show_id so this is one query, not N. The Artist Dashboard's
  // per-row stats column would otherwise fire one query per row, which on
  // a 50-show backlog turns the page into a 50-query waterfall.
  const rows = await db
    .select({
      showId: offers.showId,
      count: sql<number>`COUNT(*)::int`,
      medianCents: sql<string | null>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${offers.pricePerTicketCents})`,
      topCents: sql<number | null>`MAX(${offers.pricePerTicketCents})`,
    })
    .from(offers)
    .where(
      and(
        inArray(offers.showId, showIds),
        inArray(offers.status, [...ACTIVE_POOL_STATUSES]),
      ),
    )
    .groupBy(offers.showId);

  for (const row of rows) {
    out.set(row.showId, {
      count: Number(row.count) || 0,
      medianCents: parseMedian(row.medianCents),
      topCents: parseTop(row.topCents),
    });
  }

  // Shows with no offers don't appear in the GROUP BY result at all.
  // Backfill them with EMPTY_STATS so callers don't have to special-case
  // the missing-key path.
  for (const showId of showIds) {
    if (!out.has(showId)) {
      out.set(showId, EMPTY_STATS);
    }
  }

  return out;
}

// Insert or update by the (show_id, user_id) UNIQUE constraint. On
// conflict, updates the editable offer fields and stamps revised_at to
// NOW. Submission-time fields (submitted_at, stripe_setup_intent_id,
// stripe_payment_method_id) are insert-only — the original token
// stays bound to the original submission per ADR-0010.
//
// Returns the resulting row plus an `isRevision` flag derived from the
// returned `revised_at` being non-null. The RETURNING clause keeps it
// to one round-trip.
//
// NOTE: this is the only write helper that touches offers in the
// repository layer. The "revise upward only" business rule (price +
// group must increase, never decrease) is NOT enforced here — that
// belongs in the route handler / service layer where the existing
// offer is loaded and compared. The dev stub skips that check by
// design.
export async function upsertOfferForUser(
  db: Db,
  params: Omit<OfferInsert, "rankKey" | "submittedAt" | "revisedAt" | "id" | "status"> & {
    status?: Offer["status"];
  },
): Promise<{ offer: Offer; isRevision: boolean }> {
  const rows = await db
    .insert(offers)
    .values(params)
    .onConflictDoUpdate({
      target: [offers.showId, offers.userId],
      set: {
        groupSize: params.groupSize,
        pricePerTicketCents: params.pricePerTicketCents,
        tierPreference: params.tierPreference,
        preferredTier: params.preferredTier ?? null,
        channel: params.channel ?? "market",
        autoBidEnabled: params.autoBidEnabled ?? false,
        autoBidCapCents: params.autoBidCapCents ?? null,
        autoBidIncrementCents: params.autoBidIncrementCents ?? 500,
        privateThresholdCents: params.privateThresholdCents ?? null,
        revisedAt: sql`NOW()`,
      },
    })
    .returning();

  const row = rows[0];
  if (!row) {
    throw new Error(
      `upsertOfferForUser: no row returned (showId=${params.showId}, userId=${params.userId})`,
    );
  }
  return { offer: row, isRevision: row.revisedAt !== null };
}

export async function getOfferStatsForArtist(
  db: Db,
  artistId: string,
): Promise<OfferStats> {
  // Cross-show snapshot for the ArtistDashboard top-of-page row. Joins
  // shows on artist_id, filters to pre-binding show statuses, then
  // aggregates over the same active-pool offer statuses as the per-show
  // helpers.
  const rows = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
      medianCents: sql<string | null>`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${offers.pricePerTicketCents})`,
      topCents: sql<number | null>`MAX(${offers.pricePerTicketCents})`,
    })
    .from(offers)
    .innerJoin(shows, eq(offers.showId, shows.id))
    .where(
      and(
        eq(shows.artistId, artistId),
        inArray(shows.status, [...PRE_BINDING_SHOW_STATUSES]),
        inArray(offers.status, [...ACTIVE_POOL_STATUSES]),
      ),
    );

  const row = rows[0];
  if (!row) return EMPTY_STATS;
  return {
    count: Number(row.count) || 0,
    medianCents: parseMedian(row.medianCents),
    topCents: parseTop(row.topCents),
  };
}
