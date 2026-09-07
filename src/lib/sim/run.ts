// runScenario: the pure heart of the CLI's `run`. Given a scenario, the
// library venue it names, and (for file pools) the offers, it applies the
// show overlay, builds or loads the pool per seed, runs every policy through
// the real allocate(), and returns metrics + invariants + hashes.

import { createHash } from "node:crypto";

import { allocate } from "@/lib/gae";
import type { AllocationConfig, RankedOffer } from "@/lib/gae/types";

import { DEFAULT_RAISE_RULE, resolveAutoBids } from "./autobid";
import { generatePool } from "./demand";
import { checkInvariants } from "./invariants";
import { computeMetrics } from "./metrics";
import { parsePolicy } from "./policy";
import { offerParitySummary } from "./pool";
import type { AutoBids, FillMetrics, Percentiles, PolicyAggregate, PolicyName, PolicyRun, RunOutput, Scenario, SimVenue } from "./types";
import { activeRows, applyShowOverlay, SimInputError, tierOrder, toArchitecture, venueParitySummary } from "./venue";

export type RunInput = {
  scenario: Scenario;
  venue: SimVenue;
  poolOffers?: RankedOffer[]; // required when scenario.pool is { file }
  poolAutoBids?: AutoBids; // caps from the pool file's cap column, if any
  now?: string; // ISO; injectable for tests
};

export const POLICIES: PolicyName[] = ["greedy", "clean-fit", "parity-tiebreak", "singles-reserve", "clean-fit+singles-reserve"];

export function runScenario(input: RunInput): RunOutput {
  const { scenario, venue } = input;
  const policies = scenario.policies ?? ["greedy"];
  const seedCount = scenario.seeds ?? 1;
  const resolved = applyShowOverlay(venue, scenario.show);
  const rows = activeRows(resolved.venue);
  if (rows.length === 0) throw new SimInputError("no active rows after applying the show overlay");
  const availableSeats = rows.reduce((s, r) => s + r.capacity - r.holds.length, 0);
  const heldTotal = rows.reduce((s, r) => s + r.holds.length, 0);
  const heldBySource: Record<string, number> = {
    ...resolved.heldBySource,
    venue: heldTotal - resolved.heldBySource.artist - resolved.heldBySource.comp - resolved.heldBySource.production,
  };

  const isFilePool = "file" in scenario.pool;
  if (isFilePool && !input.poolOffers) throw new SimInputError("scenario.pool.file set but no offers were loaded");
  if (isFilePool && seedCount > 1) {
    throw new SimInputError("seeds > 1 only makes sense with a generated pool (a file pool is the same every time)");
  }

  const arch = toArchitecture(resolved.venue);
  const baseConfig: AllocationConfig = {
    mode: "preview",
    allowOrphans: true,
    maxGroupSize: resolved.maxGroupSize,
    orphanPolicy: "leave",
  };
  const parsedPolicies = policies.map((p) => parsePolicy(p, resolved.venue));
  const raiseRule = scenario.autoBidRaiseRule ?? DEFAULT_RAISE_RULE;

  const seeds: number[] = [];
  const runs: PolicyRun[] = [];
  let firstPool: RankedOffer[] | undefined;
  const firstResultByPolicy = new Set<PolicyName>();

  for (let s = 0; s < seedCount; s++) {
    let offers: RankedOffer[];
    let autoBids: AutoBids;
    let seed: number;
    if ("file" in scenario.pool) {
      offers = input.poolOffers!;
      autoBids = input.poolAutoBids ?? {};
      seed = 0;
    } else {
      seed = scenario.pool.generate.seed + s;
      const gen = generatePool(
        scenario.pool.generate,
        {
          tierOrder: tierOrder(resolved.venue),
          floorsCents: resolved.floorsCents,
          availableSeats,
          maxGroupSize: resolved.maxGroupSize,
        },
        seed,
      );
      offers = gen.offers;
      autoBids = gen.autoBids;
    }
    seeds.push(seed);
    firstPool ??= offers;

    for (const parsed of parsedPolicies) {
      const policy = parsed.name;
      const config: AllocationConfig = { ...baseConfig, ...parsed.config };
      const t0 = performance.now();
      // Auto-bid pre-pass (ADR-0018 fixed point) with THIS policy's config,
      // so a policy is judged on the pool it would actually see.
      const ab = resolveAutoBids(arch, offers, autoBids, raiseRule, config);
      const seen = ab.offers;
      const result = allocate(arch, seen, config);
      const runtimeMs = performance.now() - t0;
      const inPool = Object.entries(autoBids).filter(([id]) => offers.some((o) => o.id === id));
      const metrics = computeMetrics(
        resolved.venue,
        seen,
        result,
        heldBySource,
        runtimeMs,
        {
          bidders: inPool.length,
          privateOffers: inPool.filter(([, spec]) => spec.kind === "private").length,
          raises: ab.raises,
          rounds: ab.rounds,
        },
        resolved.bleacher,
      );
      if (config.singlesReserve) {
        const reservedIds = new Set(result.decisions.filter((d) => d.snapshot.singlesReserve === true && d.offerId).map((d) => d.offerId!));
        const unplacedIds = new Set(result.unplaced.map((u) => u.offerId));
        // Reserved singles that never got a seat: singles in the reserve set are
        // the k lowest-ranked compatible singles; the engine doesn't return the
        // set, so count unplaced singles beyond what greedy would leave. Kept
        // simple: unplaced single-seat offers not seen in a reserve decision.
        metrics.policy.reservedSinglesUnplaced = seen.filter((o) => o.groupSize === 1 && unplacedIds.has(o.id) && !reservedIds.has(o.id)).length;
      }
      const violations = checkInvariants(resolved.venue, seen, result);
      const run: PolicyRun = {
        seed,
        policy,
        stats: result.stats,
        metrics,
        violations,
        resultHash: sha256(stableStringify({ assignments: result.assignments, unplaced: result.unplaced, stats: result.stats })),
        config,
        caveat: parsed.caveat,
      };
      if (!firstResultByPolicy.has(policy)) {
        firstResultByPolicy.add(policy);
        run.result = result;
        run.offers = seen;
        run.raises = ab.raises;
      }
      runs.push(run);
    }
  }

  return {
    scenarioName: scenario.name,
    scenario,
    venueName: venue.name,
    venueDisplayName: venue.displayName,
    inputHash: sha256(
      stableStringify({
        scenario,
        rows: resolved.venue.rows,
        activeRowIds: resolved.venue.activeRowIds,
        floors: resolved.floorsCents,
        pool: isFilePool ? input.poolOffers : undefined,
      }),
    ),
    venueSummary: venueParitySummary(resolved.venue),
    rowRanks: Object.fromEntries(rows.map((r) => [r.id, r.rowRank])),
    offerSummary: offerParitySummary(firstPool ?? [], availableSeats),
    policies,
    seeds,
    runs,
    aggregates: policies.map((p) => aggregate(p, runs.filter((r) => r.policy === p))),
    generatedAt: input.now ?? new Date().toISOString(),
  };
}

