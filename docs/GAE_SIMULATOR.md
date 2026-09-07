# GAE Simulator — requirements and how we'll use it

*Status: requirements agreed 2026-09-07. Slices 1 and 2 built (PRs #136, S2 stacked on it) — see `sim/README.md` for usage. S3 onward still to build.*

---

## 1. Why this exists

The engine works. What's not finished is the **rulebook**: five product questions from Cope's GAE Playbook are still open, and none of them can be settled by argument. They need numbers.

| # | Open question | What would settle it |
|---|---|---|
| Q1 | Objective: rank-respect first, fill second (our spec) vs revenue/efficiency with lookahead (Cope's Phase 6) | Fill, gross, and rank-cost of each policy on realistic pools |
| Q2 | Parity: "odd groups to odd rows when practical" vs parity-as-instrumentation-only | How many seats strand in odd-shaped holes across pool mixes, and what each parity guard recovers |
| Q3 | Rolling "Admission Confirmed" during the window vs preview + binding checkpoint (ADR-0004) | How many fans get told "you're in" then displaced, under each model |
| Q4 | Post-binding inventory (returns, releases): keep the unplaced pool live vs release it | Refill rate and revenue recovered when X% of seats come back after binding |
| Q5 | Cope's "ring the register": accept offers that may or may not be seated | Revenue booked during the window vs seats actually available, by day |

On 2026-09-05 Cope said most of these "will be answered if we can do some seating simulations… almost a distribution with yield capacity." This tool is that.

The 2026-09-05 spike already showed the shape of the answer on his Lincoln data (98.35% fill shipped, 7 empty seats with clean-fit, 0 with a singles reserve, at a known rank cost). That spike was throwaway. The simulator makes that kind of experiment **repeatable, comparable, and readable by non-engineers**, so each open question closes with a report, an ADR, and a golden fixture instead of a conversation.

**This is an internal tool, not a product feature.** It never touches the database, Stripe, email, or env. Later, the same pure core can sit behind the admin "Simulation" tab (Julia has a design outline for it), but that UI is out of scope here.

---

## 2. Who uses it, and how

**Josh** runs experiments from the CLI, commits scenario files and reports, and promotes agreed outcomes to golden fixtures.

**Cope and Julia** read reports, edit the inputs they already work in (his RowRank workbook, an offer-pool sheet, a CSV), and ask for runs. They never run code.

The loop, per open question:

1. **Define a scenario.** A venue + an offer pool (real or generated) + one or more engine policies. A small JSON file, plus the spreadsheet/CSV it points at.
2. **Run it.** One command. Output is a run folder: machine-readable JSON, a human report, a per-offer CSV that opens in Excel.
3. **Compare.** Policies side by side on the same pool. Or the same policy across many generated pools (seeds) to get a distribution, not a single number.
4. **Decide.** Cope reads the report and picks. Josh writes the ADR.
5. **Lock it in.** The scenario becomes a committed test fixture, so the engine can't drift from the decision.

Example session:

```bash
# Upload a new venue into the library (xlsx, manifest CSV, or JSON) — once per venue
npm run sim -- venue add ~/Downloads/GAE_Lincoln_Full_RowRank_Architecture_v4_with_Full_Offer_Pool.xlsx --sheet "Full RowRank Architecture" --name lincoln-v4
npm run sim -- venue add "~/Downloads/Lincoln there seat manifest.csv" --format manifest --name lincoln-manifest
npm run sim -- venue list          # lincoln-v4 (1,152 seats, 144 rows, 3 tiers) · copes-place (50) · austin-partial (…) · daikin (43,445)
npm run sim -- venue show lincoln-v4   # summary: rows, capacity by tier/area, odd/even rows, single rows, relief rows, holds

# Import Cope's pool sheet once → a pool file the sim understands
npm run sim -- import-pool ~/Downloads/GAE_Lincoln_Full_RowRank_Architecture_v4_with_Full_Offer_Pool.xlsx --sheet "Full Offer Pool v4" --out sim/pools/lincoln-pool-v4.csv

# Pick any venue from the library for a run; --active limits it to some sections (the Austin case)
npm run sim -- run sim/scenarios/objective.json --venue lincoln-v4
npm run sim -- run sim/scenarios/objective.json --venue austin --active "ORCH C,FC BAL"

# Q1: which objective? Three policies, one pool
npm run sim -- compare sim/scenarios/lincoln-v4.json --policies greedy,clean-fit,clean-fit+singles-reserve

# Group-size mix as plain percentages: 1s, 2s, 3s, 4s, 5s, 6s… (must sum to 100)
npm run sim -- run sim/scenarios/lincoln-v4.json --group-mix "1:10,2:45,3:10,4:25,5:5,6:5" --seeds 20 --name couples-heavy
npm run sim -- run sim/scenarios/lincoln-v4.json --group-mix "1:30,2:30,3:15,4:15,5:5,6:5" --seeds 20 --name singles-rich

# Compare two saved runs side by side (any two runs: different mixes, policies, venues, or dates)
npm run sim -- compare-runs sim/runs/couples-heavy sim/runs/singles-rich

# Q2: parity — does stranding depend on the pool mix? 50 generated pools each
npm run sim -- sweep sim/scenarios/lincoln-v4.json --vary pool.groupSizeMix=even-heavy,odd-heavy,singles-rich --seeds 50

# Yield curve: how do fill and gross move as demand goes from 0.6x to 2.0x capacity?
npm run sim -- sweep sim/scenarios/lincoln-v4.json --vary pool.oversubscription=0.6:2.0:0.1 --seeds 20
```

Every run ends with a **fill report** on screen (§4.8) and writes `sim/runs/<name>/` with `report.md`, `result.json`, `offers.csv`, `seatmap.txt`. Runs are kept, so any two can be compared later.

---

## 3. Vocabulary

We adopt Cope's terms where they exist so the reports read the way he talks.

| Term | Meaning | Ours today |
|---|---|---|
| **Venue** | Ranked rows with capacity, parity, lean, printed seats, holds, tier | `VenueArchitecture` |
| **RowRank** | 1 = best row in the house, venue-wide | `rowRank` |
| **Offer** | group size + price per ticket + tier preference | `RankedOffer` |
| **GPI / RankKey** | `price × 1000 + groupSize`, timestamp tiebreak | `rankKey` |
| **OfferRank** | Position in the sorted pool (1 = best) | derived |
| **Pool** | The full set of offers for a show | `RankedOffer[]` |
| **Relief rows** | Cope's terms: *single rows* (capacity 1) and *2-seat relief rows*, flagged `SingleInventoryFlag` / `GapReliefEligible` in his workbook | new, imported as row flags |
| **Venue library** | Named, uploaded venues the sim can pick from | new |
| **Demand model** | Generator that produces a synthetic pool from parameters + seed | new |
| **Policy** | A named engine variant (how `findBestFit` and its neighbours behave) | new, opt-in |
| **Scenario** | venue + pool (or demand model) + policies + config | new |
| **Run** | One execution of one scenario; deterministic given seed | new |
| **Report** | Human-readable output of a run or comparison | new |

---

## 4. Functional requirements

### 4.0 Inputs at a glance

Every knob the sim accepts, where the ask came from, and when it lands. Anything Cope or Julia has raised as a question is an input here, so the answer can be tested rather than argued.

**Venue**

| Input | Source of the ask | Slice |
|---|---|---|
| Pick a venue from the library by name | Josh 2026-09-07 | S1 |
| Upload a new venue (his workbook, a manifest CSV, JSON) | Josh 2026-09-07; Q23/Q24 importer | S1 (JSON/CSV), S2 (xlsx, manifest) |
| Active sections / rows for this show (partial activation) | Q9 Austin "only some sections", NEW-4 | S1 |
| Holds per show, tagged by source (venue, artist, comps, production) | Q25 | S1 |
| Relief-row flags (single rows, 2-seat relief rows) | Cope's workbook, playbook parity section | S2 |
| Unit type per tier: rows / tables / boxes / GA, and protect vs co-seat | NEW-14 | S6 (needs engine work) |
| Tier structure: which rows belong to which tier, tier order | NEW-11, Q19 | S1 |

**Pricing and show settings**

| Input | Source of the ask | Slice |
|---|---|---|
| Floor price per tier (or per section) | Q18, Q19 | S1 |
| Price ladder step ($25 in Cope's pool; $5 raise grid) | Cope's pool, ADR-0018 | S1 |
| Group-size cap (default 10, per show) | Q15 / ADR-0011 | S1 |
| Orphan policy: leave vs bump | Q27 (leave for MVP) | S3 |
| Offer window length and arrival curve | Q17 (14 days) vs NEW-1 (≤6 days) | S5 |
| Bleacher channel: % of capacity at a fixed price | NEW-8 (not confirmed) | S4, off by default |

**Offer pool**

| Input | Source of the ask | Slice |
|---|---|---|
| Oversubscription (tickets requested ÷ capacity) | Cope "distribution with yield capacity" | S1 |
| % of offers that are groups of 1, 2, 3, 4, 5, 6… | Josh 2026-09-07; Cope's even/odd "offer pressure" | S1 |
| Price distribution above floor (Greenwood progression, lognormal, flat ladder) | Cope's pool sheet | S1 |
| Tier-preference mix (specific / this-or-worse / this-or-better / any) | NEW-3 waterfalling | S1 |
| Auto-bid: share of fans, cap range, raise rule ($5 fixed vs Cope's percentage) | ADR-0017/0018, NEW-13 "Cope to confirm" | S3 |
| Private offers: share and threshold | ADR-0017 | S4 |
| Revision behaviour: % of fans who revise upward after seeing preview, by how much | Q12, playbook "cannot lower your offer" | S5 |
| Withdrawals: % who pull out before binding | NEW-9 | S5 |
| Fan seat preferences beyond tier (aisle, centre, row range) | playbook | S6 (needs engine work) |

**After allocation**

| Input | Source of the ask | Slice |
|---|---|---|
| Returns / resales % after binding, resale at original price | Q10, ADR-0014, playbook post-binding inventory | S5 |
| Production releases / Miracle Tickets: seats added after binding | playbook | S5 |
| Manual upgrade buyouts: % of fans requesting, acceptance rate | Q29 | S6 |

### 4.1 Venue sources

- **V1. Cope's RowRank workbook** (`Full RowRank Architecture` sheet: GlobalRowRank, Area, DisplaySection, Row, WorkingL, Parity, Lean, PrintedSeatList, HoldSeats, ActiveStatus…). This is the canonical Lincoln. Importer maps each column to `VenueRow`; `ActiveStatus` drives `activeRowIds`; `Area` + price level map to `tier`.
- **V2. Box-office manifest CSV** (the Lincoln onsale export: UTF-16 TSV, one line per seat, price level column). Importer groups seats into rows, derives capacity and printed seat lists, maps price levels to tiers, treats house holds as `holds`. RowRank must be supplied (a sidecar CSV, or fall back to price-level order then row letter) because a manifest has no rank.
- **V3. Tier-spec generator** — the existing `generate-architecture.ts` (rows × seats per tier). For quick synthetic rooms.
- **V4. Venue JSON** — the sim's own on-disk format (`VenueArchitecture` plus a `tierOrder` and optional `tierFloorsCents`). V1–V3 all produce this; runs consume only this.
- **V5 (nice-to-have).** Daikin Park manifest importer, for the "does it scale" story. Already known to run in 2.7s.

**The venue library.** Venues live as JSON under `sim/venues/<name>.json` and are picked by name (`--venue lincoln-v4`, or `"venue": "lincoln-v4"` in the scenario). `venue add <file>` uploads a new one: it detects the format (Cope's workbook, a manifest CSV, our JSON, or a tier spec), validates it, prints the same summary Cope's "Architecture Summary" sheet shows (capacity, rows, even/odd rows, single rows, 2-seat relief rows, per area and section), and saves it. `venue list` and `venue show <name>` read the library. Seeded venues on day one: Cope's place (50), the synthetic Lincoln (5-row), Cope's Lincoln v4 (144-row), the Austin partial-activation fixture; Daikin when V5 lands.

**Per-show overlays on a library venue**, set in the scenario without editing the venue file:
- `activeSections` / `activeRowIds` — sell only part of the room (Q9, NEW-4). Report shows capacity actually on sale.
- `holds` — seats taken out per show, tagged by source (`venue`, `artist`, `comp`, `production`) per Q25, either explicit seat lists or "N seats in tier T, best rows first". Report shows held seats separately from empty seats.
- `tierMap` — override which rows/price levels form which tier and the tier order (NEW-11), so the same room can be tested as 3 tiers vs 5.
- Relief-row flags come from the venue file (imported from Cope's columns) and are visible to the `singles-reserve` and `parity-tiebreak` policies only; the default policy ignores them, as the engine does today.

### 4.2 Offer pool sources

- **P1. Pool CSV/xlsx** — Cope's `Full Offer Pool v4` layout (OfferID, PricePerTicket, GroupSize, TimestampOrder, optional tier preference) and the existing `sim-allocate.ts` column aliases. Prices in dollars by default, `--price=cents` to override.
- **P2. Demand model (synthetic generator).** Seeded, deterministic. Parameters:
  - `oversubscription` — total tickets requested ÷ venue capacity (e.g. 0.8, 1.23, 2.0)
  - `groupSizeMix` — **the percentage of offers that are groups of 1, 2, 3, 4, 5, 6, … up to the cap.** Entered directly (`{ "1": 10, "2": 45, "3": 10, "4": 25, "5": 5, "6": 5 }`, must sum to 100; sizes omitted are 0%). Also settable from the CLI with `--group-mix`, and via named presets: `even-heavy`, `odd-heavy`, `singles-rich`, `couples`, `big-groups`, `lincoln-v4` (fitted to Cope's pool). The report always echoes the mix that was actually generated (by offers and by tickets) so the input and the pool can be checked against each other.
  - `priceModel` — per tier: floor + a distribution above it (lognormal or Cope's Greenwood 10-bucket progression), plus a share of offers that price at exactly the floor
  - `tierPreferenceMix` — shares of `specific` / `this_or_worse` / `this_or_better` / `any`, and how fans choose a preferred tier (biased to premium, uniform, price-correlated)
  - `floorsCents` per tier (Q18/Q19) and `ladderCents` — the price step fans bid in ($25 in Cope's pool). Generated prices snap to floor + k × ladder.
  - `autoBid` — share of offers with auto-bid on, cap distribution, and `raiseRule` (`{ kind: "fixed", cents: 500 }` as shipped, or `{ kind: "percent", pct: 5 }` as Cope prefers) so NEW-13 can be settled with numbers
  - `privateOffers` — share of offers with a private threshold, and the threshold distribution (ADR-0017)
  - `bleacher` — optional: % of capacity carved out at a fixed price before allocation (NEW-8). Off unless the scenario sets it, since Cope hasn't confirmed the concept.
  - `arrival` — for temporal runs (§4.6): how offers arrive over the window (uniform, front-loaded, last-day spike)
  - `seed`
- **P3. Pool transforms.** Take a real pool and perturb it: scale prices, add/remove N singles, shift the group mix, drop the top X%. Lets Cope ask "what if the pool had looked like *this*".

### 4.3 Policies (engine variants)

Each policy is a pure function with the exact `allocate()` signature and returns the same `AllocationResult`, so every metric and invariant applies uniformly. Policies live **inside the engine** as opt-in `AllocationConfig` fields (default = shipped behaviour), not as forks in the sim. That way, when Cope picks one, promotion is a config default flip plus an ADR, not a rewrite. Until an ADR lands, production never sets these fields.

| Policy | What it changes | Rank-first? | Answers |
|---|---|---|---|
| `greedy` (default) | Shipped behaviour: take in rank order, FitResolver skips forward on non-fit | Yes | baseline |
| `clean-fit` | When placing a group would strand seats no remaining offer can fill, defer it one row and take the next group that leaves a fillable remainder. Logged as `FIT_RESOLVED` with a `clean_fit` reason and the deferral distance | Yes, "subject to fit" widened by one deferral | Q1 |
| `parity-tiebreak` | Where rank is genuinely tied, prefer the placement that keeps odd-sized groups for odd-capacity rows | Yes (ties only) | Q2 |
| `singles-reserve` | Hold back the last *k* single-seat offers for rows of capacity 1 (Lincoln has 7 such rows) | **No** — mild preventive hoarding, labelled as such | Q2 |
| `lookahead-k` | Pack row *r* while considering rows *r+1..r+k* (Cope's Phase 6 framing) | **No** | Q1 |

Policies compose where sensible (`clean-fit+singles-reserve`). The report always states which policies break strict rank-first so nobody mistakes a fill win for a free lunch.

### 4.4 Metrics (every run, every policy)

**Fill**
- Seats placed / available, overall and per tier and per area
- Empty seats: count, contiguous-hole size histogram, seats in odd-length holes, empty seats in odd- vs even-capacity rows (the `AllocationStats` instrumentation already shipped)
- Rows fully filled / partially filled / untouched

**Revenue** (integer cents throughout)
- Gross of placed offers, overall and per tier
- Left on the table: value of unplaced offers, and separately the value of unplaced offers that *would have fit* somewhere had rank allowed
- Average and median placed price per ticket, per tier

**Rank-respect**
- Passed over: offers where a lower-ranked group sits in a better row and that group's block plus the empty seats touching it could have held this offer (the "subject to fit" test made countable; a single in a 1-seat hole has not passed a pair)
- Rank cost: for each deferred offer, rows lost and the price gap to the offer that took its place; report max and sum
- Deferral distance distribution (clean-fit / lookahead only)

**Preference honouring**
- Placed in preferred tier / waterfalled down / unplaced, by preference type
- Confirmation that no `this_or_worse` or `specific` offer was upgraded (invariant, see §4.7)

**Fairness slices**
- Placement rate by group size (1..10) and by price decile
- Where singles, couples, and big groups actually landed (RowRank distribution per size)

**Distribution stats** (multi-seed runs): mean, p5, p50, p95 of every number above.

**Runtime** per run.

### 4.5 Comparison and sweeps

- **Compare policies**: N policies × one pool → one table, plus a per-offer diff (who moved rows, who gained/lost a seat, at what price). This is the Q1/Q2 deliverable.
- **Compare runs**: any two or more *saved* runs, side by side, regardless of what differed between them (group-size mix, oversubscription, policy, venue, or an engine change between two dates). Output is the fill report columns per run with deltas, a per-group-size fill table per run, and, when the pools are the same, the per-offer diff. This is how "run it with 45% couples, then with 30% singles, and see how each fills" gets answered.
- **Sweep**: vary one scenario parameter over a range (oversubscription, group mix, singles share, number of active rows, tier floors) × M seeds → a curve per metric. This is Cope's "distribution with yield capacity".
- **Monte Carlo**: same scenario, many seeds → distributions. Report shows p5/p50/p95, not a single number, whenever seeds > 1.

### 4.6 Temporal simulation (Phase 3, answers Q3–Q5)

Simulate the offer window as a timeline instead of a single pool:

- Offers arrive per the demand model's `arrival` curve over D days.
- Preview allocation runs at a configurable cadence (reusing the pure preview path: auto-bid resolution + GAE).
- Binding runs at the end (or at N checkpoints).
- Measures: displacement events (fan was placed at preview *t*, not at *t+1*), count and by tier; auto-bid raises triggered and total spend added; how the "you'd currently land in row X" message churns.
- **Rolling Admission Confirmed variant** (Q3): an offer becomes "confirmed" once it has held a seat for H hours or is above a confirmed floor; measure how many confirmations later can't be honoured under each rule.
- **Post-binding returns** (Q4): after binding, return R% of seats at random (weighted to tier), then compare `release` (nothing refills) vs `keep pool live` (unplaced offers backfill in rank order). Measure refill rate and revenue recovered.
- **Register-first** (Q5): accept every offer above floor during the window, seat at binding; report booked $ per day vs seated $ at binding and the size of the "accepted but unseated" group.

### 4.7 Invariants (checked on every run, fail loudly)

A policy that breaks one of these is a bug, not a result:

1. Every placed group occupies `groupSize` contiguous, unheld, active seats in one row.
2. Total accounting: placed + orphan + unfilled = available capacity.
3. No seat assigned twice; no offer placed twice.
4. No free upgrades: `specific` never moves tier; `this_or_worse` never goes above its tier; `this_or_better` never below.
5. Rank-respect subject to fit holds for `greedy`; for other policies the report *counts* violations rather than asserting zero, and labels them.
6. Determinism: same scenario + seed → byte-identical `result.json`. The run folder stores an input hash and a result hash.

### 4.8 Outputs

**The fill report** is the headline of every run, printed at the end and written as the top of `report.md`:

```
FILL REPORT — lincoln-v4 · couples-heavy · policy greedy · 20 seeds
                                  p50      p5      p95
  Seats filled                  1,133   1,121    1,141   of 1,152
  Fill rate                     98.4%   97.3%    99.0%
  Empty seats                      19      11       31
    in 1-seat holes                19      11       28
    in 2-seat holes                 0       0        3
    in odd-capacity rows            9       4       14
  Gross placed                $113,250  …
  Left on table (unplaced $)   $17,400  …

  By tier            filled / avail   fill%   empty   gross
    premium              232 / 232    100%      0   $…
    mid                  …
  By group size      offers  placed   placed%  tickets placed   where (median RowRank)
    1                    51      44     86%        44             71
    2                   230     226     98%       452             38
    3                    …
```

Rows: overall, by tier, by area, by group size. Columns: p50 with p5/p95 when seeds > 1, plain numbers when seeds = 1. The by-group-size table is what shows *how each mix fills*: which sizes get seated, which strand, and how far back they land.

Above the fill report, two short pre-run summaries Cope already keeps by hand in his workbook: the **venue parity summary** (even rows, odd rows, single rows, 2-seat relief rows, per area) and the **offer parity summary** (even vs odd offer pressure, tickets by group size). Below it, the **per-section totals and averages** view an artist would see (Q30: totals + averages per section, nothing per fan).

Per run folder:
- `scenario.json` — the resolved inputs (after generation), so the run is reproducible without the original spreadsheet
- `result.json` — full `AllocationResult` per policy, plus metrics
- `report.md` — the human report: headline table, per-tier table, hole histogram, rank-cost table, notable per-offer moves, policy caveats
- `offers.csv` — one row per offer: rank, size, price, preference, policy → row/seats, placed tier, deferral, inversion flag. Opens in Excel; this is what Cope will actually read
- `seatmap.txt` — text seat map per policy (row by row, occupant ids), same style as `sim-allocate.ts` today

`sim/runs/` is gitignored. Curated runs that back a decision get copied into `docs/sim-reports/` next to the ADR they support.

### 4.9 Golden scenarios

`sim promote <run>` writes a Vitest fixture that pins the seat map and stats for that scenario + policy. Cope's 144-row Lincoln architecture + his pool v4 replaces the synthetic 5-row Lincoln fixture as the canonical one. Any later engine change that moves those numbers has to acknowledge it in the PR.

---

## 5. Non-functional requirements

- **Pure core.** `src/lib/sim/` imports the GAE and the pure allocation helpers (`auto-bid`, `displacement`, `translate`, `generate-architecture`) and nothing that touches DB, env, Stripe, or email. Same hard boundary as the GAE. The CLI in `scripts/sim.ts` is the only place that reads files.
- **No production behaviour change** from the tool itself. New policy fields on `AllocationConfig` are optional and default to today's behaviour; existing tests must pass untouched.
- **Deterministic** given seed; own seeded PRNG (no `Math.random`).
- **Fast enough to iterate.** Lincoln (1.2k seats, 500 offers) in well under a second per run; 50-seed sweeps in seconds; Daikin (43k seats, 18k offers) under 10s.
- **Money is integer cents** everywhere, including generated prices and report totals. Dollars only at the CSV/report boundary.
- **Zod-validated scenario files**, with helpful errors ("row 37: WorkingL is 0 but ActiveStatus is Active").
- **One new dev dependency at most** for reading `.xlsx` (proposal: `xlsx`/SheetJS, dev-only). CSV parsing stays hand-rolled as today.
- **Tests**: unit tests for importers, generator (distribution sanity, determinism), metrics (hand-computed small cases), invariants (must catch a deliberately broken policy); the golden fixture from §4.9.

---

## 6. Scenario file (proposed shape)

```jsonc
{
  "name": "lincoln-v4-objective",
  "venue": "lincoln-v4",                       // a name from the library, or { "file": "path.json" }
  "show": {
    "activeSections": ["ORCH C", "ORCH L", "ORCH R", "FC BAL"],   // omit = whole room
    "holds": [{ "source": "artist", "tier": "premium", "seats": 8 }, { "source": "venue", "seatIds": ["ORCH C:AA:101"] }],
    "floorsCents": { "premium": 12500, "mid": 8500, "rear": 5000 },
    "maxGroupSize": 10
  },
  "pool": {
    // either a file…
    "file": "sim/pools/lincoln-pool-v4.csv",
    // …or a demand model
    "generate": {
      "oversubscription": 1.23,
      "groupSizeMix": { "1": 10, "2": 45, "3": 10, "4": 25, "5": 5, "6": 5 },   // percent of offers; or a preset name like "lincoln-v4"
      "priceModel": { "kind": "greenwood", "ladderCents": 2500 },   // floors come from show.floorsCents
      "autoBid": { "share": 0.15, "capMultiplier": [1.2, 1.6], "raiseRule": { "kind": "fixed", "cents": 500 } },
      "tierPreferenceMix": { "specific": 0.2, "this_or_worse": 0.6, "any": 0.2 },
      "seed": 1
    }
  },
  "policies": ["greedy", "clean-fit", "clean-fit+singles-reserve"],
  "seeds": 1
}
```

---

## 7. Build plan (slices)

| Slice | Delivers | Closes |
|---|---|---|
| **S1 — core + CLI skeleton** ✅ | `src/lib/sim/` scenario schema; **venue library** (`venue add/list/show`, JSON + tier-spec upload, seeded with the 4 known venues); per-show overlays (active sections, holds by source, floors, group cap); pool CSV loader; seeded demand model with **group-size % input**; `run` command; metrics; invariants; the **fill report**; `offers.csv` + `seatmap.txt`. Baseline `greedy` only. Retires `scripts/sim-allocate.ts` | pick a venue, run a mix, see how it fills |
| **S2 — compare runs + importers** ✅ | `compare-runs` over saved run folders; `venue add` for Cope's RowRank workbook (with relief-row flags) and the manifest CSV (`lincoln-manifest` in the library); `import-pool` for his pool sheet. Lincoln v4 golden fixture pins the seat map by hash | compare mixes on real data |
| **S3 — policies + auto-bid** | `clean-fit`, `parity-tiebreak`, `singles-reserve`, orphan policy as opt-in `AllocationConfig` fields with their own unit tests; auto-bid share/cap/raise-rule in the demand model (fixed $5 vs percentage); `compare` (policies on one pool) with per-offer diff | Q1, Q2, NEW-13 reports |
| **S4 — sweeps** | `sweep` over any parameter × seeds, Monte Carlo summaries, yield curves; private offers; optional Bleacher carve-out | "distribution with yield capacity" |
| **S5 — temporal** | Window length + arrival curves, preview cadence, displacement metrics, fan revisions upward and withdrawals, rolling-confirmed, returns/resales and production releases, register-first | Q3, Q4, Q5, Q12, NEW-9 reports |
| **S6 (later)** | `lookahead-k`; atomic tables/boxes (protect vs co-seat); seat preferences beyond tier; upgrade buyouts; admin Simulation tab over the same core, from Julia's outline | Cope's Phase 6; NEW-14; ops UI |

S1 alone lets the team enter a group-size mix and see the fill report. S2 adds run-vs-run comparison and Cope's real Lincoln. S1–S3 are enough to put Q1 and Q2 in front of Cope with numbers. S4 makes the answer robust across pools instead of one pool.

---

## 8. Decisions to confirm before building

1. **Policies live in the engine behind opt-in config**, not as sim-only forks. (Recommended: yes. Keeps promotion cheap; production stays on defaults until an ADR.)
2. **`xlsx` as a dev dependency** so Cope's workbook imports directly, vs. asking him to export CSV each time. (Recommended: add it.)
3. **Report format**: `report.md` in the run folder, with curated copies in `docs/sim-reports/`. An HTML artifact version for Cope can be generated from the same data later. (Recommended: markdown first.)
4. **Lincoln golden fixture** switches from the synthetic 5-row scenario to Cope's 144-row architecture + pool v4. The old fixture stays as a small fast case.
5. **Scope of S5 (temporal)** waits until Cope confirms he wants Q3–Q5 modelled, since those reopen ADR-0004 and his May answers on waitlists.
