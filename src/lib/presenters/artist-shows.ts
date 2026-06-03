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
//     aggregate over the artist's pre-binding shows. provisionalPayout
//     from the prototype's snapshot stays deferred — it needs Stripe
//     Connect fee math, which is itself pending the post-ADR-0003
//     Connect Express setup. capacityFilled is wired (2026-05-27 slice)
//     using sum-of-provisional-fills / sum-of-capacities across the
//     artist's pre-binding shows.
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
  // Top offer is kept around as a fallback when the caller hasn't passed
  // the per-show fill totals (capacity-filled needs cross-show data that
  // not every page has handy). Where capacityFilled is present it takes
  // the 4th slot and Top offer rolls into the sub-text; where it isn't,
  // Top offer remains the 4th cell. See SnapshotStats.tsx for the
  // mapping.
  topOffer: string;
  // Brand-tone cell — sum of provisional fills / sum of capacities across
  // the artist's pre-binding shows. "—" + "no shows yet" when there are
  // no pre-binding shows OR no architecture loaded for any of them.
  capacityFilled: string;
  capacityFilledSub: string;
};

const NO_CAPACITY_DATA = "—";
const NO_CAPACITY_SUB = "no shows yet";

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

// --- Change 05.2: per-show confidence header -----------------------------
//
// Opens the artist page to *confidence* on their real, live next show: how
// full it's getting, the demand it's drawing, and — the value-capture pitch —
// what the offers would gross vs what the same seats would have made at face
// (flat) pricing. All aggregates; never an individual fan's offer.
//
// PAY-AS-BID: "projected gross" sums each would-be-placed offer's own resolved
// price (auto-bid settled), not a uniform clearing line. The "face value"
// baseline is those *same placed seats* valued at their tier floor — so the
// lift isolates the uplift the offer model captures and is independent of how
// sold-out the show is. (We deliberately do NOT ship the spec's "fairness
// spread" stat yet — "a fair band" has no agreed definition; flagged for a
// product decision rather than invented.)

export type ShowProjectionCents = {
  // Sum of resolved offer price × seats, over the would-be-placed offers.
  projectedGrossCents: number;
  // The same placed seats valued at their tier floor (flat/face pricing).
  faceValueCents: number;
  // Seats the projection covers (the live placement count).
  placedSeats: number;
};

// Pure: fold a (preview) allocation plan into the projection figures. Kept
// out of the route so it's unit-testable without the GAE. The caller supplies
// resolved per-offer prices and a row→tier map derived from the architecture.
export function computeShowProjection(
  assignmentRows: readonly {
    offerId: string;
    venueRowId: string;
    seatNumbers: readonly string[];
  }[],
  resolvedPriceByOfferId: ReadonlyMap<string, number>,
  tierByRowId: ReadonlyMap<string, string | undefined>,
  tierFloorsCents: Record<string, number>,
): ShowProjectionCents {
  let projectedGrossCents = 0;
  let faceValueCents = 0;
  let placedSeats = 0;
  for (const row of assignmentRows) {
    const seats = row.seatNumbers.length;
    if (seats === 0) continue;
    placedSeats += seats;
    const price = resolvedPriceByOfferId.get(row.offerId);
    if (price !== undefined) projectedGrossCents += price * seats;
    const tier = tierByRowId.get(row.venueRowId);
    const floor = tier !== undefined ? tierFloorsCents[tier] : undefined;
    if (floor !== undefined) faceValueCents += floor * seats;
  }
  return { projectedGrossCents, faceValueCents, placedSeats };
}

export type ShowConfidenceProjectionView = {
  projectedGross: string; // "$13,640.00"
  faceValue: string; // "$11,200.00"
  liftAmount: string; // "+$2,440.00"
  liftPct: number; // 22 — rounded; ≥0 in practice (offers clear the floor)
};

export type ShowConfidenceView = {
  showId: string;
  venue: string;
  city: string | null;
  dateLong: string;
  statusLabel: string;
  closes: string;
  // Fill
  filled: number;
  capacity: number;
  fillPct: number;
  // Demand
  offers: number;
  ticketsCount: number;
  medianPrice: string;
  topPrice: string;
  // Value capture — null when not projectable (no offers, or past the gate).
  projection: ShowConfidenceProjectionView | null;
  // Calm note shown in place of the projection when it isn't available.
  projectionNote: string | null;
};

// Build the lead show's confidence header. `filledOverride` is the live
// placement count when a projection ran (keeps the fill bar consistent with
// the projected gross); falls back to the persisted provisional fill.
export function presentShowConfidence(
  summary: ArtistShowSummaryView,
  projectionCents: ShowProjectionCents | null,
  projectionNote: string | null,
): ShowConfidenceView {
  const filled = projectionCents?.placedSeats ?? summary.provisionalFilled;
  const capacity = summary.capacity;
  const fillPct =
    capacity > 0 ? Math.round((filled / capacity) * 100) : 0;

  let projection: ShowConfidenceProjectionView | null = null;
  if (projectionCents && projectionCents.placedSeats > 0) {
    const lift =
      projectionCents.projectedGrossCents - projectionCents.faceValueCents;
    const liftPct =
      projectionCents.faceValueCents > 0
        ? Math.round((lift / projectionCents.faceValueCents) * 100)
        : 0;
    projection = {
      projectedGross: formatCents(projectionCents.projectedGrossCents),
      faceValue: formatCents(projectionCents.faceValueCents),
      liftAmount: `${lift >= 0 ? "+" : "-"}${formatCents(Math.abs(lift))}`,
      liftPct,
    };
  }

  return {
    showId: summary.id,
    venue: summary.venue,
    city: summary.city,
    dateLong: summary.dateLong,
    statusLabel: summary.statusLabel,
    closes: summary.closes,
    filled,
    capacity,
    fillPct,
    offers: summary.offers,
    ticketsCount: summary.ticketsCount,
    medianPrice: summary.medianPrice,
    topPrice: summary.topPrice,
    projection,
    projectionNote: projection ? null : projectionNote,
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

// totals defaults to zeros so callers that haven't computed cross-show
// fill yet keep working — the capacityFilled cell just renders "—" /
// "no shows yet" in that case rather than NaN%.
export function presentArtistSnapshotStats(
  stats: OfferStats,
  totals: { totalFilled: number; totalCapacity: number } = {
    totalFilled: 0,
    totalCapacity: 0,
  },
): ArtistSnapshotStatsView {
  const capacityFilled =
    totals.totalCapacity > 0
      ? `${Math.round((totals.totalFilled / totals.totalCapacity) * 100)}%`
      : NO_CAPACITY_DATA;
  const capacityFilledSub =
    totals.totalCapacity > 0
      ? `${totals.totalFilled} / ${totals.totalCapacity} provisionally placed`
      : NO_CAPACITY_SUB;
  return {
    offersInPool: stats.count,
    ticketsInPool: stats.ticketsCount,
    medianOffer: formatStat(stats.medianCents),
    topOffer: formatStat(stats.topCents),
    capacityFilled,
    capacityFilledSub,
  };
}
