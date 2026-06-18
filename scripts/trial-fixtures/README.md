# Trial allocation fixtures (Track A — engine / edge cases)

CSV bid pools fed to the pure GAE via the self-contained runner `run.ts`. No DB,
no auth, no Stripe — each file exercises one allocation edge case. Default venue
is the seeded **Cope's place**; venue-dependent cases load a `--venue` JSON.

| Tier    | Rows        | Seats |
|---------|-------------|-------|
| premium | A (8), B (8)| 16    |
| mid     | C (6), D (6)| 12    |
| ga      | GA (22)     | 22    |
| **Total** |           | **50** |

## Run

```
npx tsx scripts/trial-fixtures/run.ts scripts/trial-fixtures/01_clean_fit.csv
# price column is DOLLARS per ticket by default; pass --price=cents for integer cents
# custom room:  --venue=scripts/trial-fixtures/venue_holds.json
```

`run.ts` is committed and self-contained (it replaces the untracked
`scripts/sim-allocate.ts` for this suite): same CSV interface, plus a `--venue`
override and a per-SEAT map so lean placement is actually visible.

Columns: `id, groupSize, price(dollars), tier`. Tier tokens: `premium` / `mid`
/ `ga` (exact), `+` = this-or-better, `-` = this-or-worse, `any` = anywhere.

## Fixtures → what each one probes

| File | Edge case | Confirmed outcome |
|------|-----------|-------------------|
| 01_clean_fit | exact tiling | 100% fill, 0 orphan, 0 unplaced |
| 02_undersubscribed | demand ≪ capacity | all placed, low fill, lots unfilled |
| 03_oversubscribed_premium_specific | contention, `specific` never waterfalls | top 8 by price placed, rest `no_fit_anywhere` |
| 04_equal_rank_ties | identical price+size | earliest CSV row wins (submittedAt tiebreak) |
| 05_big_group_beats_small | equal price, bigger group ranks first | big6 first; FIT_RESOLVED fills the gap |
| 06_orphan_single_seat | single leftover seat | ORPHAN_DETECTED in row A |
| 07_waterfall_or_worse | `this_or_worse` cascades DOWN | w1→C, w2→D, w3→GA, all WATERFALLED |
| 08_no_compatible_tier | tier that doesn't exist | `no_compatible_tier` |
| 09_oversized_no_fit | group bigger than any row | `no_fit_anywhere` (NOT `split_required…` — see gaps) |
| 10_cap_not_enforced | group of 11 (> cap 10) | placed anyway — engine ignores maxGroupSize |
| 11_single_offer | degenerate min | one placement, near-empty venue |
| 12_waterfall_up | `this_or_better` cascades UP | u1 waterfalls into leftover premium row B |
| 13_mixed_realistic | believable oversubscribed show | 13/24 placed, 98% fill — surfaced the rank inversion |
| 14_scale_oversubscribed | ~200 offers / 50 seats | 100% fill, 15 placed, 185 out (`_gen-scale.mjs` regenerates) |
| 15_holds_split_row | holds split a row into runs | `--venue=venue_holds.json`: 7-group skips A (max run 3), fits B |
| 16_lean_placement | LEFT/RIGHT/CENTER/DUAL_AISLE | `--venue=venue_lean.json`: four visibly distinct seat strips |
| 17_partial_activation | a tier's rows all inactive | `--venue=venue_partial.json`: mid offers → `no_compatible_tier` |

## Venue overrides

| File | Room |
|------|------|
| venue_holds.json | Cope's place, holds at A4–A5 (splits A into two 3-runs) and B1 |
| venue_lean.json | one row per lean (LEFT/RIGHT/CENTER/DUAL_AISLE), single tier `main` |
| venue_partial.json | Cope's place with the mid rows excluded from `activeRowIds` |

## Engine gaps these surface (see chat / memory for detail)

- **maxGroupSize is not enforced inside the GAE** (`_config` is ignored) — 10/12.
- **`split_required_but_not_allowed` is never emitted** — oversized groups come
  back `no_fit_anywhere` — 09.
- **`orphanSeats` counts all unused seats in any touched row**, not just awkward
  singles — visible in 02 / 06 / 17.
- **Leftovers-only waterfall → cross-tier rank inversion** — a higher-ranked
  holdout can lose a lower tier to a much lower-ranked offer — 13.
- **Deactivating a tier strands offers anchored to it** even when they'd accept a
  worse *active* tier (`this_or_worse` can't relativize against an absent tier) — 17.
- **`parity` is modeled but ignored** by placement (only `lean` is used) — 16.

## Tooling
- `run.ts` — the runner (CSV in, ranked bids + per-seat map + stats out).
- `_gen-scale.mjs` — regenerates `14_scale_oversubscribed.csv`.
- `_bench.ts` — micro-benchmarks pure-GAE compute time across pool sizes.
