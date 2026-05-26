// Waterfall: cross-tier placement for offers that didn't get their
// preferred tier on LaunchPad's first pass.
//
// Spec: docs/GAE_SPEC.md §5 Waterfall.
//
// LaunchPad's first pass uses strict tier matching: an offer with
// `tierPreference: { type: 'this_or_worse', tier: 'premium' }` is only
// considered against premium rows. If premium fills before this offer
// is placed, the offer waits here.
//
// Waterfall runs LaunchPad again over the unplaced pool, but with an
// expanded matcher: `this_or_worse` accepts any tier from the preferred
// one downward; `this_or_better` accepts the preferred tier and any
// better one; `any` accepts everything; `specific` is never relaxed
// (these offers either fit their named tier or they don't get placed).
// The venue passed in for each iteration has the already-placed seats
// added to each row's `holds` so LaunchPad's contiguous-runs computation
// "sees" them as unavailable.
//
// Iteration stop condition (per spec): a full pass that places nothing.
// With simple greedy + full expansion, this typically takes one
// productive pass plus one no-op pass to confirm stability. The loop is
// in place for spec compliance and to remain correct under future
// smarter packing where one pass's placements might unlock another.
//
// Tier ordering is inferred from `rowRank`: a tier's "rank" is the
// minimum rowRank of any row in that tier (better tiers have lower
// ranks). Ties broken by tier name. Documented as a working assumption
// in the PR — if a venue ever surfaces interleaved tiers (e.g. premium
// and mid sharing rowRank ranges), the artist should specify the order
// explicitly and we revisit.
//
// Decisions produced here are all `WATERFALLED` (one per placement),
// regardless of whether the underlying inner call labeled them PLACED
// or FIT_RESOLVED. The snapshot carries `preferredTier`, `placedTier`,
// and the original action label so the audit log can reconstruct what
// happened. SKIPPED and ORPHAN_DETECTED decisions from waterfall passes
// keep their original action labels (they're row observations, not
// placements).

import {
  launchPad,
  type LaunchPadResult,
  type TierMatcher,
} from "./launchpad";
import type {
  AllocationDecision,
  RankedOffer,
  SeatAssignment,
  UnplacedOffer,
  VenueArchitecture,
  VenueRow,
} from "./types";

export type WaterfallResult = {
  // Only the placements produced by waterfall passes — does NOT include
  // assignments already made by LaunchPad's first pass.
  assignments: SeatAssignment[];
  // Same: only decisions emitted by waterfall passes.
  decisions: AllocationDecision[];
  // Offers that remain unplaced after all waterfall iterations.
  unplaced: UnplacedOffer[];
};

export function waterfall(
  venue: VenueArchitecture,
  unplacedFromLaunchPad: RankedOffer[],
  alreadyPlaced: SeatAssignment[],
): WaterfallResult {
  if (unplacedFromLaunchPad.length === 0) {
    return { assignments: [], decisions: [], unplaced: [] };
  }

  const tierIdx = buildTierIndex(venue.rows);
  const matcher = makeRelaxedMatcher(tierIdx);

  // Track placed seats by row so we can keep extending the holds list
  // between iterations.
  const extraHolds = new Map<string, Set<string>>();
  for (const a of alreadyPlaced) {
    addToExtraHolds(extraHolds, a.venueRowId, a.seatNumber);
  }

  const accumulatedAssignments: SeatAssignment[] = [];
  const accumulatedDecisions: AllocationDecision[] = [];
  let remaining = unplacedFromLaunchPad;

  while (remaining.length > 0) {
    const workingVenue = venueWithExtraHolds(venue, extraHolds);
    const pass: LaunchPadResult = launchPad(workingVenue, remaining, {
      matcher,
    });

    if (pass.assignments.length === 0) break; // spec stop condition

    for (const a of pass.assignments) {
      accumulatedAssignments.push(a);
      addToExtraHolds(extraHolds, a.venueRowId, a.seatNumber);
    }
    for (const decision of pass.decisions) {
      accumulatedDecisions.push(
        relabelDecisionForWaterfall(decision, venue, tierIdx, remaining),
      );
    }
    remaining = pass.remainingOffers;
  }

  return {
    assignments: accumulatedAssignments,
    decisions: accumulatedDecisions,
    unplaced: remaining.map((o) => ({
      offerId: o.id,
      reason: classifyUnplaced(o, tierIdx),
    })),
  };
}

