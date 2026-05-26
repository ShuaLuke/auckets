// RankKey: how the GAE decides which offer beats which.
//
// Spec: docs/GAE_SPEC.md §The algorithm §1 RankKey, plus §Edge cases
// §Equal-rank offers for the tiebreaker order.
//
// The formula is:
//
//   rankKey = (pricePerTicketCents * GROUP_SIZE_MULTIPLIER) + groupSize
//
// Sorting primarily by price per ticket, with larger groups breaking
// ties at equal price. The multiplier (1000) is large enough that group
// sizes up to 999 never bleed into the price ordering — a $50 offer is
// always ranked above a $49.99 offer regardless of group size. We don't
// expect groups over 10 (AllocationConfig.maxGroupSize defaults to 10
// per ADR-0011; artist can override per show), so 1000 is comfortable.
//
// When rankKey ties, the comparator falls back to earliest submittedAt
// (rewards early commitment without making time the primary signal),
// then lexicographic offerId (deterministic last-resort).
//
// This module is the canonical home for the formula. Storage code that
// persists rankKey on the offer row must call computeRankKey here so
// the formula has exactly one source of truth.

import type { RankedOffer } from "./types";

export const RANK_KEY_GROUP_SIZE_MULTIPLIER = 1000;

export function computeRankKey(
  pricePerTicketCents: number,
  groupSize: number,
): number {
  return pricePerTicketCents * RANK_KEY_GROUP_SIZE_MULTIPLIER + groupSize;
}

// Comparator suitable for Array.prototype.sort. Returns a negative
// number when `a` should rank ahead of `b`. Tiebreaker order:
//   1. higher rankKey ranks first
//   2. earlier submittedAt ranks first
//   3. lexicographically smaller id ranks first
export function compareRankedOffers(a: RankedOffer, b: RankedOffer): number {
  if (a.rankKey !== b.rankKey) {
    return b.rankKey - a.rankKey;
  }
  const timeDelta = a.submittedAt.getTime() - b.submittedAt.getTime();
  if (timeDelta !== 0) {
    return timeDelta;
  }
  return a.id.localeCompare(b.id);
}

// Non-mutating sort. Array.prototype.sort mutates in place, which is a
// surprise for a function in a pure module; callers should be able to
// treat the input as frozen.
export function sortRankedOffers(offers: RankedOffer[]): RankedOffer[] {
  return [...offers].sort(compareRankedOffers);
}