// --- aggregation -----------------------------------------------------------

const SCALAR_PATHS: ReadonlyArray<[keyof FillMetrics, string]> = [
  ["fill", "placedSeats"],
  ["fill", "fillRate"],
  ["fill", "emptySeats"],
  ["fill", "orphanSeats"],
  ["fill", "unfilledSeats"],
  ["fill", "oddHoleSeats"],
  ["fill", "emptySeatsOddRows"],
  ["fill", "emptySeatsEvenRows"],
  ["fill", "rowsFull"],
  ["fill", "rowsPartial"],
  ["fill", "rowsEmpty"],
  ["revenue", "grossPlacedCents"],
  ["revenue", "unplacedValueCents"],
  ["revenue", "unplacedFittableValueCents"],
  ["revenue", "avgPlacedPriceCents"],
  ["revenue", "medianPlacedPriceCents"],
  ["offers", "total"],
  ["offers", "placed"],
  ["offers", "unplaced"],
  ["offers", "ticketsRequested"],
  ["rankRespect", "passedOver"],
  ["rankRespect", "rowsLostSum"],
  ["rankRespect", "rowsLostMax"],
  ["rankRespect", "priceGapMaxCents"],
  ["rankRespect", "priceGapSumCents"],
  ["rankRespect", "fitResolvedDeferrals"],
  ["rankRespect", "waterfalled"],
  ["policy", "cleanFitDeferrals"],
  ["policy", "seatsSavedByCleanFit"],
  ["policy", "parityTiebreaks"],
  ["policy", "reservedSinglesPlaced"],
  ["policy", "reservedSinglesUnplaced"],
  ["autoBid", "bidders"],
  ["autoBid", "raised"],
  ["autoBid", "totalRaiseCents"],
  ["autoBid", "maxRaiseCents"],
  ["autoBid", "avgStepsPerRaised"],
  ["autoBid", "heldSectionAfterRaise"],
  ["autoBid", "cappedOut"],
  ["autoBid", "rounds"],
  ["autoBid", "privateOffers"],
  ["autoBid", "privateConverted"],
  ["autoBid", "privateAddedCents"],
];
const BLEACHER_PATHS = ["seats", "estSoldSeats", "estGrossCents", "combinedGrossCents", "overflowTickets"] as const;

