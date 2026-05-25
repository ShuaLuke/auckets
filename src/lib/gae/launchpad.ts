// LaunchPad: row-by-row allocation loop.
//
// Spec: docs/GAE_SPEC.md §2 LaunchPad.
//
// Walks the venue's active rows from best (lowest rowRank) to worst, and
// for each row walks the offer pool in rank order, placing each offer
// into the first contiguous run that fits. When an offer doesn't fit
// anywhere in the row, greedy stops the row right there — the unplaced
// offer stays in the pool for the next row.
//
// Scope of THIS slice (Week 2 slice 3):
//   * Pure greedy. No FitResolver (skip-ahead to find a smaller fit) —
//     that's a separate slice, src/lib/gae/fitresolver.ts.
//   * Placement is positional left-to-right within the first fitting
//     run. No lean awareness (CENTER / LEFT / RIGHT / DUAL_AISLE) — that
//     lands in src/lib/gae/placement.ts.
//   * Tier compatibility: 'any' matches everything; 'specific',
//     'this_or_better', 'this_or_worse' all require an exact tier match
//     in this first pass. Cross-tier waterfalling for the two soft prefs
//     happens in src/lib/gae/waterfall.ts.
//   * `AllocationConfig.allowOrphans` and `orphanPolicy` are read-only
//     for now: orphans are detected and emitted as decisions, no
//     bumping. The "bump_to_next_row" policy is explicitly out-of-MVP
//     per spec §Edge cases §Orphan seats.
//
// This module is internal to the GAE. Once the full pipeline exists,
// the public `allocate()` entry point in index.ts will call launchPad,
// then waterfall, then assemble the AllocationResult.

import { sortRankedOffers } from "./rankkey";
import type {
  AllocationDecision,
  RankedOffer,
  SeatAssignment,
  VenueArchitecture,
  VenueRow,
} from "./types";

export type LaunchPadResult = {
  assignments: SeatAssignment[];
  decisions: AllocationDecision[];
  remainingOffers: RankedOffer[];
};

export function launchPad(
  venue: VenueArchitecture,
  offers: RankedOffer[],
): LaunchPadResult {
  const assignments: SeatAssignment[] = [];
  const decisions: AllocationDecision[] = [];
  let pool = sortRankedOffers(offers);

  for (const row of getActiveRowsByRank(venue)) {
    const runs = contiguousRuns(row);
    if (runs.length === 0) continue; // entire row held; spec: no decision

    const filled = fillRow(row, runs, pool);
    assignments.push(...filled.assignments);
    decisions.push(...filled.decisions);
    if (filled.placedOfferIds.size > 0) {
      pool = pool.filter((o) => !filled.placedOfferIds.has(o.id));
    }
  }

  return { assignments, decisions, remainingOffers: pool };
}

function getActiveRowsByRank(venue: VenueArchitecture): VenueRow[] {
  const activeSet = new Set(venue.activeRowIds);
  return venue.rows
    .filter((r) => activeSet.has(r.id))
    .sort((a, b) => a.rowRank - b.rowRank);
}

// A contiguous block of unheld positions within a row. `positions` are
// indices into row.seatNumbers. Holds split a row into multiple runs;
// a group can only be placed within a single run (no straddling holds).
type Run = {
  positions: number[];
};

function contiguousRuns(row: VenueRow): Run[] {
  const heldSet = new Set(row.holds);
  const runs: Run[] = [];
  let current: number[] = [];

  for (let i = 0; i < row.seatNumbers.length; i++) {
    const seat = row.seatNumbers[i];
    // seatNumbers[i] is guaranteed defined by the loop bound, but
    // noUncheckedIndexedAccess makes us prove it. Skip the slot if the
    // seat label is somehow missing.
    if (seat === undefined) continue;
    if (heldSet.has(seat)) {
      if (current.length > 0) {
        runs.push({ positions: current });
        current = [];
      }
    } else {
      current.push(i);
    }
  }
  if (current.length > 0) runs.push({ positions: current });
  return runs;
}

function isOfferCompatibleWithRow(
  offer: RankedOffer,
  row: VenueRow,
): boolean {
  const pref = offer.tierPreference;
  if (pref.type === "any") return true;
  if (row.tier === undefined) return false;
  // First-pass behavior: every tier-bound preference requires an exact
  // match. Cross-tier waterfalling for 'this_or_better' / 'this_or_worse'
  // is the waterfall slice's job.
  return pref.tier === row.tier;
}

type FillRowResult = {
  assignments: SeatAssignment[];
  decisions: AllocationDecision[];
  placedOfferIds: Set<string>;
};

function fillRow(
  row: VenueRow,
  initialRuns: Run[],
  pool: RankedOffer[],
): FillRowResult {
  const assignments: SeatAssignment[] = [];
  const decisions: AllocationDecision[] = [];
  const placedOfferIds = new Set<string>();
  const runs: Run[] = initialRuns.map((r) => ({ positions: [...r.positions] }));

  for (const offer of pool) {
    if (!isOfferCompatibleWithRow(offer, row)) continue;

    const runIdx = runs.findIndex((r) => r.positions.length >= offer.groupSize);
    if (runIdx === -1) {
      // Greedy stop: first compatible offer that doesn't fit ends the
      // row. The unplaced offer stays in the caller's pool.
      break;
    }

    const run = runs[runIdx]!;
    const consumed = run.positions.splice(0, offer.groupSize);
    const startPosition = consumed[0]!;

    for (const positionIndex of consumed) {
      const seatNumber = row.seatNumbers[positionIndex]!;
      assignments.push({
        offerId: offer.id,
        venueRowId: row.id,
        seatNumber,
        positionIndex,
      });
    }
    decisions.push({
      action: "PLACED",
      offerId: offer.id,
      venueRowId: row.id,
      reason: `placed group of ${offer.groupSize} starting at position ${startPosition}`,
      snapshot: {
        groupSize: offer.groupSize,
        startPosition,
        rankKey: offer.rankKey,
      },
    });
    placedOfferIds.add(offer.id);

    if (run.positions.length === 0) runs.splice(runIdx, 1);
  }

  const orphanCount = runs.reduce((sum, r) => sum + r.positions.length, 0);

  if (placedOfferIds.size === 0) {
    decisions.push({
      action: "SKIPPED",
      venueRowId: row.id,
      reason: "no compatible offer fit available capacity",
      snapshot: {
        availableSeats: orphanCount,
        poolSize: pool.length,
      },
    });
  } else if (orphanCount > 0) {
    decisions.push({
      action: "ORPHAN_DETECTED",
      venueRowId: row.id,
      reason: `${orphanCount} unfilled seat(s) remain in row after greedy placement`,
      snapshot: {
        orphanCount,
        orphanPositions: runs.flatMap((r) => r.positions),
        placedOfferCount: placedOfferIds.size,
      },
    });
  }

  return { assignments, decisions, placedOfferIds };
}
