# GAE Specification

The Greenwood Allocation Engine (GAE) is the heart of AUCKETS. This document is the complete specification: what it does, how it works, the data structures, the algorithms, the edge cases, and the tests.

**If you are touching code in `src/lib/gae/`, read this first.** If you are not, you can probably skip this and rely on `ARCHITECTURE.md`.

---

## Purpose

Given a venue (a set of ranked rows with capacity, parity, lean, and holds) and a pool of offers (group size + price per ticket + tier preference), produce seat assignments that:

1. Respect offer rank — higher-ranked offers get better seats.
2. Keep groups together — a group of 4 gets 4 adjacent seats or no seats.
3. Avoid orphan seats where possible — no awkward single-seat gaps.
4. Honor tier preferences — fans expressing "this tier or below" waterfall correctly.
5. Place groups within rows according to row lean — best groups toward center, aisles, or as configured.
6. Produce a complete audit trail — every decision is logged with snapshot state.

The GAE does not handle payment, email, or persistence. It is pure logic.

## What the GAE is NOT

- It is not an auction engine. There are no winners and losers in real time, no bidding wars, no per-ticket pricing competition.
- It is not a first-come-first-served allocator. Rank is by RankKey, not by submission time (timestamp is only a tiebreaker).
- It is not zone-independent. The whole venue is allocated holistically; tiers waterfall.
- It is not closing-time triggered. It runs on demand from the orchestration layer, in either preview or binding mode.

---

## Inputs

### `VenueArchitecture`

The structured representation of a building. Built once per venue, reused for every show.

```typescript
type VenueArchitecture = {
  venueId: string;
  rows: VenueRow[];
  activeRowIds: string[]; // Subset of all rows enabled for THIS show
};

type VenueRow = {
  id: string;
  area: 'orchestra' | 'front_balcony' | 'upper_balcony' | 'ga' | string;
  section: string;            // 'center', 'left', 'right', etc.
  rowName: string;            // 'AA', 'BB', 'A', 'B', etc.
  rowRank: number;            // 1 = best seat in the house
  capacity: number;           // L — number of usable seats
  parity: 'ODD' | 'EVEN';
  lean: 'CENTER' | 'LEFT' | 'RIGHT' | 'DUAL_AISLE';
  seatNumbers: string[];      // Printed seat numbers in order, e.g., ['1','3','5','7','9']
  holds: string[];            // Subset of seatNumbers that are unavailable
  tier?: string;              // For waterfalling: a label like 'premium', 'mid', 'rear'
  isGa?: boolean;             // True for GA rows; allocation treats GA as bucket, not specific seats
};
```

For GA sections, model a single "row" with `isGa: true`, `capacity` set to GA capacity, and `seatNumbers` as a synthetic list (`['GA-1', 'GA-2', ...]`). The allocation logic treats GA rows specially: no placement rules within the row, just assign next-available.

### `RankedOffer`

An offer from a fan, pre-ranked by RankKey.

```typescript
type RankedOffer = {
  id: string;
  userId: string;
  showId: string;
  groupSize: number;
  pricePerTicketCents: number;
  rankKey: number;            // Precomputed: (pricePerTicketCents * 1000) + groupSize
  submittedAt: Date;          // Tiebreaker for equal rankKey
  tierPreference: TierPreference;
  acceptSplit?: boolean;      // Phase 1.5; default false
};

type TierPreference =
  | { type: 'specific'; tier: string }      // Only this tier
  | { type: 'this_or_better'; tier: string }
  | { type: 'this_or_worse'; tier: string }
  | { type: 'any' };                         // Anywhere they fit
```

### `AllocationConfig`

Per-allocation behavior toggles.

```typescript
type AllocationConfig = {
  mode: 'preview' | 'binding';
  allowOrphans: boolean;            // Default false
  maxGroupSize: number;             // Default 10 (per ADR-0011; artist can override per show)
  orphanPolicy: 'leave' | 'bump_to_next_row';
  // Tiebreakers, RNG seed for testing, etc.
};
```

---

## Outputs

