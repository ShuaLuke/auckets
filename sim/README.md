# GAE simulator

Run the real allocation engine (`src/lib/gae`) against a venue and an offer pool, get a fill report, keep the run, compare runs. Requirements and roadmap: [`docs/GAE_SIMULATOR.md`](../docs/GAE_SIMULATOR.md). This folder is the tool's data: venues, scenarios, pools. Run output goes to `sim/runs/` (gitignored).

Nothing here touches the database, Stripe, email, or env. The engine is pure; so is the sim core (`src/lib/sim`). Only `scripts/sim.ts` reads and writes files.

## Commands

```bash
npm run sim -- venue list
npm run sim -- venue show lincoln-v4
npm run sim -- venue add my-venue.json                                   # venue JSON or tier-spec JSON (see below)
npm run sim -- venue add ~/Downloads/His_RowRank_Workbook.xlsx --name x --floors "orchestra=85,front_balcony=70,upper_balcony=50"
npm run sim -- venue add ~/Downloads/box-office-manifest.csv --name y   # UTF-16 tab-separated exports work as is
npm run sim -- import-pool ~/Downloads/His_RowRank_Workbook.xlsx --out sim/pools/x.csv   # picks the "Full Offer Pool" sheet

npm run sim -- run sim/scenarios/lincoln-v4-mix.json
npm run sim -- run sim/scenarios/lincoln-v4-mix.json --group-mix "1:10,2:45,3:10,4:25,5:5,6:5" --seeds 20 --name couples
npm run sim -- run sim/scenarios/lincoln-v4-mix.json --venue copes-place --oversub 1.5 --seed 3
npm run sim -- run sim/scenarios/lincoln-v4-mix.json --active "ORCH C,ORCH L,ORCH R"   # sell part of the room
npm run sim -- run sim/scenarios/lincoln-v4-cope-pool.json                           # Cope's real 512-offer pool

npm run sim -- compare-runs couples singles-rich                # any saved runs, side by side, deltas vs the first

npm run sim -- compare sim/scenarios/lincoln-v4-cope-pool.json --policies greedy,clean-fit,clean-fit+singles-reserve   # Q1/Q2
npm run sim -- run sim/scenarios/lincoln-v4-autobid.json --raise percent:5     # auto-bid step rule: fixed:5 (shipped) or percent:5
```

Every `run` prints the fill report and writes `sim/runs/<name>/`:

| File | What it is |
|---|---|
| `report.md` | Venue and offer parity summaries, then the **fill report** per policy: overall, by tier, by area, by group size, preference honouring, rank-respect, the artist's per-section view, invariants |
| `offers.csv` | One row per offer, rank order: size, price, preference, where it landed, outcome. Opens in Excel |
| `seatmap.txt` | Every active row, seat by seat: `[offer×n]` groups, `.` empty, `#` held |
| `result.json` | Everything above as data, plus the engine's full output for the first seed |
| `scenario.json` | The inputs after CLI overrides, so the run reproduces without the flags |

`compare-runs` takes two or more run folders (names under `sim/runs/` or paths) and writes `compare.md`: the fill report columns side by side with deltas against the first run, placed % and median row rank per group size, fill and gross per tier, and, when two runs used the same offers on the same venue, a per-offer "who moved" list.

With `--seeds N` the pool is regenerated N times (seed, seed+1, …) and the report shows p50 / p5 / p95. The run exits non-zero if any invariant fails (contiguity, total accounting, double booking, free upgrades). Same scenario + seed always gives the same result hash.

## Policies

`policies` in a scenario (or `--policies a,b,c`) runs each engine variant on the same pool and adds a "Policies compared" section with deltas and a who-moved list. They map to opt-in `AllocationConfig` fields in `src/lib/gae/types.ts`; production stays on the defaults until an ADR flips one.

