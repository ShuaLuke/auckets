// Public entry point for the Greenwood Allocation Engine.
//
// Spec: docs/GAE_SPEC.md. Architecture: launchPad runs first with strict
// tier matching, then waterfall reconsiders unplaced soft-preference
// offers against relaxed tier sets. The result envelope is assembled
// here; downstream code (the orchestration layer in src/server/) is
// responsible for persisting it.
//
// The GAE is pure logic — no HTTP, no DB, no Stripe, no email, no
// filesystem (CLAUDE.md "Hard constraints"). This file enforces that
// boundary: everything it imports is also pure, and `allocate()`'s
// signature takes only data structures.
//
// AllocationConfig is part of the public signature but is not currently
// read inside the engine — fields like `mode`, `allowOrphans`,
// `orphanPolicy`, and `rngSeed` are reserved for future behavior (orphan
// bumping, deterministic randomness for tiebreakers). The orchestration
// layer is responsible for honoring `mode` (preview vs binding), since
// the GAE itself doesn't know which side of that line it's on.

import { launchPad } from "./launchpad";
import type {
  AllocationConfig,
  AllocationDecision,
  AllocationResult,
  AllocationStats,
  RankedOffer,
  SeatAssignment,
  VenueArchitecture,
} from "./types";
import { waterfall } from "./waterfall";

export function allocate(
  venue: VenueArchitecture,
  offers: RankedOffer[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _config: AllocationConfig,
): AllocationResult {
  const phase1 = launchPad(venue, offers);
  const phase2 = waterfall(venue, phase1.remainingOffers, phase1.assignments);

  const assignments: SeatAssignment[] = [
    ...phase1.assignments,
    ...phase2.assignments,
  ];
  const decisions: AllocationDecision[] = [
    ...phase1.decisions,
    ...phase2.decisions,
  ];

  return {
    assignments,
    unplaced: phase2.unplaced,
    decisions,
    stats: computeStats(venue, offers, assignments, phase2.unplaced.length),
  };
}

// Total-accounting invariant (spec §Tests, property-based):
//   placedSeats + orphanSeats + unfilledSeats === sum(active row available)
// where "available" is `capacity - holds.length`. An active row that
// got zero placements contributes its full available to unfilledSeats;
// a partially-filled row contributes the unused remainder to orphanSeats.
function computeStats(
  venue: VenueArchitecture,
  offers: RankedOffer[],
  assignments: SeatAssignment[],
  unplacedCount: number,
): AllocationStats {
  const activeSet = new Set(venue.activeRowIds);
  const seatsByRow = new Map<string, number>();
  const placedPositionsByRow = new Map<string, Set<number>>();
  for (const a of assignments) {
    seatsByRow.set(a.venueRowId, (seatsByRow.get(a.venueRowId) ?? 0) + 1);
    let placed = placedPositionsByRow.get(a.venueRowId);
    if (placed === undefined) {
      placed = new Set<number>();
      placedPositionsByRow.set(a.venueRowId, placed);
    }
    placed.add(a.positionIndex);
  }

  let orphanSeats = 0;
  let unfilledSeats = 0;

  // Parity / fill instrumentation (spec §"What GAE optimizes — the objective"
  // §On parity, role 2: measured hypothesis). Computed over seated (non-GA)
  // active rows, where seat geometry and capacity parity are meaningful. Row
  // parity is derived from capacity here, NOT from VenueRow.parity (which the
  // allocator does not maintain).
  const holesBySize: Record<number, number> = {};
  let oddHoleSeats = 0;
  let emptySeatsOddRows = 0;
  let emptySeatsEvenRows = 0;

  for (const row of venue.rows) {
    if (!activeSet.has(row.id)) continue;
    const available = row.capacity - row.holds.length;
    if (available <= 0) continue;
    const placedHere = seatsByRow.get(row.id) ?? 0;
    if (placedHere === 0) {
      unfilledSeats += available;
    } else if (placedHere < available) {
      orphanSeats += available - placedHere;
    }

    // GA rows are buckets, not seat layouts: hole shape and capacity parity
    // carry no allocation meaning there, so they're excluded from the parity
    // instrumentation. Their empty seats still count in orphan/unfilled (and
    // thus emptySeats).
    if (row.isGa === true) continue;

    const emptyHere = available - placedHere;
    if (emptyHere <= 0) continue;
    if (row.capacity % 2 === 0) {
      emptySeatsEvenRows += emptyHere;
    } else {
      emptySeatsOddRows += emptyHere;
    }

    // Collect maximal contiguous runs of open seats (neither held nor
    // placed). Each run is one "hole" whose length is the largest group that
    // could still sit in it; a held or placed seat breaks the run.
    const heldSet = new Set(row.holds);
    const placedSet = placedPositionsByRow.get(row.id);
    let runLength = 0;
    for (let i = 0; i <= row.seatNumbers.length; i++) {
      const seat = i < row.seatNumbers.length ? row.seatNumbers[i] : undefined;
      const open =
        seat !== undefined &&
        !heldSet.has(seat) &&
        (placedSet === undefined || !placedSet.has(i));
      if (open) {
        runLength += 1;
        continue;
      }
      if (runLength > 0) {
        holesBySize[runLength] = (holesBySize[runLength] ?? 0) + 1;
        if (runLength % 2 === 1) oddHoleSeats += runLength;
        runLength = 0;
      }
    }
  }

  const placedSeats = assignments.length;
  const placedOffers = new Set(assignments.map((a) => a.offerId)).size;
  const totalAvailable = placedSeats + orphanSeats + unfilledSeats;
  const fillRate = totalAvailable === 0 ? 0 : placedSeats / totalAvailable;

  return {
    totalOffers: offers.length,
    placedOffers,
    placedSeats,
    unplacedOffers: unplacedCount,
    orphanSeats,
    unfilledSeats,
    fillRate,
    emptySeats: orphanSeats + unfilledSeats,
    holesBySize,
    oddHoleSeats,
    emptySeatsOddRows,
    emptySeatsEvenRows,
  };
}

export type {
  AllocationConfig,
  AllocationDecision,
  AllocationResult,
  RankedOffer,
  SeatAssignment,
  TierPreference,
  VenueArchitecture,
  VenueRow,
} from "./types";
