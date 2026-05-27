// Presenter for the Show detail "The room right now" RankBoard. Mirrors
// the RankBoard component in design/ui_kits/auckets/screens/Show.jsx
// (lines 291-308) — three stat cells (Your rank, Median offer, Capacity).
//
// Pure formatting: takes the user's rank (or null), the show's aggregate
// offer stats, the provisional fill count, and the show's seat capacity;
// returns display-ready strings. The component renders the strings
// without further math.
//
// The design's "Your rank" sub-text shows "of N offers". We use the same
// pool count the aggregate stats already report — that's the same
// status='pool' | 'placed' filter the rank query uses, so the denominator
// matches the numerator.
//
// The design's "Median offer" sub-text hardcodes "up $2 since 12h ago".
// We don't have historical median snapshots, so a delta would be made-up.
// Substituting a literal descriptor ("across the pool") avoids the
// misleading hardcode while keeping the layout honest.
//
// The design's "Capacity" cell shows "78%" with sub "provisionally
// placed" — that's exactly the calculation we already do for the artist
// dashboards (provisionalFilled / capacity). When capacity is 0 (no
// architecture loaded, or partial-venue activation found no active rows),
// degrade to "—" with a generic sub rather than rendering NaN%.

import type { OfferStats } from "@/lib/db/repositories";
import { formatCents } from "@/lib/money";

const EMPTY = "—";

export type RankBoardView = {
  // Your rank cell. yourRank is null when the user hasn't placed an offer
  // (or has one in a terminal post-binding state — see
  // getUserRankInShowPool). The denominator is `totalOffers` from the
  // active pool aggregate.
  yourRankLabel: string;
  yourRankSub: string;
  // Median price across the pool.
  medianOfferLabel: string;
  medianOfferSub: string;
  // Provisional seats filled vs total capacity.
  capacityLabel: string;
  capacitySub: string;
};

export function presentRankBoard(
  userRank: number | null,
  stats: OfferStats,
  provisionalFilled: number,
  capacity: number,
): RankBoardView {
  const totalOffers = stats.count;
  const offerWord = totalOffers === 1 ? "offer" : "offers";

  const yourRankLabel = userRank === null ? EMPTY : `#${userRank}`;
  const yourRankSub =
    totalOffers === 0
      ? "pool is empty"
      : userRank === null
        ? `${totalOffers} ${offerWord} in pool`
        : `of ${totalOffers} ${offerWord}`;

  const medianOfferLabel =
    stats.medianCents === null ? EMPTY : formatCents(stats.medianCents);
  const medianOfferSub =
    stats.medianCents === null ? "no offers yet" : "across the pool";

  const capacityPct =
    capacity > 0 ? Math.round((provisionalFilled / capacity) * 100) : null;
  const capacityLabel = capacityPct === null ? EMPTY : `${capacityPct}%`;
  const capacitySub =
    capacityPct === null
      ? "provisionally placed"
      : `${provisionalFilled} / ${capacity} provisionally placed`;

  return {
    yourRankLabel,
    yourRankSub,
    medianOfferLabel,
    medianOfferSub,
    capacityLabel,
    capacitySub,
  };
}
