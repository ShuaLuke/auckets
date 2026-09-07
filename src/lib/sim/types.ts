// Types for the GAE simulator (docs/GAE_SIMULATOR.md). The sim core is pure
// — it imports the GAE and nothing that touches DB, env, Stripe, or email.
// File reading lives only in scripts/sim.ts.

import type {
  AllocationConfig,
  AllocationResult,
  AllocationStats,
  RankedOffer,
  TierPreference,
  VenueRow,
} from "@/lib/gae/types";

// --- Venue library ---------------------------------------------------------

export type HoldSource = "venue" | "artist" | "comp" | "production" | "bleacher";

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

// NEW-8 "Bleacher" second channel — NOT confirmed by Cope. A share of the
// worst seats is carved out before allocation and sold at one fixed price
// outside the GAE. Off unless the scenario sets it.
export type BleacherSpec = {
  sharePct: number; // of seats on sale, taken as whole rows from the worst rowRank up
  priceCents: number;
};

export type ShowOverlay = {
  // Match against VenueRow.section OR VenueRow.area, case-insensitive.
  activeSections?: string[];
  activeRowIds?: string[];
  holds?: HoldSpec[];
  floorsCents?: Record<string, number>;
  maxGroupSize?: number;
  bleacher?: BleacherSpec;
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

export type RaiseRule = { kind: "fixed"; cents: number } | { kind: "percent"; pct: number };

// Auto-bid share of a generated pool (ADR-0017/0018). Each auto-bidder gets a
// cap = price × U(lo, hi) snapped to the ladder; the raise rule is set on
// the scenario so file pools can use it too.
export type AutoBidModel = {
  sharePct: number; // percent of offers with auto-bid on
  capMultiplier: [number, number];
};

// ADR-0017 private offer (hidden threshold): modelled as an auto-bid whose
// cap is the hidden threshold — the fan publicly commits the visible price
// and is raised up to the threshold when a competing offer would displace
// them. The ADR's wording ("auto-converts to that price") is read that way;
// confirm with Cope. `kind` defaults to "auto".
export type AutoBidSpec = { capCents: number; kind?: "auto" | "private" };
export type AutoBids = Record<string, AutoBidSpec>; // offerId → spec

export type AutoBidRaise = { offerId: string; kind: "auto" | "private"; fromCents: number; toCents: number; steps: number; heldSection: boolean };

export type PrivateOfferModel = {
  sharePct: number; // percent of offers with a hidden threshold
  thresholdMultiplier: [number, number]; // threshold = visible price × U(lo, hi), snapped to the ladder
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
  autoBid?: AutoBidModel;
  privateOffers?: PrivateOfferModel;
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

// "greedy" | "clean-fit" | "parity-tiebreak" | "singles-reserve[:k]" and
// "+"-joined composites, e.g. "clean-fit+singles-reserve". See policy.ts.
export type PolicyName = string;

export type Scenario = {
  name: string;
  venue: string | { file: string };
  show?: ShowOverlay;
  pool: PoolSource;
  policies?: PolicyName[];
  seeds?: number;
  // Applies to every auto-bidder in the pool (generated or from a file with
  // a cap column). Default: fixed $5, the shipped rule (ADR-0018).
  autoBidRaiseRule?: RaiseRule;
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

export type PolicyActivity = {
  cleanFitDeferrals: number; // FIT_RESOLVED with snapshot.policy === "clean_fit"
  seatsSavedByCleanFit: number; // Σ strandedSeatsAvoided
  parityTiebreaks: number; // PLACED with snapshot.parityTiebreak
  reservedSinglesPlaced: number;
  reservedSinglesUnplaced: number;
};

export type AutoBidMetrics = {
  bidders: number;
  raised: number; // bidders whose price moved
  totalRaiseCents: number;
  maxRaiseCents: number;
  avgStepsPerRaised: number;
  heldSectionAfterRaise: number; // raised AND seated in their preferred tier
  cappedOut: number; // raised to their cap and still displaced
  rounds: number;
  // Private-offer breakdown (subset of the above; kind === "private")
  privateOffers: number;
  privateConverted: number; // raised above their visible price
  privateAddedCents: number;
};

// NEW-8 Bleacher carve-out numbers. Everything here is an estimate outside
// the engine: the carved seats are sold at one fixed price to fans the GAE
// did not seat, so the most they can earn is min(seats, unplaced tickets) × price.
export type BleacherMetrics = {
  seats: number;
  rows: number;
  priceCents: number;
  grossIfSoldOutCents: number;
  overflowTickets: number; // tickets requested by unplaced offers
  estSoldSeats: number; // min(seats, overflowTickets)
  estGrossCents: number;
  combinedGrossCents: number; // GAE gross placed + estGross
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
  policy: PolicyActivity;
  autoBid: AutoBidMetrics;
  bleacher: BleacherMetrics | null;
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
  offers?: RankedOffer[]; // the pool AFTER auto-bid resolution (what the engine saw)
  raises?: AutoBidRaise[];
  config: AllocationConfig;
  caveat: string; // what the policy trades away, for the report
};

export type Percentiles = { p5: number; p50: number; p95: number; mean: number; stdev: number; min: number; max: number };

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
  // active row id → rowRank, so compare-runs can name rows without the venue file
  rowRanks: Record<string, number>;
  offerSummary: OfferParitySummary; // first seed's pool
  policies: PolicyName[];
  seeds: number[];
  runs: PolicyRun[];
  aggregates: PolicyAggregate[];
  generatedAt: string;
};

// --- Sweeps ----------------------------------------------------------------

export type SweepPoint = {
  label: string; // the varied value, as text
  value: unknown;
  scenario: Scenario;
  output: RunOutput; // slimmed: no per-seed engine output
};

export type SweepOutput = {
  scenarioName: string;
  path: string; // e.g. "pool.generate.oversubscription"
  points: SweepPoint[];
  policies: PolicyName[];
  seeds: number;
  generatedAt: string;
};
