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
  for (const a of assignments) {
    seatsByRow.set(a.venueRowId, (seatsByRow.get(a.venueRowId) ?? 0) + 1);
  }

  let orphanSeats = 0;
  let unfilledSeats = 0;
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
