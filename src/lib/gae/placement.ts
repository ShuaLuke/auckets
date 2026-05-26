// Placement: within-run seat assignment by row lean.
//
// Spec: docs/GAE_SPEC.md §4 Placement.
//
// Once LaunchPad has decided which offers go in a row (and which
// contiguous run within that row), Placement decides which specific
// positions inside the run each group gets, based on the row's lean.
//
// Inputs to placeInRun are pure number arrays — no Offer / Row objects.
// That keeps this module narrow (one job, easy to unit-test) and lets
// the caller handle the position-index → printed-seat-number translation
// at the assignment-construction boundary.
//
// Lean conventions implemented here:
//
//   LEFT       — front-to-back. Group 0 at positions[0..g0-1], group 1
//                right after it, etc. This is the natural reading order
//                and the default for GA rows (lean is ignored there).
//
//   RIGHT      — mirror of LEFT. Group 0 takes the rightmost run-tail,
//                group 1 immediately to its left, etc.
//
//   CENTER     — best-ranked group occupies the middle of the cluster.
//                Rank 1 goes immediately to the left of rank 0, rank 2
//                immediately to the right, rank 3 further left, rank 4
//                further right, and so on. For 5 equal groups the
//                left-to-right layout is [rank-3, rank-1, rank-0, rank-2,
//                rank-4]. The cluster itself is centered within the run
//                when the groups don't fill it (any extra capacity is
//                split evenly between the run's two ends, with the
//                leftover seat — if the gap is odd — going to the right).
//
//   DUAL_AISLE — best groups get the aisle (run-end) seats. Rank 0 at
//                the left aisle, rank 1 at the right aisle, rank 2
//                next-from-left (adjacent to rank 0 on its right),
//                rank 3 next-from-right (adjacent to rank 1 on its left),
//                alternating inward.
//
// These two patterns (CENTER and DUAL_AISLE) are MVP interpretations of
// spec language that didn't pin down the exact algorithm. If a venue
// surfaces a stronger preference, change the implementation here; the
// rest of the engine doesn't care.

import type { VenueRow } from "./types";

export type Lean = VenueRow["lean"];

export type PlacementGroup = {
  id: string;
  groupSize: number;
};

export type RunPlacement = {
  offerId: string;
  // Positions are taken from the input runPositions array, preserving
  // its order. Always ascending — even for RIGHT / CENTER / DUAL_AISLE,
  // since each group occupies a contiguous slice of runPositions.
  positions: number[];
};

// Place a sequence of rank-ordered groups inside a single contiguous run.
//
// `runPositions` is the list of available position indices (into the
// row's seatNumbers) inside this run. Order matters: left-to-right
// inside the row.
//
// `groups` is the rank-ordered list of groups going into this run (the
// first element is the highest-ranked). The caller guarantees the sum
// of groupSize is <= runPositions.length.
export function placeInRun(
  runPositions: ReadonlyArray<number>,
  groups: ReadonlyArray<PlacementGroup>,
  lean: Lean,
): RunPlacement[] {
  if (groups.length === 0) return [];
  switch (lean) {
    case "LEFT":
      return placeLeft(runPositions, groups);
    case "RIGHT":
      return placeRight(runPositions, groups);
    case "CENTER":
      return placeCenter(runPositions, groups);
    case "DUAL_AISLE":
      return placeDualAisle(runPositions, groups);
  }
}

function placeLeft(
  runPositions: ReadonlyArray<number>,
  groups: ReadonlyArray<PlacementGroup>,
): RunPlacement[] {
  const result: RunPlacement[] = [];
  let cursor = 0;
  for (const g of groups) {
    result.push({
      offerId: g.id,
      positions: runPositions.slice(cursor, cursor + g.groupSize),
    });
    cursor += g.groupSize;
  }
  return result;
}

function placeRight(
  runPositions: ReadonlyArray<number>,
  groups: ReadonlyArray<PlacementGroup>,
): RunPlacement[] {
  const result: RunPlacement[] = [];
  let cursor = runPositions.length;
  for (const g of groups) {
    cursor -= g.groupSize;
    result.push({
      offerId: g.id,
      positions: runPositions.slice(cursor, cursor + g.groupSize),
    });
  }
  return result;
}

function placeCenter(
  runPositions: ReadonlyArray<number>,
  groups: ReadonlyArray<PlacementGroup>,
): RunPlacement[] {
  // Build the left-to-right layout order by inserting ranks 1, 2, 3, ...
  // alternating in front of (left of) and behind (right of) rank 0.
  // Odd ranks go left, even ranks go right.
  const layoutOrder: number[] = [0];
  for (let i = 1; i < groups.length; i++) {
    if (i % 2 === 1) {
      layoutOrder.unshift(i);
    } else {
      layoutOrder.push(i);
    }
  }

  // Center the cluster of placed groups within the run. Any spare
  // capacity is split between the two ends; a single odd leftover seat
  // goes to the right (Math.floor on the left gap).
  const totalSize = groups.reduce((s, g) => s + g.groupSize, 0);
  const leftPadding = Math.floor((runPositions.length - totalSize) / 2);

  const result: RunPlacement[] = new Array(groups.length);
  let cursor = leftPadding;
  for (const groupIdx of layoutOrder) {
    const g = groups[groupIdx]!;
    result[groupIdx] = {
      offerId: g.id,
      positions: runPositions.slice(cursor, cursor + g.groupSize),
    };
    cursor += g.groupSize;
  }
  return result;
}

function placeDualAisle(
  runPositions: ReadonlyArray<number>,
  groups: ReadonlyArray<PlacementGroup>,
): RunPlacement[] {
  const result: RunPlacement[] = [];
  let leftCursor = 0;
  let rightCursor = runPositions.length;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    if (i % 2 === 0) {
      result.push({
        offerId: g.id,
        positions: runPositions.slice(leftCursor, leftCursor + g.groupSize),
      });
      leftCursor += g.groupSize;
    } else {
      rightCursor -= g.groupSize;
      result.push({
        offerId: g.id,
        positions: runPositions.slice(rightCursor, rightCursor + g.groupSize),
      });
    }
  }
  return result;
}