// Build an ordered index of tier name → integer rank. Lower index =
// "better" tier (closer to rowRank 1).
function buildTierIndex(rows: VenueRow[]): Map<string, number> {
  const minRankByTier = new Map<string, number>();
  for (const row of rows) {
    if (row.tier === undefined) continue;
    const prev = minRankByTier.get(row.tier);
    if (prev === undefined || row.rowRank < prev) {
      minRankByTier.set(row.tier, row.rowRank);
    }
  }
  const sorted = [...minRankByTier.entries()].sort((a, b) => {
    const rankDelta = a[1] - b[1];
    if (rankDelta !== 0) return rankDelta;
    return a[0].localeCompare(b[0]);
  });
  return new Map(sorted.map(([tier], idx) => [tier, idx]));
}

function makeRelaxedMatcher(tierIdx: Map<string, number>): TierMatcher {
  return (offer, row) => {
    const pref = offer.tierPreference;
    if (pref.type === "any") return true;
    if (row.tier === undefined) return false;
    const offerTier = tierIdx.get(pref.tier);
    const rowTier = tierIdx.get(row.tier);
    if (offerTier === undefined || rowTier === undefined) return false;

    switch (pref.type) {
      case "specific":
        // Specific is never relaxed. If LaunchPad's first pass didn't
        // place it, waterfall won't either.
        return offerTier === rowTier;
      case "this_or_worse":
        // "Worse" = larger tier index (further from rowRank 1).
        return rowTier >= offerTier;
      case "this_or_better":
        // "Better" = smaller tier index.
        return rowTier <= offerTier;
    }
  };
}

function venueWithExtraHolds(
  venue: VenueArchitecture,
  extraHolds: Map<string, Set<string>>,
): VenueArchitecture {
  return {
    ...venue,
    rows: venue.rows.map((row) => {
      const extras = extraHolds.get(row.id);
      if (!extras || extras.size === 0) return row;
      const combined = new Set(row.holds);
      for (const seat of extras) combined.add(seat);
      return { ...row, holds: [...combined] };
    }),
  };
}

function addToExtraHolds(
  extraHolds: Map<string, Set<string>>,
  rowId: string,
  seatNumber: string,
): void {
  const existing = extraHolds.get(rowId);
  if (existing === undefined) {
    extraHolds.set(rowId, new Set([seatNumber]));
  } else {
    existing.add(seatNumber);
  }
}

function relabelDecisionForWaterfall(
  decision: AllocationDecision,
  venue: VenueArchitecture,
  tierIdx: Map<string, number>,
  poolDuringPass: RankedOffer[],
): AllocationDecision {
  // Only PLACED / FIT_RESOLVED get relabeled; SKIPPED and ORPHAN_DETECTED
  // are row observations and keep their original action.
  if (decision.action !== "PLACED" && decision.action !== "FIT_RESOLVED") {
    return decision;
  }

  const offer = poolDuringPass.find((o) => o.id === decision.offerId);
  const placedRow = venue.rows.find((r) => r.id === decision.venueRowId);
  const preferredTier =
    offer && offer.tierPreference.type !== "any"
      ? offer.tierPreference.tier
      : undefined;
  const placedTier = placedRow?.tier;
  const tierDistance =
    preferredTier !== undefined && placedTier !== undefined
      ? Math.abs(
          (tierIdx.get(placedTier) ?? 0) - (tierIdx.get(preferredTier) ?? 0),
        )
      : undefined;

  const enrichedSnapshot: Record<string, unknown> = {
    ...decision.snapshot,
    originalAction: decision.action,
    ...(preferredTier !== undefined && { preferredTier }),
    ...(placedTier !== undefined && { placedTier }),
    ...(tierDistance !== undefined && { tierDistance }),
  };

  const reason =
    preferredTier !== undefined && placedTier !== undefined
      ? `waterfalled offer from preferred tier '${preferredTier}' to '${placedTier}'`
      : "waterfalled offer into a relaxed-tier row";

  return {
    action: "WATERFALLED",
    offerId: decision.offerId ?? "",
    venueRowId: decision.venueRowId ?? "",
    reason,
    snapshot: enrichedSnapshot,
  };
}

function classifyUnplaced(
  offer: RankedOffer,
  tierIdx: Map<string, number>,
): UnplacedOffer["reason"] {
  const pref = offer.tierPreference;
  if (pref.type === "any") return "no_fit_anywhere";
  if (!tierIdx.has(pref.tier)) return "no_compatible_tier";
  return "no_fit_anywhere";
}