```typescript
type AllocationResult = {
  assignments: SeatAssignment[];    // What got placed where
  unplaced: UnplacedOffer[];        // Offers that didn't fit anywhere
  decisions: AllocationDecision[];  // Full audit trail
  stats: AllocationStats;           // Summary: % filled, orphans, etc.
};

type SeatAssignment = {
  offerId: string;
  venueRowId: string;
  seatNumber: string;
  positionIndex: number;             // 0-indexed position within the row
};

type UnplacedOffer = {
  offerId: string;
  reason: 'no_compatible_tier' | 'no_fit_anywhere' | 'split_required_but_not_allowed';
};

type AllocationDecision = {
  action: 'PLACED' | 'SKIPPED' | 'FIT_RESOLVED' | 'ORPHAN_DETECTED' | 'WATERFALLED' | 'MANUAL_OVERRIDE';
  offerId?: string;
  venueRowId?: string;
  reason: string;
  snapshot: object;                  // Full state at decision time
};
```

The `decisions` array is what gets written to `allocation_logs` by the orchestration layer.

---

## The algorithm

The GAE has five sub-modules, applied in this order:

### 1. RankKey

Already computed when offers are stored. Documented here for reference:

```
rankKey = (pricePerTicketCents * 1000) + groupSize
```

This sorts primarily by price per ticket, with larger groups breaking ties at equal price. The factor of 1000 means group size up to 999 won't bleed into the price ordering — a $50 offer is always ranked above a $49.99 offer regardless of group size. We don't expect groups over 10 (the default cap, per ADR-0011), so 1000 is comfortable.

Final tiebreaker: earliest `submittedAt` wins. Earlier submission as a tiebreaker rewards early commitment without making time the primary signal.

### 2. LaunchPad — row-by-row allocation

For each row in the venue, best-rank to worst-rank:

```
For each row R in venue.activeRows, sorted by rowRank ascending:
  available = R.capacity - R.holds.length
  if available == 0: continue

  candidateOffers = remainingOffers compatible with R's tier (per fan's tierPreference)

  selection = findBestFit(candidateOffers, available, R)
  if selection is empty:
    log SKIPPED with reason "no compatible offers fit"
    continue

  placement = placeInRow(selection, R)
  for each (offer, seats) in placement:
    emit PLACED decision
    record seat assignment
    remove offer from remainingOffers
```

### `findBestFit(offers, capacity, row)`

This is the heart of the algorithm and the place where naive implementations get wrong answers.

The naive (greedy) approach: take offers in rank order until the row fills or the next offer doesn't fit. This is what we ship for MVP. It's fast and usually correct.

The naive approach can be wrong: imagine a 14-seat row with ranked offers `[6, 6, 4, 4, 2]`. Greedy takes 6+6, has 2 seats left, finds the 2 fits (rank-respecting), and places them. Total: 14 seats placed. Good.

But: `[6, 4, 4, 4, 2]`. Greedy takes 6, has 8 left. Tries 4, has 4 left. Tries 4, has 0 left. Done. Total: 14 placed but the second 4 was skipped — it should have been placed.

Subtler: `[5, 4, 4, 3, 2]` into a row of 8. Greedy takes 5, has 3 left, takes 3, done. Total: 8 placed, the two 4s skipped. But: `[5, 3]` is rank-better than `[4, 4]`? Yes, because 5 outranks 4. So greedy is correct here, even though it skipped the 4s — they get the next row.

