// Presenters for the artist-side views of shows. Pure functions: take
// raw repository shapes + per-show offer stats, return view shapes ready
// for JSON serialization.
//
// Two view shapes here:
//
//   ArtistShowSummaryView — per-row on ArtistDashboard.jsx. Extends the
//     fan-side ShowSummaryView with `offers` / `medianPrice` / `topPrice`,
//     matching the prototype field names verbatim. Empty pool renders an
//     em-dash for the price columns (matches the third row in
//     ArtistDashboard.jsx where the show is upcoming and the pool is 0).
//
//   ArtistSnapshotStatsView — the top-of-page snapshot row. Cross-show
//     aggregate over the artist's pre-binding shows. capacityFilled and
//     provisionalPayout from the prototype stay deferred — they need
//     seat_assignments, which a later slice owns.
//
// All money formatting goes through formatCents. The em-dash sentinel is
// "—" (U+2014, the same character the prototype mock uses).

import { formatCents } from "@/lib/money";

import type {
  OfferStats,
  ShowSummary,
} from "@/lib/db/repositories";

import { DEFAULT_TZ } from "./format";
import {
  presentShowSummary,
  type ShowSummaryView,
} from "./shows";

const EMPTY_POOL_PLACEHOLDER = "—";

export type ArtistShowSummaryView = ShowSummaryView & {
  offers: number;
  medianPrice: string;
  topPrice: string;
};

export type ArtistSnapshotStatsView = {
  offersInPool: number;
  medianOffer: string;
  topOffer: string;
};

function formatStat(cents: number | null): string {
  return cents === null ? EMPTY_POOL_PLACEHOLDER : formatCents(cents);
}

export function presentArtistShowSummary(
  summary: ShowSummary,
  stats: OfferStats,
  now: Date,
  tz: string = DEFAULT_TZ,
): ArtistShowSummaryView {
  // Artist rows don't carry a fan's offer — pass null so yourOffer is
  // omitted from the base summary view. (The artist's view of their own
  // show is the aggregate, not their own personal offer on it.)
  const base = presentShowSummary(summary, now, tz, null);
  return {
    ...base,
    offers: stats.count,
    medianPrice: formatStat(stats.medianCents),
    topPrice: formatStat(stats.topCents),
  };
}

export function presentArtistSnapshotStats(
  stats: OfferStats,
): ArtistSnapshotStatsView {
  return {
    offersInPool: stats.count,
    medianOffer: formatStat(stats.medianCents),
    topOffer: formatStat(stats.topCents),
  };
}
