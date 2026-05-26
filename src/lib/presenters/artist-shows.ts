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
  offers: number;
  medianPrice: string;
  topPrice: string;
  provisionalFilled: number;
  capacity: number;
};

export type ArtistSnapshotStatsView = {
  offersInPool: number;
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
    medianPrice: formatStat(stats.medianCents),
    topPrice: formatStat(stats.topCents),
    provisionalFilled,
    capacity,
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