The truly pathological case: `[5, 4, 4, 3]` into a row of 8 where row+1 is row of 7. Greedy: row 1 gets [5, 3], row 2 gets [4, 4] (capacity 7 won't fit two 4s — orphan). With smarter packing: row 1 gets [4, 4], row 2 gets [5, ...]. Net: 13 seats placed either way, but the second arrangement violates rank (the rank-2 offers got the best seats).

**Decision for MVP:** ship the greedy version. Optimize for rank-respect over total fill. Track unfilled seats; if they exceed 2% across shows, revisit with a smarter algorithm. The seam in the code is `findBestFit` — swap implementations there without touching the orchestrator.

### 3. FitResolver — when the next ranked offer doesn't fit

When LaunchPad's greedy scan hits an offer that doesn't fit the remaining seats, FitResolver scans forward in the ranked list to find the best offer that does fit.

```
remaining = R.capacity - R.holds.length - already_placed_in_R
nextOffer = offers[i]

if nextOffer.groupSize > remaining:
  // Try to find a smaller offer that fits
  for j from i+1 to offers.length:
    if offers[j].groupSize <= remaining and tierMatches(offers[j], R):
      emit FIT_RESOLVED decision (skipped offers[i] in favor of offers[j])
      return offers[j]
  // Nothing fits; row is done, offer stays in pool for next row
  emit SKIPPED for the row
```

The skipped offer (the original `offers[i]`) is **not** removed from the pool — it gets considered again for the next row. This is important: FitResolver defers, it does not reject.

### 4. Placement — within a row

Once LaunchPad has chosen which offers go in a row, Placement decides which seats within the row each group gets, based on the row's `lean`:

- **CENTER:** Best-ranked group gets the center seats. Subsequent groups expand outward symmetrically.
- **LEFT:** Best-ranked group gets the leftmost (or innermost-aisle, depending on venue convention) seats. Others extend rightward.
- **RIGHT:** Mirror of LEFT.
- **DUAL_AISLE:** Best groups get aisle seats; fills inward.

Placement uses a position index (0-based) for the math, then translates to printed seat numbers via `row.seatNumbers[position]`. Holds are skipped (positions where `seatNumbers[i] ∈ row.holds`).

For GA rows (`isGa: true`), placement is trivial: assign next available synthetic seat number.

### 5. Waterfall — between tiers

After LaunchPad completes a pass over all rows, any offer with `tierPreference.type !== 'specific'` that wasn't placed in its preferred tier is considered for the next-compatible tier:

- `this_or_better`: try tiers above the preferred one. Rare in practice (fans don't usually bid down to upgrade).
- `this_or_worse`: try tiers below the preferred one. The common case.
- `any`: try all tiers.

Waterfalling runs LaunchPad again, but only against the unplaced offers and the rows in their now-expanded tier set. Each waterfall iteration emits a `WATERFALLED` decision for each offer that gets placed via this mechanism.

Stop condition: a full pass with no new placements. At that point, remaining offers are truly unplaced and emitted in the `unplaced` array of the result.

---

## Edge cases and how we handle them

### Orphan seats

A single seat that can't be filled because no group of size 1 is in the ranked pool. Per the `orphanPolicy`:

- `leave`: the seat stays unsold; emit `ORPHAN_DETECTED` decision.
- `bump_to_next_row`: try to push one of the placed groups to the next row to consolidate the orphan. Complex; not in MVP.

MVP default: `leave`. Most shows will have a handful of orphans; that's acceptable.

### Equal-rank offers

Two offers with identical RankKey. The tiebreaker is `submittedAt` (earlier wins). If those are also identical (essentially impossible in practice), tiebreak by `offerId` (lexicographic).

### Offers exceeding any single row's capacity

A group of 12 in a venue where no row has 12 contiguous seats. Without `acceptSplit`, this offer is unplaceable; emit it in `unplaced` with reason `'no_fit_anywhere'`. The artist may handle out-of-band.

With `acceptSplit: true` (Phase 1.5): we attempt to split across adjacent rows. Not in MVP.

### Holds in the middle of a row

A row of capacity 10 with holds at seats 5 and 6. Treat this as "capacity 8, but discontiguous." Groups larger than the largest contiguous run can't fit.

The `placeInRow` function must compute contiguous runs, then the fit logic operates on those. This is correct behavior: a group of 6 can't fit in `[1-4][7-10]` even though total available is 8.

### Tier preferences with no compatible rows

A fan expresses `{ type: 'specific', tier: 'premium' }` but no premium rows are active in this show. Offer goes to `unplaced` with reason `'no_compatible_tier'`.

### Preview vs binding mode

The algorithm is identical. The difference is purely in what the orchestration layer does with the result: preview writes to `allocation_previews` and does not trigger payments/emails; binding writes to `seat_assignments` and `allocation_logs` and triggers downstream effects.

The GAE itself doesn't know which mode it's in (and shouldn't).

---

## Tests

The GAE has the strictest testing standards in the codebase. Every public function has tests covering at minimum:

### Unit tests for `rankkey.ts`

- Computes correctly for typical inputs.
- Higher price wins regardless of group size.
- Equal price: larger group wins.
- Equal price and group: earlier submission wins.

### Unit tests for `launchpad.ts`

- Clean fit: 3 offers totaling exactly 14 seats into a 14-seat row → all placed.
- Surplus inventory: 5 offers totaling 10 seats into a 14-seat row → all placed, 4 unfilled.
- Oversubscribed: offers totaling 20 seats into a 14-seat row → rank-best 14-seats-worth placed, rest deferred.
- Orphan creation: `[6, 6]` into a 13-seat row → one 6 placed, FitResolver skips next 6 (won't fit), one orphan seat. (Or alternative: two 6s placed and orphan accepted per policy.)
- Skip-and-defer: `[6, 4, 6]` (rank order) into 14-seat row followed by 8-seat row → first row gets [6, 4] and the trailing 6 defers to the second row. (Greedy. Note: an earlier draft wrote this pool as `[6, 6, 4]` with the same outcome, which is impossible under the greedy algorithm — greedy never defers an offer that *fits*, so `[6, 6, 4]` would put both 6s in the 14-seat row and send the 4 to the second. The deferral this case exercises requires the second 6 to arrive after the row is already down to fewer than 6 seats.)
- Holds in row: row of 10 with holds at positions 5-6 → groups larger than 4 contiguous don't fit there.
- Empty inputs: no offers or no rows → empty result, no crash.

### Unit tests for `fitresolver.ts`

- Skips offer that doesn't fit, finds next that does.
- Returns null when no compatible offer fits.
- Doesn't remove the skipped offer from the pool.

### Unit tests for `placement.ts`

- CENTER lean: best group goes to center.
- LEFT lean: best group goes to left/inward-aisle.
- DUAL_AISLE: best group goes to aisles.
- GA rows: ignores lean, assigns next available.
- Skips held seats correctly.
- Position index → printed seat number translation.

### Unit tests for `waterfall.ts`

- Offer with `this_or_worse` placed in lower tier when preferred tier is full.
- Offer with `specific` not waterfalled even if other tiers have space.
- Offer with `any` placed in any compatible tier.
- Multi-iteration waterfall: offers cascade through 3+ tiers correctly.
- Stop condition: no placements in a pass → halt.

### Integration tests (still in the GAE module, no DB)

- The Lincoln Theatre scenario from the spec, with real venue architecture and a known offer pool. Expected output committed as a fixture; any change to expected output requires explicit acknowledgment.
- A 50-seat untraditional venue (Cope's place layout) with a small offer pool.
- A sectioned-off Austin theater (only certain sections active) with mixed reserved + GA.

These integration tests serve as both regression protection and as the canonical reference for "what does the GAE produce for X input." When debating algorithm changes, point at the test fixtures.

### Property-based tests (nice-to-have, Phase 1.5)

- Rank monotonicity: a higher-ranked offer never receives a worse seat than a lower-ranked one.
- Group integrity: every placed offer occupies `groupSize` contiguous seats.
- Total accounting: `placed.seats + unplaced.seats + orphans + unfilled = total venue capacity`.
- Determinism: same input + same config = same output, always.

Use `fast-check` or similar for these.

---

## What the GAE looks like in code

Approximate file structure:

```
src/lib/gae/
├── index.ts            # public entry point: allocate(venue, offers, config)
├── rankkey.ts          # RankKey computation
├── launchpad.ts        # Row-by-row allocation loop
├── fitresolver.ts      # Skip-and-find-next logic
├── placement.ts        # Within-row placement by lean
├── waterfall.ts        # Cross-tier waterfalling
├── types.ts            # All GAE types
└── *.test.ts           # Co-located tests
```

The public API surface from `index.ts` is minimal:

```typescript
export function allocate(
  venue: VenueArchitecture,
  offers: RankedOffer[],
  config: AllocationConfig
): AllocationResult;

export type {
  VenueArchitecture, VenueRow,
  RankedOffer, TierPreference,
  AllocationConfig, AllocationResult,
  SeatAssignment, AllocationDecision,
};
```

Internal helpers are not exported.

---

## When in doubt

If you find yourself in the GAE module unsure whether something is a GAE responsibility or an orchestration responsibility, ask: **does this code need to talk to a database, an external service, or the filesystem?** If yes, it doesn't belong in the GAE — move it to `src/server/`. The GAE is pure.

If you find yourself wanting to optimize the algorithm beyond greedy, fine — but write the new implementation alongside the old one, A/B them against the integration test fixtures, and only swap when the new one is provably better on real-world inputs. The greedy version is good enough for the first dozen shows.
