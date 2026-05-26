// LaunchPad: row-by-row allocation loop.
//
// Spec: docs/GAE_SPEC.md §2 LaunchPad (orchestration) + §3 FitResolver
// (the skip-ahead helper that ships with this module as of slice 12).
//
// Walks the venue's active rows from best (lowest rowRank) to worst, and
// for each row walks the offer pool in rank order. For each offer:
//
//   1. If it fits a remaining contiguous run, place it there.
//   2. Otherwise, ask FitResolver to scan forward in the rank-ordered
//      pool for the next compatible offer that DOES fit. If one is
//      found, place it and emit a FIT_RESOLVED decision listing the
//      skipped offers. If nothing forward fits, the row is done.
//
// The skipped offers stay in the pool — they're reconsidered on the
// next row. FitResolver only defers, it never rejects.
//
// Scope still deferred to later slices (called out individually):
//   * Placement is left-to-right within the first fitting run. No lean
//     awareness (CENTER / LEFT / RIGHT / DUAL_AISLE) yet — that's the
//     placement slice.
//   * Tier prefs `this_or_better` and `this_or_worse` are treated as
//     exact-tier-only in this first pass. Cross-tier waterfalling for
//     them happens in the waterfall slice, run after LaunchPad.
//   * `AllocationConfig.allowOrphans` and `orphanPolicy` are not yet
//     read: orphans are detected and emitted as decisions, no bumping.
//     The "bump_to_next_row" policy is explicitly out-of-MVP per spec
//     §Edge cases §Orphan seats.
//
// This module is internal to the GAE. The public `allocate()` entry
// point in index.ts will eventually call launchPad, then waterfall,
// then assemble an AllocationResult.

import { scanForwardFit } from "./fitresolver";
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
  return pref.tier === row.tier;
}

type PlacementSeats = { startPosition: number; positions: number[] };

function consumeRun(
  runs: Run[],
  runIdx: number,
  groupSize: number,
): PlacementSeats {
  const run = runs[runIdx]!;
  const positions = run.positions.splice(0, groupSize);
  if (run.positions.length === 0) runs.splice(runIdx, 1);
  return { startPosition: positions[0]!, positions };
}

function makeAssignments(
  offer: RankedOffer,
  row: VenueRow,
  positions: number[],
): SeatAssignment[] {
  return positions.map((positionIndex) => ({
    offerId: offer.id,
    venueRowId: row.id,
    seatNumber: row.seatNumbers[positionIndex]!,
    positionIndex,
  }));
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

  let i = 0;
  while (i < pool.length) {
    const current = pool[i]!;
    if (!isOfferCompatibleWithRow(current, row)) {
      i++;
      continue;
    }

    const directRunIdx = runs.findIndex(
      (r) => r.positions.length >= current.groupSize,
    );
    if (directRunIdx !== -1) {
      const seats = consumeRun(runs, directRunIdx, current.groupSize);
      assignments.push(...makeAssignments(current, row, seats.positions));
      decisions.push({
        action: "PLACED",
        offerId: current.id,
        venueRowId: row.id,
        reason: `placed group of ${current.groupSize} starting at position ${seats.startPosition}`,
        snapshot: {
          groupSize: current.groupSize,
          startPosition: seats.startPosition,
          rankKey: current.rankKey,
        },
      });
      placedOfferIds.add(current.id);
      i++;
      continue;
    }

    // Direct miss — scan forward for a smaller compatible fit.
    const scan = scanForwardFit(
      pool,
      i + 1,
      runs.map((r) => ({ length: r.positions.length })),
      (o) => isOfferCompatibleWithRow(o, row),
    );

    if (scan.foundIdx === -1) {
      // Nothing forward fits either. Row is done; current and any
      // forward non-fits stay in the pool for the next row.
      break;
    }

    const resolved = pool[scan.foundIdx]!;
    const seats = consumeRun(runs, scan.foundRunIdx, resolved.groupSize);
    assignments.push(...makeAssignments(resolved, row, seats.positions));
    decisions.push({
      action: "FIT_RESOLVED",
      offerId: resolved.id,
      venueRowId: row.id,
      reason: `placed group of ${resolved.groupSize}, deferring ${
        scan.skipped.length + 1
      } larger compatible offer(s) to next row`,
      snapshot: {
        groupSize: resolved.groupSize,
        startPosition: seats.startPosition,
        rankKey: resolved.rankKey,
        // current is the offer that triggered the scan; scan.skipped
        // are additional compatible non-fits between current and resolved.
        skippedOfferIds: [current.id, ...scan.skipped.map((o) => o.id)],
      },
    });
    placedOfferIds.add(resolved.id);
    // Advance past the placed offer. Any offers between i and foundIdx-1
    // (the skipped ones) stay in the pool but won't be retried this row —
    // we proved no run can hold them, and runs only shrink from here.
    i = scan.foundIdx + 1;
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
      reason: `${orphanCount} unfilled seat(s) remain in row after placement`,
      snapshot: {
        orphanCount,
        orphanPositions: runs.flatMap((r) => r.positions),
        placedOfferCount: placedOfferIds.size,
      },
    });
  }

  return { assignments, decisions, placedOfferIds };
}
