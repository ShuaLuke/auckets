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

import { and, desc, eq, gt, inArray, lt, lte, or, sql } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  artists,
  offerRevisions,
  offers,
  seatAssignments,
  shows,
  venues,
} from "../../../../drizzle/schema";

export type Offer = typeof offers.$inferSelect;
type OfferInsert = typeof offers.$inferInsert;

export type OfferStats = {
  // Number of offers in the pool. One offer can request multiple
  // tickets via groupSize — see ticketsCount for total seats demanded.
  count: number;
  // SUM(group_size) over the same offers in `count`. Surfaces "1 offer
  // for 10 tickets" — useful for the artist's view since a small
  // count can still represent a large amount of demand.
  ticketsCount: number;
  medianCents: number | null;
  topCents: number | null;
};

// One bucket of the per-show tier breakdown. Mirrors the OfferComposer's
// three tier options (drives the labels artists/fans both see):
//   "Premium only"      → tier_preference='specific'      preferred='premium'
//   "Premium or below"  → tier_preference='this_or_worse' preferred='premium'
//   "Anywhere I fit"    → tier_preference='any'           preferred IS NULL
// The remaining 4th schema value ('this_or_better') exists in the table
// but isn't surfaced in any UI today. It rolls up under preferredTier=null
// in the breakdown for now; an explicit tile lands when the composer
// starts offering it.
export type OfferTierBucket = {
  tierPreference: "specific" | "this_or_better" | "this_or_worse" | "any";
  preferredTier: string | null;
  count: number;
  ticketsCount: number;
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
  ticketsCount: 0,
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

// Single offer by id. Used by the card-failure recovery route to load the
// offer for ownership + status + window checks before charging a new card.
export async function getOfferById(
  db: Db,
  offerId: string,
): Promise<Offer | null> {
  const rows = await db
    .select()
    .from(offers)
    .where(eq(offers.id, offerId))
    .limit(1);
  return rows[0] ?? null;
}

export type ExpiredCardFailure = {
  offerId: string;
  seatAssignmentId: string;
};

// Card-failure offers whose recovery window has lapsed — the work list for the
// expiry cron. An offer is in 'card_failure' and its binding seat assignment
// carries the card_failure_at stamp; this returns those whose stamp is at or
// before the cutoff (now − window). The expiry releases the seat (offer →
// unplaced, assignment deleted) per offer.
export async function listExpiredCardFailures(
  db: Db,
  cutoff: Date,
): Promise<ExpiredCardFailure[]> {
  const rows = await db
    .select({
      offerId: offers.id,
      seatAssignmentId: seatAssignments.id,
    })
    .from(offers)
    .innerJoin(seatAssignments, eq(seatAssignments.offerId, offers.id))
    .where(
      and(
        eq(offers.status, "card_failure"),
        eq(seatAssignments.isBinding, true),
        lte(seatAssignments.cardFailureAt, cutoff),
      ),
    );
  return rows;
}

// Look up the offer backing a Stripe PaymentIntent — the join the webhook
// handler uses to map a payment_intent.* event back to its offer. The real
// path writes a unique pi_… per live offer (revision cancels the old PI and
// stores a new one), so at most one current offer references a given id;
// `.limit(1)` guards the type regardless.
export async function getOfferByPaymentIntentId(
  db: Db,
  paymentIntentId: string,
): Promise<Offer | null> {
  const rows = await db
    .select()
    .from(offers)
    .where(eq(offers.stripePaymentIntentId, paymentIntentId))
    .limit(1);
  return rows[0] ?? null;
}

// Bid history view: one row per offer the user has placed, across all
// shows (open + paused + closed + allocating + allocated + complete).
// Joins enough show/artist/venue context so the presenter can render
// each bid card without a follow-up query.
//
// Ordering: by submittedAt DESC so the most recent bid is first. (The
// caller still sees the current state of each offer — there's no
// revision history yet; that's parked as a follow-up per
// project_offer_revision_history memory.)
export type UserBidRow = {
  offer: Offer;
  show: {
    id: string;
    status: typeof shows.$inferSelect.status;
    doorsAt: Date;
    bindingAllocationAt: Date;
    pausedAt: Date | null;
    artistName: string;
    venueName: string;
    venueCity: string | null;
  };
};

export async function listBidsForUser(
  db: Db,
  userId: string,
): Promise<UserBidRow[]> {
  const rows = await db
    .select({
      offer: offers,
      showId: shows.id,
      showStatus: shows.status,
      doorsAt: shows.doorsAt,
      bindingAllocationAt: shows.bindingAllocationAt,
      pausedAt: shows.pausedAt,
      artistName: artists.name,
      venueName: venues.name,
      venueCity: venues.city,
    })
    .from(offers)
    .innerJoin(shows, eq(offers.showId, shows.id))
    .innerJoin(artists, eq(shows.artistId, artists.id))
    .innerJoin(venues, eq(shows.venueId, venues.id))
    .where(eq(offers.userId, userId))
    .orderBy(desc(offers.submittedAt));

  return rows.map((row) => ({
    offer: row.offer,
    show: {
      id: row.showId,
      status: row.showStatus,
      doorsAt: row.doorsAt,
      bindingAllocationAt: row.bindingAllocationAt,
      pausedAt: row.pausedAt,
      artistName: row.artistName,
      venueName: row.venueName,
      venueCity: row.venueCity,
    },
  }));
}

// All offers in the current allocation pool for a show. Drives the
// allocation engine's input — preview and binding runs both read the
// 'pool' state (preview doesn't mutate offer.status, so the canonical
// pool is the same regardless of how many preview runs have happened).
//
// Ordering: by submittedAt ascending so ties in rank_key break by
// arrival time. GAE's RankKey already orders by price × 1000 + group
// size, but two offers with the same RankKey tie-break by who got
// here first. Postgres index `offers_pool_idx (show_id, status,
// rank_key DESC)` doesn't help us much here since we sort by a
// different key — Postgres will sort in memory. For 10,000-row pools
// that's ~5ms; acceptable.
export async function listPoolOffersForShow(
  db: Db,
  showId: string,
): Promise<Offer[]> {
  return db
    .select()
    .from(offers)
    .where(and(eq(offers.showId, showId), eq(offers.status, "pool")))
    .orderBy(offers.submittedAt);
}

// Most-recent offers (across all statuses) for a show, used by the
// ShowAdmin Recent activity feed. Drives the "New offer / Revised"
// derivation in the presenter — each row yields up to two events
// (submitted, plus revised if revisedAt is not null).
//
// LIMIT 50 caps the scan: even if a show ends up with 50 distinct
// offers, the feed only renders ~10 events. The LIMIT is the safety
// net for a pathological case (50k-offer show) where SELECT * without
// it would stream too much; ORDER BY submittedAt DESC means we always
// keep the most recent edge.
export async function listRecentOffersForShow(
  db: Db,
  showId: string,
  limit = 50,
): Promise<Offer[]> {
  return db
    .select()
    .from(offers)
    .where(eq(offers.showId, showId))
    .orderBy(desc(offers.submittedAt))
    .limit(limit);
}

// 1-indexed rank of the caller's offer within this show's active pool, or
// null if the user has no offer in the pool. Active pool is the same
// status filter as the aggregate stats: 'pool' + 'placed' (both live,
// both contributing to provisional revenue; 'unplaced' / 'charged' /
// 'refunded' / 'resold' / 'gifted' / 'card_failure' are excluded).
//
// Rank ordering is rank_key DESC, then submitted_at ASC — the same tiebreak
// the GAE uses. Higher rank_key = better seat; ties broken by who got here
// first. The user's rank is (count of offers ranked strictly above the
// user's offer) + 1.
//
// Two queries instead of one CTE because Drizzle's query builder is more
// readable that way and the second query is a single COUNT(*) — fast even
// on a 10k-offer show. Total page cost is +1 round trip vs +0.
export async function getUserRankInShowPool(
  db: Db,
  showId: string,
  userId: string,
): Promise<number | null> {
  const userOffer = await getOfferByShowAndUser(db, showId, userId);
  if (!userOffer) return null;
  // Offers post-binding ('charged' / 'refunded' / etc) shouldn't show a
  // pre-binding rank — they're past the point where "rank in the pool" is
  // a meaningful concept. Return null so the presenter can hide the cell.
  if (userOffer.status !== "pool" && userOffer.status !== "placed") {
    return null;
  }

  const rows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(offers)
    .where(
      and(
        eq(offers.showId, showId),
        inArray(offers.status, ["pool", "placed"]),
        or(
          gt(offers.rankKey, userOffer.rankKey),
          and(
            eq(offers.rankKey, userOffer.rankKey),
            lt(offers.submittedAt, userOffer.submittedAt),
          ),
        ),
      ),
    );
  const above = rows[0]?.count ?? 0;
  return above + 1;
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
      ticketsCount: sql<number>`COALESCE(SUM(${offers.groupSize}), 0)::int`,
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
    ticketsCount: Number(row.ticketsCount) || 0,
    medianCents: parseMedian(row.medianCents),
    topCents: parseTop(row.topCents),
  };
}

