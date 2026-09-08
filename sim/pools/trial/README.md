# Trial pools — one engine edge case each

Seventeen small offer pools, each built to exercise one allocation edge case on the seeded **Cope's place** (rows A/B premium 8+8, C/D mid 6+6, GA 22 — 50 seats). They came from the `chore/trial-allocation-fixtures` branch, whose own runner is superseded by the simulator CLI. Columns: `id, groupSize, price (dollars), tier` with the usual tier tokens (`premium` exact, `premium-` this-or-worse, `premium+` this-or-better, `any`).

Run any of them:

```bash
npm run sim -- run sim/scenarios/trial/pool.json --pool sim/pools/trial/06_orphan_single_seat.csv
npm run sim -- run sim/scenarios/trial/15-holds-split-row.json      # the three venue-dependent cases have their own scenarios
npm run sim -- run sim/scenarios/trial/16-lean-placement.json
npm run sim -- run sim/scenarios/trial/17-partial-activation.json
npm run sim -- run sim/scenarios/trial/pool.json --pool sim/pools/trial/13_mixed_realistic.csv --policies greedy,clean-fit,lookahead
```

| File | Edge case | Expected |
|---|---|---|
| 01_clean_fit | exact tiling | 100% fill, 0 empty, 0 unplaced |
| 02_undersubscribed | demand far below capacity | all placed, low fill |
| 03_oversubscribed_premium_specific | contention; `specific` never waterfalls | top 8 by price placed, rest `no_fit_anywhere` |
| 04_equal_rank_ties | identical price and size | earliest row wins (submittedAt tiebreak) |
| 05_big_group_beats_small | equal price, bigger group ranks first | big 6 first; FitResolver fills the gap |
| 06_orphan_single_seat | single leftover seat | one 1-seat hole in row A |
| 07_waterfall_or_worse | `this_or_worse` cascades down | w1→C, w2→D, w3→GA, all WATERFALLED |
| 08_no_compatible_tier | a tier that doesn't exist | `no_compatible_tier` |
| 09_oversized_no_fit | group bigger than any row | `no_fit_anywhere` |
| 10_cap_not_enforced | group of 11 with cap 10 | placed anyway — the engine still doesn't enforce `maxGroupSize` (the demand model does) |
| 11_single_offer | degenerate minimum | one placement |
| 12_waterfall_up | `this_or_better` cascades up | u1 lands in leftover premium row B |
| 13_mixed_realistic | believable oversubscribed show | ~98% fill; the strict-then-waterfall pass order shows up as "passed over" |
| 14_scale_oversubscribed | ~200 offers for 50 seats | 100% fill, most unplaced |
| 15_holds_split_row | holds split a row into runs | 7-group skips A (longest run 3), fits B — scenario `15-holds-split-row` |
| 16_lean_placement | LEFT / RIGHT / CENTER / DUAL_AISLE | four distinct seat strips in the seat map — venue `lean-demo`, scenario `16-lean-placement` |
| 17_partial_activation | a tier's rows all inactive | mid offers → `no_compatible_tier` — scenario `17-partial-activation` |

What the fixture branch flagged as engine gaps, and where they stand now: `maxGroupSize` is still not enforced inside the engine (10); `split_required_but_not_allowed` is still never emitted (09); the cross-tier rank inversion from the strict-then-waterfall order (13) is now measured as "passed over" in every report rather than hidden; parity is now available as the opt-in `parity-tiebreak` policy (16); deactivating a tier still strands offers anchored to it (17).