| Policy | What it changes | Rank-first? |
|---|---|---|
| `greedy` | Shipped behaviour | yes |
| `clean-fit` | When placing a group that fits would strand seats no remaining offer can exactly fill, defer it and take the next group that closes the row. Falls back to greedy when nothing does. Logged as `FIT_RESOLVED` with `snapshot.policy = "clean_fit"` | subject to those deferrals — they show up under "passed over" |
| `parity-tiebreak` | At **equal price** only (the spec's rank tie, normally larger group first), prefer the group whose size parity matches the remaining run. Never crosses a price | yes, ties reordered |
| `singles-reserve[:k]` | Hold back the k lowest-ranked single-seat offers (default k = number of 1-seat rows) until everyone else is seated; then 1-seat rows first, anywhere second | **no** — preventive hoarding, the smallest guard for the parity hypothesis |
| `a+b` | Combine, e.g. `clean-fit+singles-reserve` | as its parts |

On Cope's pool and architecture: greedy 1,133 / 1,152 seated, 19 one-seat holes; clean-fit 1,144 (+$2,800, 29 passed over, ≤5 rows, ≤$25 gap); clean-fit + reserve 1,150 (+$4,300, 105 passed over). Parity tiebreak alone changes nothing on that pool.

## Auto-bid

A generated pool can carry an auto-bid share (`generate.autoBid: { "sharePct": 25, "capMultiplier": [1.2, 1.6] }`); a pool CSV can carry a `cap` column (dollars). Before each policy runs, the sim resolves auto-bids the way production does (ADR-0018): run the engine, raise every displaced bidder one step up to its cap, repeat until stable. The step rule is on the scenario: `"autoBidRaiseRule": { "kind": "fixed", "cents": 500 }` (shipped) or `{ "kind": "percent", "pct": 5 }` (Cope's preference), or `--raise fixed:5 | percent:5`. The report's Auto-bid section shows bidders, how many raised, dollars added, who held their section, and who capped out. Compare two runs with different rules to settle NEW-13.

## Scenario file

```jsonc
{
  "name": "lincoln-v4-mix",
  "venue": "lincoln-v4",                      // library name, or { "file": "path.json" }
  "show": {                                   // optional per-show overlay
    "activeSections": ["ORCH C", "FC BAL"],   // section or area names; omit = whole room
    "activeRowIds": ["..."],                  // or explicit row ids (wins over activeSections)
    "holds": [
      { "source": "artist", "tier": "orchestra", "seats": 8 },      // best rows first
      { "source": "venue", "seatIds": ["orch_c-aa:101"] }           // "<rowId>:<seat>"
    ],
    "floorsCents": { "orchestra": 8500 },     // overrides the venue's tierFloorsCents
    "maxGroupSize": 10
  },
  "pool": {
    "file": "sim/pools/lincoln-pool-v4.csv"   // OR:
    // "generate": {
    //   "seed": 1,
    //   "oversubscription": 1.25,                       // tickets requested ÷ seats on sale
    //   "groupSizeMix": { "1": 10, "2": 45, "3": 10, "4": 25, "5": 5, "6": 5 },   // % of offers, sums to 100
    //   // or a preset: "even-heavy" | "odd-heavy" | "singles-rich" | "couples" | "big-groups" | "lincoln-v4"
    //   "priceModel": { "kind": "ladder", "ladderCents": 2500, "meanStepsAboveFloor": 3 },
    //   // or { "kind": "lognormal", "ladderCents": 2500, "medianMultiple": 1.3, "sigma": 0.35 }
    //   "tierPreferenceMix": { "specific": 20, "this_or_worse": 60, "this_or_better": 5, "any": 15 },
    //   "tierChoice": "premium-biased"                  // or "uniform"
    // }
  },
  "policies": ["greedy", "clean-fit"],        // see Policies above
  "seeds": 1,
  "autoBidRaiseRule": { "kind": "fixed", "cents": 500 }   // optional; see Auto-bid
}
```

Pool CSV columns are matched by name, case-insensitively: a group-size column (`GroupSize`, `size`, `party`, `qty`…), a price column (`PricePerTicket`, `price`, `bid`… in dollars; pass `--price=cents` if not), optional `tier` (`premium` = only that tier, `premium-` = that or worse, `premium+` = that or better, `any`), optional `id`, optional `TimestampOrder` for tie-breaks. Cope's "Full Offer Pool v4" sheet exported to CSV loads as is.

## Venue library

`sim/venues/<name>.json`. Ships with:

| Name | Room |
|---|---|
| `lincoln-v4` | Cope's 144-row Lincoln Theatre RowRank architecture, 1,152 seats, with his relief-row flags. Produced by `venue add` from his workbook; re-importing reproduces it |
| `lincoln-manifest` | The same theatre from the box-office seat manifest (May 2026 onsale snapshot): 157 rows incl. boxes, 1,265 seats, 143 held by hold group, tiers = price levels P1–P5, RowRank derived |
| `copes-place` | The seeded 50-cap alpha venue |
| `lincoln-synthetic` | The 5-row fixture from the engine's tests |
| `austin-partial` | The sectioned-off Austin fixture (two rows inactive) |

`venue add` accepts four inputs, picked by file extension:

- **Venue JSON** — the library format: `name`, `displayName`, `venueId`, `rows[]` (the engine's `VenueRow`: id, area, section, rowName, rowRank, capacity, parity, lean, seatNumbers, holds, tier, isGa), optional `activeRowIds`, `tierFloorsCents`, `relief`, `notes`.
- **Tier spec JSON** — quick uniform rooms: `{ "name", "displayName", "tiers": [{ "name": "front", "rowCount": 2, "seatsPerRow": 6, "floorCents": 6000 }, { "name": "ga", "rowCount": 1, "seatsPerRow": 40, "unitType": "ga" }] }`.
- **Cope's RowRank workbook (`.xlsx`)** — the sheet with GlobalRowRank, Area, ManifestSection, Row, WorkingL, Parity, Lean, PrintedSeatList, SingleInventoryFlag, GapReliefEligible, ActiveStatus. Header names are matched loosely. The sheet is auto-picked (name containing "RowRank"); override with `--sheet`. Tiers are the areas (`--tier-by section` to use manifest sections); pass `--floors "tier=dollars,…"` so pools can be generated. PrintedSeatList must list only the working seats, as his V–Y rows do.
- **Box-office manifest (`.csv` / `.tsv`)** — one line per seat: Section Name, Row Name, SeatName, Price Value, Price Level Name, Hold Group Name, Hold Name / Offer Name. UTF-16 with BOM is fine. Rows are grouped, seats sorted, hold groups become holds (1-TECH → production, 2-HOUS/5-ADA → venue, 3-ARTI → artist, 4-MKTG → comp; `--ignore-holds` to drop), sold seats stay open unless `--sold-as-held`. Tiers are the price levels and floors their prices. **RowRank is derived** (price level, then AA before A, then section order); hand it a sidecar with `--rank-file section,row,rowRank.csv` when the room disagrees. Lean is inward by section name (L → RIGHT, R → LEFT), area guessed from the section name.

`import-pool` reads an offer sheet or CSV (same column matching as pools) and writes the normalised `id,size,price,tier,order` CSV a scenario points at.

## Reading the fill report

- **Fill rate / empty seats / holes** — what the room looks like after allocation. Hole sizes tell you whether stranding is parity-shaped (all 1-seat holes) or something a policy could fix.
- **By group size** — the "how does this mix fill" table: for 1s, 2s, 3s… how many were seated, what share, and how far back they sat (median row rank).
- **Gross placed / left on table** — revenue seated vs the value of unplaced offers.
- **Passed over** — offers a lower-ranked group beat to a better row it could actually have fit (the group's block plus the empty seats touching it). This is the spec's "rank-respect subject to fit", counted. Greedy only produces these through the strict-tier pass running before the waterfall; fill-first policies (slice 3) will produce them on purpose.
- **Invariants** — always "all clear" unless a policy is broken.