// The "marginal price to get in" for a show: the lowest price-per-ticket
// among offers that currently hold a provisional seat. We read it off the
// seat_assignments → offers join rather than offers.status because seat
// assignments are the GAE's authoritative "this offer is placed" signal
// (a non-binding preview run writes assignments without necessarily
// transitioning offer status). Returns null when nothing is placed yet —
// the presenter falls back to the tier floor in that case.
export async function getMarginalPlacedPriceForShow(
  db: Db,
  showId: string,
): Promise<number | null> {
  const rows = await db
    .select({
      minCents: sql<number | null>`MIN(${offers.pricePerTicketCents})`,
    })
    .from(seatAssignments)
    .innerJoin(offers, eq(offers.id, seatAssignments.offerId))
    .where(eq(seatAssignments.showId, showId));

  const raw = rows[0]?.minCents;
  if (raw === null || raw === undefined) return null;
  return Math.floor(Number(raw));
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
      ticketsCount: sql<number>`COALESCE(SUM(${offers.groupSize}), 0)::int`,
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
      ticketsCount: Number(row.ticketsCount) || 0,
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

// Offer counts broken out by status, per show — one grouped query keyed by
// (show_id, status). Drives the admin command center's capture-health metric
// and the post-binding reconciliation surface (charged vs card_failure vs
// unplaced). Shows/statuses with no rows simply don't appear; callers read a
// missing key as zero. Mock-Db tests can't verify the SQL itself (same
// caveat as getOfferStatsByShowIds) — it's exercised by the integration
// suite against a real DB.
export type OfferStatusCounts = Partial<Record<string, number>>;

export async function getOfferStatusCountsByShowIds(
  db: Db,
  showIds: string[],
): Promise<Map<string, OfferStatusCounts>> {
  const out = new Map<string, OfferStatusCounts>();
  if (showIds.length === 0) return out;

  const rows = await db
    .select({
      showId: offers.showId,
      status: offers.status,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(offers)
    .where(inArray(offers.showId, showIds))
    .groupBy(offers.showId, offers.status);

  for (const row of rows) {
    let bucket = out.get(row.showId);
    if (!bucket) {
      bucket = {};
      out.set(row.showId, bucket);
    }
    bucket[row.status] = Number(row.count) || 0;
  }

  return out;
}

// Insert or update by the (show_id, user_id) UNIQUE constraint. On
// conflict, updates the editable offer fields and stamps revised_at to
// NOW. Submission-time fields (submitted_at, stripe_setup_intent_id,
// stripe_payment_method_id) are insert-only — the original token
// stays bound to the original submission per ADR-0010.
//
// Wraps the upsert + the offer_revisions write in a single transaction
// so audit-trail capture is atomic with the offer change. A revision
// row is written on EVERY upsert (both first INSERT and every UPDATE):
// the row records the post-write state, so walking offer_revisions
// ORDER BY recorded_at ASC reconstructs the offer's full timeline.
//
// Returns the resulting row plus an `isRevision` flag derived from the
// returned `revised_at` being non-null.
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
  return db.transaction(async (tx) => {
    const rows = await tx
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
          // Stripe auth refs MUST be updated on revision too. Omitting
          // them here was a real bug: a fan who revised their offer
          // (e.g. raised price/group) kept pointing at the ORIGINAL
          // PaymentIntent, so binding tried to capture the new, larger
          // amount against the old (smaller, and on the real path
          // since-cancelled) authorization — Stripe rejected it and the
          // offer landed in card_failure. Coalesce the two intent
          // columns to null so the row reflects exactly the submitting
          // path (real → payment_intent; stub → setup_intent) and still
          // satisfies offers_stripe_intent_check (>= 1 of the two set).
          stripePaymentMethodId: params.stripePaymentMethodId,
          stripeSetupIntentId: params.stripeSetupIntentId ?? null,
          stripePaymentIntentId: params.stripePaymentIntentId ?? null,
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

    await tx.insert(offerRevisions).values({
      offerId: row.id,
      snapshot: {
        groupSize: row.groupSize,
        pricePerTicketCents: row.pricePerTicketCents,
        tierPreference: row.tierPreference,
        preferredTier: row.preferredTier,
        channel: row.channel,
        autoBidEnabled: row.autoBidEnabled,
        autoBidCapCents: row.autoBidCapCents,
        autoBidIncrementCents: row.autoBidIncrementCents,
        privateThresholdCents: row.privateThresholdCents,
        status: row.status,
        // Record the Stripe auth refs in history too, so we can always
        // see which PaymentIntent/SetupIntent backed each version of the
        // offer — the detail we lacked when diagnosing the capture bug.
        stripePaymentMethodId: row.stripePaymentMethodId,
        stripeSetupIntentId: row.stripeSetupIntentId,
        stripePaymentIntentId: row.stripePaymentIntentId,
      },
    });

    return { offer: row, isRevision: row.revisedAt !== null };
  });
}

// Read-path helpers for the revision history.

export type OfferRevision = typeof offerRevisions.$inferSelect;

// One offer's full history, oldest-first. The caller pairs adjacent
// snapshots to render diffs ($30 → $40), and the final row's snapshot
// matches the live offers row.
export async function listOfferRevisionsForOffer(
  db: Db,
  offerId: string,
): Promise<OfferRevision[]> {
  return db
    .select()
    .from(offerRevisions)
    .where(eq(offerRevisions.offerId, offerId))
    .orderBy(offerRevisions.recordedAt);
}

// Offer-price distribution for the ShowAdmin distribution histogram.
// Buckets are fixed-width below $50, then widening tiers above (matches
// the prototype mock in ShowAdmin.jsx). Returned ordered by bucket
// index ASC.
//
// Filtered to the active pool (status IN 'pool' | 'placed') — same
// filter the other aggregate helpers use, so the histogram totals
// match the BigStats "Offers" count.
export type PriceDistributionBucket = {
  bucketIndex: number;
  count: number;
};

export async function getPriceDistributionForShow(
  db: Db,
  showId: string,
): Promise<PriceDistributionBucket[]> {
  const rows = await db
    .select({
      bucketIndex: sql<number>`CASE
        WHEN ${offers.pricePerTicketCents} < 1500 THEN 0
        WHEN ${offers.pricePerTicketCents} < 2000 THEN 1
        WHEN ${offers.pricePerTicketCents} < 2500 THEN 2
        WHEN ${offers.pricePerTicketCents} < 3000 THEN 3
        WHEN ${offers.pricePerTicketCents} < 3500 THEN 4
        WHEN ${offers.pricePerTicketCents} < 4000 THEN 5
        WHEN ${offers.pricePerTicketCents} < 5000 THEN 6
        WHEN ${offers.pricePerTicketCents} < 7500 THEN 7
        WHEN ${offers.pricePerTicketCents} < 10000 THEN 8
        ELSE 9
      END`,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(offers)
    .where(
      and(
        eq(offers.showId, showId),
        inArray(offers.status, [...ACTIVE_POOL_STATUSES]),
      ),
    )
    .groupBy(
      sql`CASE
        WHEN ${offers.pricePerTicketCents} < 1500 THEN 0
        WHEN ${offers.pricePerTicketCents} < 2000 THEN 1
        WHEN ${offers.pricePerTicketCents} < 2500 THEN 2
        WHEN ${offers.pricePerTicketCents} < 3000 THEN 3
        WHEN ${offers.pricePerTicketCents} < 3500 THEN 4
        WHEN ${offers.pricePerTicketCents} < 4000 THEN 5
        WHEN ${offers.pricePerTicketCents} < 5000 THEN 6
        WHEN ${offers.pricePerTicketCents} < 7500 THEN 7
        WHEN ${offers.pricePerTicketCents} < 10000 THEN 8
        ELSE 9
      END`,
    );
  return rows.map((row) => ({
    bucketIndex: Number(row.bucketIndex),
    count: Number(row.count) || 0,
  }));
}

// Bulk: all revisions for several offers (e.g. the user's full
// /offers history in one query). Returned as a Map<offerId, OfferRevision[]>
// with each list already oldest-first. Empty input → empty map; empty
// keys are NOT backfilled because callers iterate over their offers
// list and ?? [] their way to a clean view.
export async function listOfferRevisionsByOfferIds(
  db: Db,
  offerIds: string[],
): Promise<Map<string, OfferRevision[]>> {
  const out = new Map<string, OfferRevision[]>();
  if (offerIds.length === 0) return out;
  const rows = await db
    .select()
    .from(offerRevisions)
    .where(inArray(offerRevisions.offerId, offerIds))
    .orderBy(offerRevisions.recordedAt);
  for (const row of rows) {
    const bucket = out.get(row.offerId);
    if (bucket) bucket.push(row);
    else out.set(row.offerId, [row]);
  }
  return out;
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
      ticketsCount: sql<number>`COALESCE(SUM(${offers.groupSize}), 0)::int`,
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
    ticketsCount: Number(row.ticketsCount) || 0,
    medianCents: parseMedian(row.medianCents),
    topCents: parseTop(row.topCents),
  };
}

// Per-tier breakdown for the artist's show-admin page. Groups by
// (tier_preference, preferred_tier) over the active pool so the UI
// can render one tile per visible tier option. Single round-trip;
// callers fold the rows into the three composer-visible buckets in
// the presenter.
export async function getOfferStatsByTierForShow(
  db: Db,
  showId: string,
): Promise<OfferTierBucket[]> {
  const rows = await db
    .select({
      tierPreference: offers.tierPreference,
      preferredTier: offers.preferredTier,
      count: sql<number>`COUNT(*)::int`,
      ticketsCount: sql<number>`COALESCE(SUM(${offers.groupSize}), 0)::int`,
    })
    .from(offers)
    .where(
      and(
        eq(offers.showId, showId),
        inArray(offers.status, [...ACTIVE_POOL_STATUSES]),
      ),
    )
    .groupBy(offers.tierPreference, offers.preferredTier);
  return rows.map((row) => ({
    // The shows.tier_preference column is typed `text` in the schema so
    // Drizzle hands it back as a plain `string`. The schema CHECK
    // constraint restricts it to the four enum values, so the narrowing
    // cast is safe — any value outside the union would have been
    // rejected at insert time.
    tierPreference: row.tierPreference as OfferTierBucket["tierPreference"],
    preferredTier: row.preferredTier,
    count: Number(row.count) || 0,
    ticketsCount: Number(row.ticketsCount) || 0,
  }));
}
