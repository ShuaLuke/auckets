// Presenters for the artist-side views of shows. Pure functions: take
// raw repository shapes + per-show offer stats + seat-assignment counts,
// return view shapes ready for JSON serialization.
//
// Two view shapes here:
//
//   ArtistShowSummaryView — per-row on ArtistDashboard.jsx. Extends the
//     fan-side ShowSummaryView with `offers` / `medianPrice` / `topPrice`
//     (from the offer aggregate) plus `provisionalFilled` / `capacity`
//     (from the seat-assignment count + the venue architecture). Empty
//     pool renders an em-dash for the price columns (matches the third
//     row in ArtistDashboard.jsx where the show is upcoming).
//
//   ArtistSnapshotStatsView — the top-of-page snapshot row. Cross-show
//     aggregate over the artist's pre-binding shows. capacityFilled and
//     provisionalPayout from the prototype's snapshot stay deferred —
//     capacityFilled needs a cross-show seat sum + a cross-show capacity
//     sum (a different aggregation shape than what slice 5b ships), and
//     provisionalPayout additionally needs Stripe fee math.
//
// Capacity math: sum of `capacity` over the rows in the architecture
// whose id is in the show's activeRowIds. The architecture stores the
// full venue; activeRowIds is the per-show subset (NEW-4 partial-venue
// activation), so a 624-seat venue could be a 280-seat show.
//
// All money formatting goes through formatCents. The em-dash sentinel is
// "—" (U+2014, the same character the prototype mock uses).

import { formatCents } from "@/lib/money";

import type {
  OfferStats,
  OfferTierBucket,
  ShowSummary,
  VenueArchitecture,
} from "@/lib/db/repositories";

import { DEFAULT_TZ } from "./format";
import {
  presentShowSummary,
  type ShowSummaryView,
} from "./shows";

const EMPTY_POOL_PLACEHOLDER = "—";

export type ArtistShowSummaryView = ShowSummaryView & {
  // Number of distinct offers in the pool — one offer per fan.
  offers: number;
  // Total tickets demanded across all offers (sum of group_size). Surfaces
  // "1 offer for 10 tickets" so the artist sees demand volume, not just
  // unique-fan count.
  ticketsCount: number;
  medianPrice: string;
  topPrice: string;
  provisionalFilled: number;
  capacity: number;
};

export type ArtistSnapshotStatsView = {
  offersInPool: number;
  ticketsInPool: number;
  medianOffer: string;
  topOffer: string;
};

function formatStat(cents: number | null): string {
  return cents === null ? EMPTY_POOL_PLACEHOLDER : formatCents(cents);
}

// Exported so future callers (artist capacity widget, integration
// tests) can derive capacity the same way without re-implementing the
// activeRowIds intersection.
export function computeShowCapacity(
  architecture: Pick<VenueArchitecture, "rows">,
  activeRowIds: readonly string[],
): number {
  const active = new Set(activeRowIds);
  let total = 0;
  for (const row of architecture.rows) {
    if (active.has(row.id)) total += row.capacity;
  }
  return total;
}

export function presentArtistShowSummary(
  summary: ShowSummary,
  stats: OfferStats,
  provisionalFilled: number,
  // The show's venue architecture, OR null if the route handler couldn't
  // resolve it (orphaned row — shouldn't happen with RESTRICT FKs, but
  // we degrade to capacity=0 rather than crash).
  architecture: Pick<VenueArchitecture, "rows"> | null,
  // The show's per-show subset of architecture rows (NEW-4). When null
  // (route handler didn't fetch it), we fall back to summing every row
  // in the architecture, which over-counts a partial-venue show but
  // never under-counts.
  activeRowIds: readonly string[] | null,
  now: Date,
  tz: string = DEFAULT_TZ,
): ArtistShowSummaryView {
  // Artist rows don't carry a fan's offer — pass null so yourOffer is
  // omitted from the base summary view. (The artist's view of their own
  // show is the aggregate, not their own personal offer on it.)
  const base = presentShowSummary(summary, now, tz, null);
  const capacity = architecture
    ? computeShowCapacity(
        architecture,
        activeRowIds ?? architecture.rows.map((r) => r.id),
      )
    : 0;
  return {
    ...base,
    offers: stats.count,
    ticketsCount: stats.ticketsCount,
    medianPrice: formatStat(stats.medianCents),
    topPrice: formatStat(stats.topCents),
    provisionalFilled,
    capacity,
  };
}

// Tier breakdown — one tile per tier option that the OfferComposer
// actually surfaces today (3 buckets). The 4th schema value
// 'this_or_better' isn't exposed by the composer, so any rows that
// somehow have it get folded into the 'anywhere' bucket as a safe
// default — they're at minimum "willing to take anywhere they fit."
// preferredTier is hardcoded to 'premium' for the two tier-bound
// composer options (see OfferComposer notes); the bucket-matching
// here is intentionally lenient on preferredTier so future shows
// with non-premium tiers don't require a presenter rewrite.
export type TierBucketView = {
  key: "premium-only" | "premium-or-below" | "anywhere";
  label: string;
  hint: string;
  offers: number;
  tickets: number;
};

export type TierBreakdownView = {
  buckets: readonly TierBucketView[];
  totalOffers: number;
  totalTickets: number;
};

const TIER_BUCKET_TEMPLATE: ReadonlyArray<{
  key: TierBucketView["key"];
  label: string;
  hint: string;
}> = [
  {
    key: "premium-only",
    label: "Premium only",
    hint: "Place me in premium or not at all.",
  },
  {
    key: "premium-or-below",
    label: "Premium or below",
    hint: "Waterfall me down if premium fills.",
  },
  {
    key: "anywhere",
    label: "Anywhere I fit",
    hint: "I just want a seat.",
  },
];

function bucketKeyFor(
  row: Pick<OfferTierBucket, "tierPreference" | "preferredTier">,
): TierBucketView["key"] {
  if (row.tierPreference === "specific") return "premium-only";
  if (row.tierPreference === "this_or_worse") return "premium-or-below";
  // 'any' AND the deferred 'this_or_better' both fold here. The latter
  // is "I'm willing to go up from this tier" — semantically still
  // "I'll take a seat" once it can't be upgraded, so 'anywhere' is
  // the least-wrong placement until the composer surfaces it.
  return "anywhere";
}

export function presentTierBreakdown(
  rows: readonly OfferTierBucket[],
): TierBreakdownView {
  const counts = new Map<TierBucketView["key"], { offers: number; tickets: number }>();
  for (const t of TIER_BUCKET_TEMPLATE) {
    counts.set(t.key, { offers: 0, tickets: 0 });
  }
  let totalOffers = 0;
  let totalTickets = 0;
  for (const row of rows) {
    const key = bucketKeyFor(row);
    const acc = counts.get(key);
    if (!acc) continue;
    acc.offers += row.count;
    acc.tickets += row.ticketsCount;
    totalOffers += row.count;
    totalTickets += row.ticketsCount;
  }
  const buckets = TIER_BUCKET_TEMPLATE.map((t) => {
    const acc = counts.get(t.key) ?? { offers: 0, tickets: 0 };
    return { ...t, offers: acc.offers, tickets: acc.tickets };
  });
  return { buckets, totalOffers, totalTickets };
}

export function presentArtistSnapshotStats(
  stats: OfferStats,
): ArtistSnapshotStatsView {
  return {
    offersInPool: stats.count,
    ticketsInPool: stats.ticketsCount,
    medianOffer: formatStat(stats.medianCents),
    topOffer: formatStat(stats.topCents),
  };
}
