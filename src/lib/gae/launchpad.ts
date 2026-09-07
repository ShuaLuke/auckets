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
// LaunchPad accepts an optional `matcher` in its options that decides
// whether an offer is compatible with a row's tier. The default is the
// `strictTierMatcher` exported here — it requires exact-tier match for
// every non-`any` preference. The waterfall slice supplies its own
// relaxed matcher to cascade `this_or_better` / `this_or_worse` offers
// across tiers; that pass also uses LaunchPad's machinery via this
// parameter, with the calling code re-labeling decisions as WATERFALLED.
//
// Still deferred to later slices:
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
  FitPolicy,
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

export type LaunchPadPolicies = {
  fitPolicy?: FitPolicy | undefined;
  parityTiebreak?: boolean | undefined;
};

export function launchPad(
  venue: VenueArchitecture,
  offers: RankedOffer[],
  options: { matcher?: TierMatcher; policies?: LaunchPadPolicies } = {},
): LaunchPadResult {
  const matcher = options.matcher ?? strictTierMatcher;
  const policies = options.policies ?? {};
  const assignments: SeatAssignment[] = [];
  const decisions: AllocationDecision[] = [];
  let pool = sortRankedOffers(offers);

  for (const row of getActiveRowsByRank(venue)) {
    const runs = contiguousRuns(row);
    if (runs.length === 0) continue; // entire row held; spec: no decision

    const filled = fillRow(row, runs, pool, matcher, policies);
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

// A predicate that decides whether a given offer is compatible with a
// given row's tier. LaunchPad's default matcher is strict — it requires
// `specific`, `this_or_better`, and `this_or_worse` preferences all to
// match the row's tier exactly. The waterfall slice supplies a relaxed
// matcher that expands `this_or_*` per the venue's tier ordering.
export type TierMatcher = (offer: RankedOffer, row: VenueRow) => boolean;

export const strictTierMatcher: TierMatcher = (offer, row) => {
  const pref = offer.tierPreference;
  if (pref.type === "any") return true;
  if (row.tier === undefined) return false;
  return pref.tier === row.tier;
};

type Selection = {
  offer: RankedOffer;
  runIdx: number;
  action: Extract<AllocationAction, "PLACED" | "FIT_RESOLVED">;
  // Populated only on FIT_RESOLVED: the cursor offer that triggered the
  // scan plus any additional compatible non-fits between cursor and the
  // resolved offer.
  skippedOfferIds?: string[];
  // Opt-in policies annotate the decision they made (see types.ts).
  policy?: "clean_fit";
  strandedSeatsAvoided?: number;
  parityTiebreak?: boolean;
  tiedOverOfferIds?: string[];
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
  matcher: TierMatcher,
  policies: LaunchPadPolicies,
): FillRowResult {
  // Selection phase: decide which offers go in which runs. We only
  // track each run's remaining length here; the position math waits
  // until we know every selection, because lean-aware placement is
  // batch-shaped (CENTER and DUAL_AISLE both want to see the full
  // cluster before assigning positions).
  const selections: Selection[] = [];
  const placedOfferIds = new Set<string>();
  const runLengths = initialRuns.map((r) => r.positions.length);

  // Policies are seat-layout ideas; GA rows are buckets, so they run pure
  // greedy there. With no policy on, this loop is byte-for-byte the shipped
  // greedy selection.
  const cleanFit = policies.fitPolicy === "clean_fit" && row.isGa !== true;
  const parity = policies.parityTiebreak === true && row.isGa !== true;
  // Compatible, not-yet-selected offers by group size — what could still
  // fill a remainder in THIS pass. Maintained only when clean-fit is on.
  const sizeCounts = new Map<number, number>();
  if (cleanFit) {
    for (const o of pool) {
      if (matcher(o, row)) sizeCounts.set(o.groupSize, (sizeCounts.get(o.groupSize) ?? 0) + 1);
    }
  }
  const take = (sel: Selection): void => {
    selections.push(sel);
    placedOfferIds.add(sel.offer.id);
    runLengths[sel.runIdx] = runLengths[sel.runIdx]! - sel.offer.groupSize;
    if (cleanFit) sizeCounts.set(sel.offer.groupSize, (sizeCounts.get(sel.offer.groupSize) ?? 1) - 1);
  };
  const fitsRun = (o: RankedOffer): number => runLengths.findIndex((len) => len >= o.groupSize);

  let i = 0;
  while (i < pool.length) {
    const current = pool[i]!;
    if (placedOfferIds.has(current.id) || !matcher(current, row)) {
      i++;
      continue;
    }

    const directRunIdx = fitsRun(current);
    if (directRunIdx !== -1) {
      if (parity) {
        const pick = parityPick(pool, i, current, row, matcher, placedOfferIds, runLengths);
        if (pick !== null) {
          take({ offer: pick.offer, runIdx: pick.runIdx, action: "PLACED", parityTiebreak: true, tiedOverOfferIds: pick.tiedOver });
          continue; // re-examine the cursor against the smaller run
        }
      }
      if (cleanFit) {
        const remainder = runLengths[directRunIdx]! - current.groupSize;
        if (remainder > 0 && !exactlyFillable(remainder, sizeCounts, current.groupSize)) {
          const alt = cleanFitAlternative(pool, i + 1, row, matcher, placedOfferIds, runLengths, sizeCounts);
          if (alt !== null) {
            take({ offer: alt.offer, runIdx: alt.runIdx, action: "FIT_RESOLVED", skippedOfferIds: [current.id], policy: "clean_fit", strandedSeatsAvoided: remainder });
            continue; // the cursor stays in the pool and is re-examined
          }
        }
      }
      take({ offer: current, runIdx: directRunIdx, action: "PLACED" });
      i++;
      continue;
    }

    // Direct miss — scan forward for a smaller compatible fit.
    const scan = scanForwardFit(
      pool,
      i + 1,
      runLengths.map((len) => ({ length: len })),
      (o) => !placedOfferIds.has(o.id) && matcher(o, row),
    );

    if (scan.foundIdx === -1) {
      // Nothing forward fits either. Row is done; current and any
      // forward non-fits stay in the pool for the next row.
      break;
    }

    const resolved = pool[scan.foundIdx]!;
    take({
      offer: resolved,
      runIdx: scan.foundRunIdx,
      action: "FIT_RESOLVED",
      skippedOfferIds: [current.id, ...scan.skipped.map((o) => o.id)],
    });
    // Greedy advances past the scan; a policy pass re-examines the cursor,
    // because the skipped offers may now fit or fill cleanly.
    i = cleanFit || parity ? i : scan.foundIdx + 1;
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
        reason: sel.parityTiebreak
          ? `placed group of ${sel.offer.groupSize} starting at position ${startPosition} (parity tiebreak at equal price over ${sel.tiedOverOfferIds?.length ?? 0} offer(s))`
          : `placed group of ${sel.offer.groupSize} starting at position ${startPosition}`,
        snapshot: {
          groupSize: sel.offer.groupSize,
          startPosition,
          rankKey: sel.offer.rankKey,
          ...(sel.parityTiebreak && { parityTiebreak: true, tiedOverOfferIds: sel.tiedOverOfferIds ?? [] }),
        },
      });
    } else {
      const skipped = sel.skippedOfferIds ?? [];
      decisions.push({
        action: "FIT_RESOLVED",
        offerId: sel.offer.id,
        venueRowId: row.id,
        reason:
          sel.policy === "clean_fit"
            ? `placed group of ${sel.offer.groupSize}, deferring a fitting larger offer that would have stranded ${sel.strandedSeatsAvoided} seat(s) (clean-fit)`
            : `placed group of ${sel.offer.groupSize}, deferring ${skipped.length} larger compatible offer(s) to next row`,
        snapshot: {
          groupSize: sel.offer.groupSize,
          startPosition,
          rankKey: sel.offer.rankKey,
          skippedOfferIds: skipped,
          ...(sel.policy === "clean_fit" && { policy: "clean_fit", strandedSeatsAvoided: sel.strandedSeatsAvoided }),
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

// --- Opt-in policy helpers -------------------------------------------------

// Can `remainder` seats be filled EXACTLY by the compatible, unselected offers
// counted in `sizeCounts`, excluding one offer of size `excludeSize` (the
// candidate being placed)? Bounded knapsack over small numbers: remainders
// are at most a row length.
function exactlyFillable(remainder: number, sizeCounts: Map<number, number>, excludeSize: number): boolean {
  const reachable = new Array<boolean>(remainder + 1).fill(false);
  reachable[0] = true;
  for (const [size, rawCount] of sizeCounts) {
    const count = size === excludeSize ? rawCount - 1 : rawCount;
    if (count <= 0 || size > remainder) continue;
    for (let c = 0; c < count; c++) {
      let progressed = false;
      for (let t = remainder; t >= size; t--) {
        if (!reachable[t] && reachable[t - size]) {
          reachable[t] = true;
          progressed = true;
        }
      }
      if (!progressed) break;
    }
  }
  return reachable[remainder] === true;
}

// Clean-fit: the next-ranked compatible offer that fits a run and leaves a
// remainder of zero or one that can be exactly filled. null → nothing does
// (stranding is unavoidable; caller falls back to greedy).
function cleanFitAlternative(
  pool: RankedOffer[],
  startIdx: number,
  row: VenueRow,
  matcher: TierMatcher,
  selected: Set<string>,
  runLengths: number[],
  sizeCounts: Map<number, number>,
): { offer: RankedOffer; runIdx: number } | null {
  for (let j = startIdx; j < pool.length; j++) {
    const o = pool[j]!;
    if (selected.has(o.id) || !matcher(o, row)) continue;
    for (let r = 0; r < runLengths.length; r++) {
      const len = runLengths[r]!;
      if (len < o.groupSize) continue;
      const rem = len - o.groupSize;
      if (rem === 0 || exactlyFillable(rem, sizeCounts, o.groupSize)) return { offer: o, runIdx: r };
      break; // a run it fits but can't close; try the next offer
    }
  }
  return null;
}

// Parity tiebreak: among the same-price block starting at the cursor (the
// spec's rank tie, normally broken by larger group first), pick the first
// fitting offer whose group-size parity matches the run it would enter, so
// the remainder is even and the row can close. null → the cursor itself
// already matches, or nothing in the block does: place the cursor as usual.
function parityPick(
  pool: RankedOffer[],
  cursorIdx: number,
  cursor: RankedOffer,
  row: VenueRow,
  matcher: TierMatcher,
  selected: Set<string>,
  runLengths: number[],
): { offer: RankedOffer; runIdx: number; tiedOver: string[] } | null {
  const matches = (o: RankedOffer): number => {
    const r = runLengths.findIndex((len) => len >= o.groupSize);
    return r !== -1 && (runLengths[r]! - o.groupSize) % 2 === 0 ? r : -1;
  };
  if (matches(cursor) !== -1) return null;
  const tiedOver: string[] = [cursor.id];
  for (let j = cursorIdx + 1; j < pool.length; j++) {
    const o = pool[j]!;
    if (o.pricePerTicketCents !== cursor.pricePerTicketCents) break;
    if (selected.has(o.id) || !matcher(o, row)) continue;
    const r = matches(o);
    if (r !== -1) return { offer: o, runIdx: r, tiedOver };
    tiedOver.push(o.id);
  }
  return null;
}
