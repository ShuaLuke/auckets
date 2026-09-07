// Types for the GAE simulator (docs/GAE_SIMULATOR.md). The sim core is pure
// — it imports the GAE and nothing that touches DB, env, Stripe, or email.
// File reading lives only in scripts/sim.ts.

import type {
  AllocationResult,
  AllocationStats,
  RankedOffer,
  TierPreference,
  VenueRow,
} from "@/lib/gae/types";

// --- Venue library ---------------------------------------------------------

export type HoldSource = "venue" | "artist" | "comp" | "production";

// A venue as stored in sim/venues/<name>.json. Superset of the GAE's
// VenueArchitecture: the engine fields plus the per-venue data the sim needs
// (tier floors for price generation, Cope's relief-row flags, provenance).
export type SimVenue = {
  name: string; // library key, kebab-case
  displayName: string;
  venueId: string;
  rows: VenueRow[];
  activeRowIds: string[];
  tierFloorsCents?: Record<string, number>;
  // rowId → Cope's SingleInventoryFlag / GapReliefEligible. Metadata only in
  // S1; the parity policies (S3) read it. Absent for venues without it.
  relief?: Record<string, { single?: boolean | undefined; gapRelief?: boolean | undefined }>;
  notes?: string;
  source?: { kind: string; file?: string | undefined; importedAt?: string | undefined };
};

// Per-show overlay on a library venue (docs/GAE_SIMULATOR.md §4.1). Applied
// in the scenario without editing the venue file.
export type HoldSpec = {
  source: HoldSource;
  // Explicit seats as "<rowId>:<seatNumber>".
  seatIds?: string[];
  // Or "N seats in tier T, best rows first, from the row's first seat".
  tier?: string;
  seats?: number;
};

export type ShowOverlay = {
  // Match against VenueRow.section OR VenueRow.area, case-insensitive.
  activeSections?: string[];
  activeRowIds?: string[];
  holds?: HoldSpec[];
  floorsCents?: Record<string, number>;
  maxGroupSize?: number;
};

export type VenueParitySummary = {
  scope: string; // "Full venue" or an area name
  capacity: number;
  rows: number;
  activeRows: number;
  evenRows: number;
  oddRows: number;
  singleRows: number; // capacity 1
  pairRows: number; // capacity 2
  reliefFlaggedRows: number; // from `relief`, 0 if absent
  heldSeats: number;
  gaSeats: number;
};

// --- Offer pool ------------------------------------------------------------

export type GroupSizeMix = Record<number, number>; // size → percent, sums to 100

export type GroupMixPreset =
  | "even-heavy"
  | "odd-heavy"
  | "singles-rich"
  | "couples"
  | "big-groups"
  | "lincoln-v4";

export type PriceModel =
  // floor + k × ladder, k geometric-ish: most fans near the floor, a tail up.
  | {
      kind: "ladder";
      ladderCents?: number; // default 2500 ($25, Cope's pool)
      meanStepsAboveFloor?: number; // default 3
      maxStepsAboveFloor?: number; // default 20
    }
  // floor × lognormal(medianMultiple, sigma), snapped to the ladder.
  | {
      kind: "lognormal";
      ladderCents?: number;
      medianMultiple?: number; // default 1.3
      sigma?: number; // default 0.35
    };

export type TierPreferenceMix = {
  specific: number;
  this_or_worse: number;
  this_or_better: number;
  any: number;
};

export type DemandModel = {
  seed: number;
  // tickets requested ÷ available seats
  oversubscription: number;
  groupSizeMix: GroupSizeMix | GroupMixPreset;
  priceModel: PriceModel;
  // Weights (normalised). Default 20/60/5/15.
  tierPreferenceMix?: TierPreferenceMix;
  // How a fan picks the tier they anchor to. "premium-biased" halves the
  // weight each tier down; "uniform" is flat.
  tierChoice?: "premium-biased" | "uniform";
};

export type PoolSource = { file: string } | { generate: DemandModel };

export type OfferParitySummary = {
  offers: number;
  ticketsRequested: number;
  availableSeats: number;
  demandMultiple: number;
  evenOffers: number;
  oddOffers: number;
  evenTickets: number;
  oddTickets: number;
  byGroupSize: Record<number, { offers: number; tickets: number; shareOfOffersPct: number; shareOfTicketsPct: number }>;
  byPreference: Record<TierPreference["type"], number>;
  priceMinCents: number;
  priceMaxCents: number;
  priceMedianCents: number;
};

