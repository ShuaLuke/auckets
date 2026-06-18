// Types for the Greenwood Allocation Engine. The GAE is pure logic
// (no HTTP, DB, Stripe, email, or filesystem — see docs/GAE_SPEC.md and
// CLAUDE.md "Hard constraints"). These types are the only contract
// between the engine and the orchestration layer that will call it.
//
// The shapes here are lifted from docs/GAE_SPEC.md §Inputs and §Outputs.
// Three intentional refinements vs. the spec:
//
//   1. `VenueRow.area` uses the `string & {}` trick so the four documented
//      labels autocomplete while still allowing venue-specific extensions.
//      Plain `string` collapses the union and kills editor hints.
//   2. `AllocationConfig.rngSeed` is added now (spec §AllocationConfig
//      mentions "RNG seed for testing" in a comment but never defines it).
//      Determinism is a stated property test (spec §Tests, property-based).
//   3. `AllocationStats` is given a minimal MVP shape (spec leaves it
//      undefined). The fields chosen match the "total accounting" property
//      test: placed + unplaced + orphans + unfilled = capacity.
//
// Money is integer cents — never floats, never strings. See src/lib/money.ts.

export type AreaLabel =
  | "orchestra"
  | "front_balcony"
  | "upper_balcony"
  | "ga"
  | (string & {});

export type VenueRow = {
  id: string;
  area: AreaLabel;
  section: string;
  rowName: string;
  rowRank: number;
  capacity: number;
  parity: "ODD" | "EVEN";
  lean: "CENTER" | "LEFT" | "RIGHT" | "DUAL_AISLE";
  seatNumbers: string[];
  holds: string[];
  tier?: string;
  isGa?: boolean;
};

export type VenueArchitecture = {
  venueId: string;
  rows: VenueRow[];
  activeRowIds: string[];
};

export type TierPreference =
  | { type: "specific"; tier: string }
  | { type: "this_or_better"; tier: string }
  | { type: "this_or_worse"; tier: string }
  | { type: "any" };

export type RankedOffer = {
  id: string;
  userId: string;
  showId: string;
  groupSize: number;
  pricePerTicketCents: number;
  rankKey: number;
  submittedAt: Date;
  tierPreference: TierPreference;
  acceptSplit?: boolean;
};

export type OrphanPolicy = "leave" | "bump_to_next_row";
export type AllocationMode = "preview" | "binding";

export type AllocationConfig = {
  mode: AllocationMode;
  allowOrphans: boolean;
  maxGroupSize: number;
  orphanPolicy: OrphanPolicy;
  rngSeed?: number;
};

export type SeatAssignment = {
  offerId: string;
  venueRowId: string;
  seatNumber: string;
  positionIndex: number;
};

export type UnplacedReason =
  | "no_compatible_tier"
  | "no_fit_anywhere"
  | "split_required_but_not_allowed";

export type UnplacedOffer = {
  offerId: string;
  reason: UnplacedReason;
};

export type AllocationAction =
  | "PLACED"
  | "SKIPPED"
  | "FIT_RESOLVED"
  | "ORPHAN_DETECTED"
  | "WATERFALLED"
  | "MANUAL_OVERRIDE";

// `snapshot` is the state captured at decision time (spec §Outputs).
// Typed as Record<string, unknown> rather than `object` so consumers can
// index it without `as any`; the orchestration layer serializes it to
// JSONB in `allocation_logs`.
export type AllocationDecision = {
  action: AllocationAction;
  offerId?: string;
  venueRowId?: string;
  reason: string;
  snapshot: Record<string, unknown>;
};

// Minimal stats for the result envelope. `fillRate` is 0..1.
// placedSeats + orphanSeats + unfilledSeats must equal total venue capacity
// (sum of active rows' capacity minus their holds). Asserted by the
// property test described in spec §Tests "Total accounting".
export type AllocationStats = {
  totalOffers: number;
  placedOffers: number;
  placedSeats: number;
  unplacedOffers: number;
  orphanSeats: number;
  unfilledSeats: number;
  fillRate: number;

  // --- Parity / fill instrumentation -------------------------------------
  // The "measured hypothesis" from spec §"What GAE optimizes — the objective"
  // §On parity: describe the empty seats left after allocation so we can see
  // whether stranding is "parity-shaped" before ever considering an
  // odd-group reserve. Computed over seated (non-GA) active rows; row parity
  // is derived from capacity, NOT from the (allocator-unmaintained)
  // VenueRow.parity field.
  emptySeats: number; // orphanSeats + unfilledSeats (includes GA rows)
  holesBySize: Record<number, number>; // contiguous empty-run length -> count
  oddHoleSeats: number; // seats sitting in odd-length holes
  emptySeatsOddRows: number; // empty seats in odd-capacity seated rows
  emptySeatsEvenRows: number; // empty seats in even-capacity seated rows
};

export type AllocationResult = {
  assignments: SeatAssignment[];
  unplaced: UnplacedOffer[];
  decisions: AllocationDecision[];
  stats: AllocationStats;
};
