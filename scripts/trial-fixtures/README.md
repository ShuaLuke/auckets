# Trial allocation fixtures (Track A — engine / edge cases)

CSV bid pools fed to the pure GAE via `scripts/sim-allocate.ts`. No DB, no
auth, no Stripe — each file just exercises one allocation edge case against the
seeded **Cope's place** venue:

| Tier    | Rows        | Seats |
|---------|-------------|-------|
| premium | A (8), B (8)| 16    |
| mid     | C (6), D (6)| 12    |
| ga      | GA (22)     | 22    |
| **Total** |           | **50** |

All seated rows are `CENTER` lean; GA is a bucket. No holds in this venue
(hold / lean / partial-activation cases need a `--venue` override — see bottom).

## Run

```
npx tsx scripts/sim-allocate.ts scripts/trial-fixtures/01_clean_fit.csv
# price column is DOLLARS per ticket by default
```

Columns: `id, groupSize, price(dollars), tier`. Tier tokens: `premium` / `mid`
/ `ga` (exact), `+` = this-or-better, `-` = this-or-worse, `any` = anywhere.

## Fixtures → what each one probes

| File | Edge case | Intended outcome |
|------|-----------|------------------|
| 01_clean_fit | exact tiling | 100% fill, 0 orphan, 0 unplaced |
| 02_undersubscribed | demand << capacity | all placed, low fill, lots unfilled |
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
| 13_mixed_realistic | believable oversubscribed show | mixed placements, waterfalls, orphans, unplaced |
| 14_scale_oversubscribed | ~200 offers / 50 seats | scale + heavy contention (run `_gen-scale.mjs` first) |

## Known engine gaps these surface (see chat for detail)

- **maxGroupSize is not enforced inside the GAE** (`_config` is ignored) — 10/12.
- **`split_required_but_not_allowed` is never emitted** — oversized groups come
  back `no_fit_anywhere` — 09.
- **`orphanSeats` counts all unused seats in any touched row**, not just awkward
  singles — visible in 02 / 06.

## Not yet covered (need a venue override)

Holds (mid-row gaps / contiguous runs), non-CENTER lean placement, partial
venue activation (`activeRowIds` subset), and parity all depend on the venue,
which `sim-allocate` hard-codes. Add a `--venue=path.json` flag to cover them.
