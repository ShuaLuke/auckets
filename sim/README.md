# GAE simulator

Run the real allocation engine (`src/lib/gae`) against a venue and an offer pool, get a fill report, keep the run, compare runs. Requirements and roadmap: [`docs/GAE_SIMULATOR.md`](../docs/GAE_SIMULATOR.md). This folder is the tool's data: venues, scenarios, pools. Run output goes to `sim/runs/` (gitignored).

Nothing here touches the database, Stripe, email, or env. The engine is pure; so is the sim core (`src/lib/sim`). Only `scripts/sim.ts` reads and writes files.

## Commands

```bash
npm run sim -- venue list
npm run sim -- venue show lincoln-v4
npm run sim -- venue add my-venue.json            # venue JSON or tier-spec JSON (see below)

npm run sim -- run sim/scenarios/lincoln-v4-mix.json
npm run sim -- run sim/scenarios/lincoln-v4-mix.json --group-mix "1:10,2:45,3:10,4:25,5:5,6:5" --seeds 20 --name couples
npm run sim -- run sim/scenarios/lincoln-v4-mix.json --venue copes-place --oversub 1.5 --seed 3
npm run sim -- run sim/scenarios/lincoln-v4-mix.json --active "ORCH C,ORCH L,ORCH R"   # sell part of the room
npm run sim -- run sim/scenarios/lincoln-v4-cope-pool.json                           # Cope's real 512-offer pool
```

Every `run` prints the fill report and writes `sim/runs/<name>/`:

| File | What it is |
|---|---|
| `report.md` | Venue and offer parity summaries, then the **fill report** per policy: overall, by tier, by area, by group size, preference honouring, rank-respect, the artist's per-section view, invariants |
| `offers.csv` | One row per offer, rank order: size, price, preference, where it landed, outcome. Opens in Excel |
| `seatmap.txt` | Every active row, seat by seat: `[offer×n]` groups, `.` empty, `#` held |
| `result.json` | Everything above as data, plus the engine's full output for the first seed |
| `scenario.json` | The inputs after CLI overrides, so the run reproduces without the flags |

With `--seeds N` the pool is regenerated N times (seed, seed+1, …) and the report shows p50 / p5 / p95. The run exits non-zero if any invariant fails (contiguity, total accounting, double booking, free upgrades). Same scenario + seed always gives the same result hash.

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
  "policies": ["greedy"],                     // only the shipped policy exists in slice 1
  "seeds": 1
}
```

Pool CSV columns are matched by name, case-insensitively: a group-size column (`GroupSize`, `size`, `party`, `qty`…), a price column (`PricePerTicket`, `price`, `bid`… in dollars; pass `--price=cents` if not), optional `tier` (`premium` = only that tier, `premium-` = that or worse, `premium+` = that or better, `any`), optional `id`, optional `TimestampOrder` for tie-breaks. Cope's "Full Offer Pool v4" sheet exported to CSV loads as is.

## Venue library

`sim/venues/<name>.json`. Ships with:

| Name | Room |
|---|---|
| `lincoln-v4` | Cope's 144-row Lincoln Theatre RowRank architecture, 1,152 seats, with his relief-row flags |
| `copes-place` | The seeded 50-cap alpha venue |
| `lincoln-synthetic` | The 5-row fixture from the engine's tests |
| `austin-partial` | The sectioned-off Austin fixture (two rows inactive) |

`venue add` accepts two JSON shapes:

- **Venue JSON** — the library format: `name`, `displayName`, `venueId`, `rows[]` (the engine's `VenueRow`: id, area, section, rowName, rowRank, capacity, parity, lean, seatNumbers, holds, tier, isGa), optional `activeRowIds`, `tierFloorsCents`, `relief`, `notes`.
- **Tier spec** — quick uniform rooms: `{ "name", "displayName", "tiers": [{ "name": "front", "rowCount": 2, "seatsPerRow": 6, "floorCents": 6000 }, { "name": "ga", "rowCount": 1, "seatsPerRow": 40, "unitType": "ga" }] }`.

Importing Cope's workbook (`.xlsx`) and box-office manifests (`.csv`) directly is slice 2. The Lincoln v4 workbook was converted once by hand for slice 1.

## Reading the fill report

- **Fill rate / empty seats / holes** — what the room looks like after allocation. Hole sizes tell you whether stranding is parity-shaped (all 1-seat holes) or something a policy could fix.
- **By group size** — the "how does this mix fill" table: for 1s, 2s, 3s… how many were seated, what share, and how far back they sat (median row rank).
- **Gross placed / left on table** — revenue seated vs the value of unplaced offers.
- **Passed over** — offers a lower-ranked group beat to a better row it could actually have fit (the group's block plus the empty seats touching it). This is the spec's "rank-respect subject to fit", counted. Greedy only produces these through the strict-tier pass running before the waterfall; fill-first policies (slice 3) will produce them on purpose.
- **Invariants** — always "all clear" unless a policy is broken.