// --- Scenario --------------------------------------------------------------

export type PolicyName = "greedy";

export type Scenario = {
  name: string;
  venue: string | { file: string };
  show?: ShowOverlay;
  pool: PoolSource;
  policies?: PolicyName[];
  seeds?: number;
};

// --- Metrics ---------------------------------------------------------------

export type SliceMetrics = {
  availableSeats: number;
  placedSeats: number;
  emptySeats: number;
  fillRate: number;
  offersPlaced: number;
  grossCents: number;
  avgPriceCents: number;
  medianPriceCents: number;
};

export type GroupSizeMetrics = {
  offers: number;
  placed: number;
  placedRate: number;
  ticketsRequested: number;
  ticketsPlaced: number;
  medianRowRank: number | null;
  bestRowRank: number | null;
  worstRowRank: number | null;
};

export type PreferenceMetrics = {
  offers: number;
  placedPreferred: number; // in the tier they named (or anywhere, for `any`)
  placedWorse: number;
  placedBetter: number;
  unplaced: number;
};

export type RankRespectMetrics = {
  // Offers that were passed over: some lower-ranked offer sits in a better
  // row this offer could physically have fit and was tier-compatible with.
  passedOver: number;
  rowsLostSum: number;
  rowsLostMax: number;
  // price gap between the passed-over offer and the worst-ranked occupant of
  // the better row (positive = a cheaper fan got the better row)
  priceGapMaxCents: number;
  priceGapSumCents: number;
  fitResolvedDeferrals: number; // FIT_RESOLVED decisions
  waterfalled: number;
  passedOverOfferIds: string[];
};

export type FillMetrics = {
  capacity: {
    totalSeats: number;
    heldSeats: number;
    heldBySource: Record<string, number>;
    availableSeats: number;
    activeRows: number;
  };
  fill: {
    placedSeats: number;
    fillRate: number;
    emptySeats: number;
    orphanSeats: number;
    unfilledSeats: number;
    holesBySize: Record<number, number>;
    oddHoleSeats: number;
    emptySeatsOddRows: number;
    emptySeatsEvenRows: number;
    rowsFull: number;
    rowsPartial: number;
    rowsEmpty: number;
  };
  revenue: {
    grossPlacedCents: number;
    unplacedValueCents: number;
    unplacedFittableValueCents: number;
    avgPlacedPriceCents: number;
    medianPlacedPriceCents: number;
  };
  offers: {
    total: number;
    placed: number;
    unplaced: number;
    ticketsRequested: number;
    ticketsPlaced: number;
  };
  byTier: Record<string, SliceMetrics>;
  byArea: Record<string, SliceMetrics>;
  bySection: Record<string, SliceMetrics>;
  byGroupSize: Record<number, GroupSizeMetrics>;
  preference: Record<TierPreference["type"], PreferenceMetrics>;
  rankRespect: RankRespectMetrics;
  runtimeMs: number;
};

export type InvariantViolation = {
  invariant: "contiguity" | "accounting" | "double-booking" | "no-free-upgrade";
  message: string;
};

// --- Run output ------------------------------------------------------------

export type PolicyRun = {
  seed: number;
  policy: PolicyName;
  stats: AllocationStats;
  metrics: FillMetrics;
  violations: InvariantViolation[];
  resultHash: string;
  // Full engine output. Kept for the first seed of each policy only, so a
  // 50-seed sweep doesn't produce a 50× result.json.
  result?: AllocationResult;
  offers?: RankedOffer[];
};

export type Percentiles = { p5: number; p50: number; p95: number; mean: number };

export type PolicyAggregate = {
  policy: PolicyName;
  seeds: number;
  scalars: Record<string, Percentiles>; // dotted metric path → percentiles
  byGroupSize: Record<number, { offers: Percentiles; placed: Percentiles; placedRate: Percentiles; ticketsPlaced: Percentiles; medianRowRank: Percentiles }>;
  byTier: Record<string, { placedSeats: Percentiles; emptySeats: Percentiles; fillRate: Percentiles; offersPlaced: Percentiles; grossCents: Percentiles }>;
  violations: number;
};

export type RunOutput = {
  scenarioName: string;
  scenario: Scenario;
  venueName: string;
  venueDisplayName: string;
  inputHash: string;
  venueSummary: VenueParitySummary[];
  offerSummary: OfferParitySummary; // first seed's pool
  policies: PolicyName[];
  seeds: number[];
  runs: PolicyRun[];
  aggregates: PolicyAggregate[];
  generatedAt: string;
};
