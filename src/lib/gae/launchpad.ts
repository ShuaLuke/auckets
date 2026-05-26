// LaunchPad: row-by-row allocation loop.
//
// Spec: docs/GAE_SPEC.md §2 LaunchPad (orchestration) + §3 FitResolver
// (skip-ahead, wired in via ./fitresolver) + §4 Placement (within-run
// lean-aware positioning, wired in via ./placement).
//
// For each active row (best rowRank first):
//   1. Selection: walk the rank-ordered pool. For each compatible offer
//      that fits a remaining run, record a selection. On a non-fit, ask
//      FitResolver to scan forward for the next compatible smaller fit.
//      During selection we only track each run's remaining LENGTH — not
//      the specific positions — because lean-aware placement needs the
//      full set of selections before it can decide where each group sits.
//   2. Placement: group the selections by run and call placeInRun once
//      per run with the row's lean (GA rows force LEFT — they're a
//      bucket, not a seat layout).
//   3. Emission: walk selections in original order, look up each offer's
//      positions in the placement map, push assignments and emit the
//      PLACED or FIT_RESOLVED decision.
//
// FitResolver only defers, it never rejects: skipped offers stay in the
// pool for the next row. Within the current row, a skipped offer is not
// retried — runs only shrink, so "doesn't fit any run" is monotonic.
//
// Still deferred to later slices:
//   * Tier prefs `this_or_better` and `this_or_worse` are treated as
//     exact-tier-only in this first pass; the waterfall slice handles
//     cross-tier placement against any unplaced offers.
//   * AllocationConfig.allowOrphans / orphanPolicy aren't read yet —
//     orphans are detected and emitted as decisions, never bumped.
//
// This module is internal to the GAE. The public allocate() entry point
// will eventually call launchPad, then waterfall, then assemble an
// AllocationResult.

import { scanForwardFit } from "./fitresolver";
import { placeInRun, type Lean } from "./placement";
import { sortRankedOffers } from "./rankkey";
import type {
  AllocationAction,
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

type Selection = {
  offer: RankedOffer;
  runIdx: number;
  action: Extract<AllocationAction, "PLACED" | "FIT_RESOLVED">;
  // Populated only on FIT_RESOLVED: the cursor offer that triggered the
  // scan plus any additional compatible non-fits between cursor and the
  // resolved offer.
  skippedOfferIds?: string[];
};

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
  // Selection phase: decide which offers go in which runs. We only
  // track each run's remaining length here; the position math waits
  // until we know every selection, because lean-aware placement is
  // batch-shaped (CENTER and DUAL_AISLE both want to see the full
  // cluster before assigning positions).
  const selections: Selection[] = [];
  const placedOfferIds = new Set<string>();
  const runLengths = initialRuns.map((r) => r.positions.length);

  let i = 0;
  while (i < pool.length) {
    const current = pool[i]!;
    if (!isOfferCompatibleWithRow(current, row)) {
      i++;
      continue;
    }

    const directRunIdx = runLengths.findIndex(
      (len) => len >= current.groupSize,
    );
    if (directRunIdx !== -1) {
      selections.push({
        offer: current,
        runIdx: directRunIdx,
        action: "PLACED",
      });
      placedOfferIds.add(current.id);
      runLengths[directRunIdx] = runLengths[directRunIdx]! - current.groupSize;
      i++;
      continue;
    }

    // Direct miss — scan forward for a smaller compatible fit.
    const scan = scanForwardFit(
      pool,
      i + 1,
      runLengths.map((len) => ({ length: len })),
      (o) => isOfferCompatibleWithRow(o, row),
    );

    if (scan.foundIdx === -1) {
      // Nothing forward fits either. Row is done; current and any
      // forward non-fits stay in the pool for the next row.
      break;
    }

    const resolved = pool[scan.foundIdx]!;
    selections.push({
      offer: resolved,
      runIdx: scan.foundRunIdx,
      action: "FIT_RESOLVED",
      skippedOfferIds: [current.id, ...scan.skipped.map((o) => o.id)],
    });
    placedOfferIds.add(resolved.id);
    runLengths[scan.foundRunIdx] =
      runLengths[scan.foundRunIdx]! - resolved.groupSize;
    i = scan.foundIdx + 1;
  }

  // Placement phase: per run, ask placement.ts to assign positions
  // according to the row's lean. GA rows force LEFT — they're a bucket,
  // not a seat layout, and the spec calls out that lean is ignored.
  const lean: Lean = row.isGa === true ? "LEFT" : row.lean;
  const positionsByOffer = new Map<string, number[]>();
  const byRun = new Map<number, Selection[]>();
  for (const sel of selections) {
    const list = byRun.get(sel.runIdx);
    if (list === undefined) {
      byRun.set(sel.runIdx, [sel]);
    } else {
      list.push(sel);
    }
  }
  for (const [runIdx, sels] of byRun) {
    const run = initialRuns[runIdx]!;
    const placements = placeInRun(
      run.positions,
      sels.map((s) => ({ id: s.offer.id, groupSize: s.offer.groupSize })),
      lean,
    );
    for (const p of placements) {
      positionsByOffer.set(p.offerId, p.positions);
    }
  }

  // Emission phase: walk selections in original (rank/selection) order
  // so the decision log reads in the order placements were *decided*,
  // not the order they ended up sitting in the row.
  const assignments: SeatAssignment[] = [];
  const decisions: AllocationDecision[] = [];

  for (const sel of selections) {
    const positions = positionsByOffer.get(sel.offer.id) ?? [];
    const startPosition = positions[0] ?? -1;
    for (const positionIndex of positions) {
      assignments.push({
        offerId: sel.offer.id,
        venueRowId: row.id,
        seatNumber: row.seatNumbers[positionIndex]!,
        positionIndex,
      });
    }
    if (sel.action === "PLACED") {
      decisions.push({
        action: "PLACED",
        offerId: sel.offer.id,
        venueRowId: row.id,
        reason: `placed group of ${sel.offer.groupSize} starting at position ${startPosition}`,
        snapshot: {
          groupSize: sel.offer.groupSize,
          startPosition,
          rankKey: sel.offer.rankKey,
        },
      });
    } else {
      const skipped = sel.skippedOfferIds ?? [];
      decisions.push({
        action: "FIT_RESOLVED",
        offerId: sel.offer.id,
        venueRowId: row.id,
        reason: `placed group of ${sel.offer.groupSize}, deferring ${skipped.length} larger compatible offer(s) to next row`,
        snapshot: {
          groupSize: sel.offer.groupSize,
          startPosition,
          rankKey: sel.offer.rankKey,
          skippedOfferIds: skipped,
        },
      });
    }
  }

  const orphanCount = runLengths.reduce((sum, len) => sum + len, 0);

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
    // Compute orphan positions from the leftover (post-placement) run
    // structure. Each run's leftover positions are the ones that
    // placement didn't return for any group.
    const placedPositions = new Set<number>();
    for (const positions of positionsByOffer.values()) {
      for (const p of positions) placedPositions.add(p);
    }
    const orphanPositions: number[] = [];
    for (const run of initialRuns) {
      for (const p of run.positions) {
        if (!placedPositions.has(p)) orphanPositions.push(p);
      }
    }
    decisions.push({
      action: "ORPHAN_DETECTED",
      venueRowId: row.id,
      reason: `${orphanCount} unfilled seat(s) remain in row after placement`,
      snapshot: {
        orphanCount,
        orphanPositions,
        placedOfferCount: placedOfferIds.size,
      },
    });
  }

  return { assignments, decisions, placedOfferIds };
}