export function percentiles(values: number[]): Percentiles {
  if (values.length === 0) return { p5: 0, p50: 0, p95: 0, mean: 0, stdev: 0, min: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number): number => {
    const pos = (s.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
  };
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const variance = s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / s.length;
  return { p5: q(0.05), p50: q(0.5), p95: q(0.95), mean, stdev: Math.sqrt(variance), min: s[0]!, max: s[s.length - 1]! };
}

function aggregate(policy: PolicyName, runs: PolicyRun[]): PolicyAggregate {
  const scalars: Record<string, Percentiles> = {};
  for (const [group, key] of SCALAR_PATHS) {
    const values = runs.map((r) => (r.metrics[group] as unknown as Record<string, number>)[key] ?? 0);
    scalars[`${group}.${key}`] = percentiles(values);
  }
  // Hole-size histogram: sizes 1..6 individually.
  for (let size = 1; size <= 6; size++) {
    scalars[`fill.holesBySize.${size}`] = percentiles(runs.map((r) => r.metrics.fill.holesBySize[size] ?? 0));
  }
  if (runs.some((r) => r.metrics.bleacher !== null)) {
    for (const key of BLEACHER_PATHS) scalars[`bleacher.${key}`] = percentiles(runs.map((r) => r.metrics.bleacher?.[key] ?? 0));
  }
  const sizes = new Set<number>();
  const tiers = new Set<string>();
  for (const r of runs) {
    for (const k of Object.keys(r.metrics.byGroupSize)) sizes.add(Number(k));
    for (const k of Object.keys(r.metrics.byTier)) tiers.add(k);
  }
  const byGroupSize: PolicyAggregate["byGroupSize"] = {};
  for (const size of [...sizes].sort((a, b) => a - b)) {
    const present = runs.filter((r) => r.metrics.byGroupSize[size] !== undefined);
    byGroupSize[size] = {
      offers: percentiles(runs.map((r) => r.metrics.byGroupSize[size]?.offers ?? 0)),
      placed: percentiles(runs.map((r) => r.metrics.byGroupSize[size]?.placed ?? 0)),
      ticketsPlaced: percentiles(runs.map((r) => r.metrics.byGroupSize[size]?.ticketsPlaced ?? 0)),
      placedRate: percentiles(present.map((r) => r.metrics.byGroupSize[size]!.placedRate)),
      medianRowRank: percentiles(
        present.map((r) => r.metrics.byGroupSize[size]!.medianRowRank).filter((v): v is number => v !== null),
      ),
    };
  }
  const byTier: PolicyAggregate["byTier"] = {};
  for (const tier of tiers) {
    byTier[tier] = {
      placedSeats: percentiles(runs.map((r) => r.metrics.byTier[tier]?.placedSeats ?? 0)),
      emptySeats: percentiles(runs.map((r) => r.metrics.byTier[tier]?.emptySeats ?? 0)),
      offersPlaced: percentiles(runs.map((r) => r.metrics.byTier[tier]?.offersPlaced ?? 0)),
      fillRate: percentiles(runs.map((r) => r.metrics.byTier[tier]?.fillRate ?? 0)),
      grossCents: percentiles(runs.map((r) => r.metrics.byTier[tier]?.grossCents ?? 0)),
    };
  }
  return {
    policy,
    seeds: runs.length,
    scalars,
    byGroupSize,
    byTier,
    violations: runs.reduce((s, r) => s + r.violations.length, 0),
  };
}

// --- hashing ---------------------------------------------------------------

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      const o = v as Record<string, unknown>;
      return Object.keys(o)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = o[k];
          return acc;
        }, {});
    }
    return v;
  });
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
