// GAE simulator CLI — the only place in the sim that touches the filesystem.
// Everything it calls lives in src/lib/sim (pure) and src/lib/gae (pure).
// See docs/GAE_SIMULATOR.md and sim/README.md.
//
//   npm run sim -- venue list
//   npm run sim -- venue show lincoln-v4
//   npm run sim -- venue add <file> [--name x] [--sheet "Full RowRank Architecture"] [--floors "orchestra=85,..."]
//                       (.json venue or tier spec · .xlsx Cope RowRank workbook · .csv/.tsv box-office manifest)
//   npm run sim -- import-pool <file.xlsx|.csv> [--sheet "Full Offer Pool v4"] --out sim/pools/x.csv
//   npm run sim -- run sim/scenarios/<name>.json [--venue x] [--group-mix "1:10,2:45,..."]
//                       [--seeds N] [--seed N] [--oversub X] [--active "A,B"] [--name run] [--price=cents]
//                       [--policies greedy,clean-fit,clean-fit+singles-reserve] [--raise fixed:5|percent:5]
//   npm run sim -- compare <scenario.json> --policies a,b[,c]     (same as run; a report with policies side by side)
//   npm run sim -- compare-runs sim/runs/<a> sim/runs/<b> [...] [--out dir]
//   npm run sim -- sweep <scenario.json> --vary pool.oversubscription=0.6:2.0:0.1 [--seeds N] [--policies ...] [--name x]

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import * as XLSX from "xlsx";

import {
  applyShowOverlay,
  applyVary,
  assembleSweep,
  compareRuns,
  labelFor,
  parseVaryArg,
  renderSweep,
  renderSweepConsole,
  renderSweepCsv,
  slimOutput,
  formatIssues,
  loadPoolCsv,
  offersFromSheet,
  POLICY_HELP,
  poolToCsv,
  renderComparison,
  renderComparisonConsole,
  venueFromCopeRowRank,
  venueFromManifest,
  parseGroupMixArg,
  parseVenueFile,
  renderConsoleSummary,
  renderFillReport,
  renderOffersCsv,
  renderSeatMap,
  runScenario,
  ScenarioSchema,
  SimInputError,
  venueFromTierSpec,
  venueParitySummary,
  tierOrder,
  usd,
  type AutoBids,
  type RunOutput,
  type Scenario,
  type SimVenue,
  type SweepPoint,
} from "../src/lib/sim";
import type { RankedOffer } from "../src/lib/gae/types";

const ROOT = process.cwd();
const VENUES_DIR = join(ROOT, "sim", "venues");
const RUNS_DIR = join(ROOT, "sim", "runs");

// --- tiny arg parser ---------------------------------------------------------

type Args = { positional: string[]; flags: Record<string, string | true> };

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) flags[a.slice(2)] = argv[++i]!;
      else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function flagStr(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === "string" ? v : undefined;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new SimInputError(`${path}: ${(e as Error).message}`);
  }
}

// Box-office exports are often UTF-16 with a BOM; scenario/pool files are UTF-8.
function readText(path: string): string {
  const buf = readFileSync(path);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return buf.subarray(2).swap16().toString("utf16le");
  return buf.toString("utf8").replace(/^\uFEFF/, "");
}

// Pick a sheet by --sheet name, else the first whose name matches `prefer`.
function readSheet(path: string, sheetFlag: string | undefined, prefer: RegExp[]): { name: string; rows: Record<string, unknown>[] } {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  let name = sheetFlag;
  for (const re of prefer) {
    if (name) break;
    name = wb.SheetNames.find((n) => re.test(n));
  }
  name ??= wb.SheetNames[0];
  if (!name || !wb.Sheets[name]) {
    throw new SimInputError(`sheet "${sheetFlag ?? "?"}" not found. Sheets in ${basename(path)}: ${wb.SheetNames.join(", ")}`);
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name]!, { defval: null });
  return { name, rows };
}

// "--floors orchestra=85,front_balcony=70" (dollars) → cents per tier.
function parseFloors(arg: string | undefined): Record<string, number> | undefined {
  if (!arg) return undefined;
  const out: Record<string, number> = {};
  for (const part of arg.split(",")) {
    const m = /^\s*([a-z0-9_]+)\s*=\s*\$?([\d.]+)\s*$/i.exec(part);
    if (!m) throw new SimInputError(`--floors: cannot read "${part}" (want tier=dollars, e.g. orchestra=85)`);
    out[m[1]!.toLowerCase()] = Math.round(Number(m[2]) * 100);
  }
  return out;
}

const today = (): string => new Date().toISOString().slice(0, 10);

// --- venue library -----------------------------------------------------------

function listVenues(): SimVenue[] {
  if (!existsSync(VENUES_DIR)) return [];
  return readdirSync(VENUES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => parseVenueFile(readJson(join(VENUES_DIR, f)), f));
}

function loadVenue(ref: string | { file: string }): SimVenue {
  if (typeof ref !== "string") return parseVenueFile(readJson(resolve(ROOT, ref.file)), ref.file);
  const path = join(VENUES_DIR, `${ref}.json`);
  if (!existsSync(path)) {
    const known = listVenues().map((v) => v.name);
    throw new SimInputError(`venue "${ref}" is not in the library. Known: ${known.join(", ") || "(none)"}`);
  }
  return parseVenueFile(readJson(path), `${ref}.json`);
}

function venueSummaryLine(v: SimVenue): string {
  const s = venueParitySummary(v)[0]!;
  return `${v.name.padEnd(20)} ${String(s.capacity).padStart(6)} seats  ${String(s.activeRows).padStart(4)}/${String(s.rows).padEnd(4)} rows  tiers: ${tierOrder(v).join(" > ")}  — ${v.displayName}`;
}

function cmdVenue(args: Args): void {
  const sub = args.positional[1];
  if (sub === "list" || sub === undefined) {
    const venues = listVenues();
    if (venues.length === 0) console.log("Library is empty. Add one with: npm run sim -- venue add <file.json>");
    for (const v of venues) console.log(venueSummaryLine(v));
    return;
  }
  if (sub === "show") {
    const name = args.positional[2];
    if (!name) throw new SimInputError("usage: venue show <name>");
    const v = loadVenue(name);
    console.log(`${v.displayName} (${v.name})`);
    if (v.notes) console.log(`  ${v.notes}`);
    if (v.source) console.log(`  source: ${v.source.kind}${v.source.file ? ` — ${v.source.file}` : ""}`);
    console.log(`  tiers (best → worst): ${tierOrder(v).join(" > ")}`);
    if (v.tierFloorsCents) console.log(`  floors: ${Object.entries(v.tierFloorsCents).map(([t, c]) => `${t} ${usd(c)}`).join(", ")}`);
    console.log("");
    console.log("  scope                on sale   rows   even   odd  1-seat 2-seat relief   held    GA");
    for (const s of venueParitySummary(v)) {
      console.log(
        `  ${s.scope.padEnd(20)} ${String(s.capacity).padStart(7)} ${`${s.activeRows}/${s.rows}`.padStart(6)} ${String(s.evenRows).padStart(6)} ${String(s.oddRows).padStart(5)} ${String(s.singleRows).padStart(7)} ${String(s.pairRows).padStart(6)} ${String(s.reliefFlaggedRows).padStart(6)} ${String(s.heldSeats).padStart(6)} ${String(s.gaSeats).padStart(5)}`,
      );
    }
    const sections = [...new Set(v.rows.map((r) => `${String(r.area)} / ${r.section}`))];
    console.log("");
    console.log(`  sections: ${sections.join(", ")}`);
    return;
  }
  if (sub === "add") {
    const file = args.positional[2];
    if (!file) throw new SimInputError("usage: venue add <file> [--name x] [--format json|tierspec]");
    const path = resolve(ROOT, file);
    if (!existsSync(path)) throw new SimInputError(`no such file: ${path}`);
    const lower = path.toLowerCase();
    const defaultName = basename(file).replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const name = flagStr(args, "name") ?? defaultName;
    const displayName = flagStr(args, "display");
    let venue: SimVenue;
    let extraSummary = "";
    if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm") || lower.endsWith(".xls")) {
      const { name: sheetName, rows } = readSheet(path, flagStr(args, "sheet"), [/rowrank/i, /architecture/i, /venue/i]);
      const opts: Parameters<typeof venueFromCopeRowRank>[1] = { name, sourceFile: `${basename(file)} · sheet "${sheetName}"`, importedAt: today() };
      if (displayName) opts.displayName = displayName;
      if (flagStr(args, "tier-by") === "section") opts.tierBy = "section";
      const floors = parseFloors(flagStr(args, "floors"));
      if (floors) opts.floorsCents = floors;
      venue = venueFromCopeRowRank(rows as Parameters<typeof venueFromCopeRowRank>[0], opts);
    } else if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
      const opts: Parameters<typeof venueFromManifest>[1] = { name, sourceFile: basename(file), importedAt: today() };
      if (displayName) opts.displayName = displayName;
      if (args.flags["sold-as-held"] === true) opts.soldAsHeld = true;
      if (args.flags["ignore-holds"] === true) opts.ignoreHolds = true;
      const rankFile = flagStr(args, "rank-file");
      if (rankFile) opts.rankFileText = readText(resolve(ROOT, rankFile));
      const imported = venueFromManifest(readText(path), opts);
      venue = imported.venue;
      const held = Object.entries(imported.heldBySource).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ");
      extraSummary = `  price levels: ${Object.entries(imported.priceLevels).map(([l, i]) => `${l} ${usd(i.priceCents)} ×${i.seats}`).join(", ")}\n  holds: ${held || "none"}${imported.soldSeats ? ` · ${imported.soldSeats} seats show as sold in this snapshot${opts.soldAsHeld ? " (held)" : " (treated as open; pass --sold-as-held to hold them)"}` : ""}`;
    } else {
      const raw = readJson(path) as Record<string, unknown>;
      const format = flagStr(args, "format") ?? (Array.isArray(raw.tiers) ? "tierspec" : "json");
      if (flagStr(args, "name")) raw.name = name;
      if (displayName) raw.displayName = displayName;
      if (typeof raw.name !== "string") raw.name = name;
      if (typeof raw.displayName !== "string") raw.displayName = raw.name;
      venue = format === "tierspec" ? venueFromTierSpec(raw, file) : parseVenueFile(raw, file);
      venue = { ...venue, source: { ...(venue.source ?? { kind: format }), file: basename(file), importedAt: today() } };
    }
    mkdirSync(VENUES_DIR, { recursive: true });
    const dest = join(VENUES_DIR, `${venue.name}.json`);
    if (existsSync(dest) && args.flags.force !== true) {
      throw new SimInputError(`${dest} already exists. Pass --force to replace it, or --name to pick another name.`);
    }
    writeFileSync(dest, JSON.stringify(venue, null, 2) + "\n");
    console.log(`Added ${venue.name} → ${dest}`);
    console.log(venueSummaryLine(venue));
    if (extraSummary) console.log(extraSummary);
    if (venue.notes) console.log(`  ${venue.notes}`);
    return;
  }
  throw new SimInputError(`unknown venue command "${sub}". Try: venue list | venue show <name> | venue add <file>`);
}

// --- run ---------------------------------------------------------------------

function loadScenarioWithOverrides(args: Args): Scenario {
  const scenarioPath = args.positional[1];
  if (!scenarioPath) throw new SimInputError(`usage: ${args.positional[0]} <scenario.json> [--venue x] [--group-mix ...] [--seeds N] ...`);
  const parsed = ScenarioSchema.safeParse(readJson(resolve(ROOT, scenarioPath)));
  if (!parsed.success) throw new SimInputError(formatIssues(scenarioPath, parsed.error));
  let scenario: Scenario = parsed.data as Scenario;

  // CLI overrides — each one is a scenario field, so the saved scenario.json
  // in the run folder reproduces the run without the flags.
  const venueFlag = flagStr(args, "venue");
  if (venueFlag) scenario = { ...scenario, venue: venueFlag };
  const active = flagStr(args, "active");
  if (active) scenario = { ...scenario, show: { ...(scenario.show ?? {}), activeSections: active.split(",").map((s) => s.trim()) } };
  const seeds = flagStr(args, "seeds");
  if (seeds) scenario = { ...scenario, seeds: Number(seeds) };
  const gen = "generate" in scenario.pool ? scenario.pool.generate : undefined;
  const mix = flagStr(args, "group-mix");
  const seed = flagStr(args, "seed");
  const oversub = flagStr(args, "oversub");
  if ((mix || seed || oversub) && !gen) {
    throw new SimInputError("--group-mix / --seed / --oversub only apply to a generated pool; this scenario uses a pool file");
  }
  if (gen) {
    const g = { ...gen };
    if (mix) g.groupSizeMix = parseGroupMixArg(mix);
    if (seed) g.seed = Number(seed);
    if (oversub) g.oversubscription = Number(oversub);
    scenario = { ...scenario, pool: { generate: g } };
  }
  const policiesFlag = flagStr(args, "policies");
  if (policiesFlag) scenario = { ...scenario, policies: policiesFlag.split(",").map((p) => p.trim()) };
  if (args.positional[0] === "compare" && (scenario.policies ?? []).length < 2) {
    throw new SimInputError(`compare needs two or more policies: --policies greedy,clean-fit (${POLICY_HELP})`);
  }
  const raise = flagStr(args, "raise");
  if (raise) {
    const m = /^(fixed|percent):([\d.]+)$/.exec(raise);
    if (!m) throw new SimInputError('--raise: want "fixed:5" (dollars per step) or "percent:5"');
    scenario = { ...scenario, autoBidRaiseRule: m[1] === "fixed" ? { kind: "fixed", cents: Math.round(Number(m[2]) * 100) } : { kind: "percent", pct: Number(m[2]) } };
  }
  const check = ScenarioSchema.safeParse(scenario);
  if (!check.success) throw new SimInputError(formatIssues("overrides", check.error));
  return scenario;
}

function runOne(scenario: Scenario, args: Args): { output: RunOutput; venue: SimVenue } {
  const venue = loadVenue(scenario.venue);
  const loaded =
    "file" in scenario.pool
      ? loadPoolCsv(readText(resolve(ROOT, scenario.pool.file)), {
          priceMode: flagStr(args, "price") === "cents" ? "cents" : "dollars",
          label: scenario.pool.file,
        })
      : undefined;
  const output = runScenario(loaded ? { scenario, venue, poolOffers: loaded.offers, poolAutoBids: loaded.autoBids } : { scenario, venue });
  return { output, venue };
}

function cmdRun(args: Args): number {
  const scenario = loadScenarioWithOverrides(args);
  const t0 = performance.now();
  const { output, venue } = runOne(scenario, args);
  const elapsed = performance.now() - t0;

  const runName = flagStr(args, "name") ?? `${scenario.name}-${output.generatedAt.replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-")}`;
  const dir = resolve(flagStr(args, "out") ?? RUNS_DIR, runName);
  mkdirSync(dir, { recursive: true });
  const renderVenue = applyShowOverlay(venue, scenario.show).venue;
  writeFileSync(join(dir, "scenario.json"), JSON.stringify(scenario, null, 2) + "\n");
  writeFileSync(join(dir, "report.md"), renderFillReport(output) + "\n");
  writeFileSync(join(dir, "result.json"), JSON.stringify(slimForDisk(output), null, 2) + "\n");
  for (const run of output.runs) {
    if (!run.result) continue;
    const suffix = output.policies.length > 1 ? `-${run.policy}` : "";
    writeFileSync(join(dir, `offers${suffix}.csv`), renderOffersCsv(run, renderVenue));
    writeFileSync(join(dir, `seatmap${suffix}.txt`), renderSeatMap(run, renderVenue));
  }

  console.log(renderConsoleSummary(output));
  console.log("");
  console.log(`  ${output.runs.length} allocation(s) in ${elapsed.toFixed(0)} ms · run folder: ${dir}`);
  console.log(`  report.md · result.json · offers.csv · seatmap.txt`);
  const violations = output.runs.reduce((s, r) => s + r.violations.length, 0);
  if (violations > 0) {
    console.error(`\n  !! ${violations} invariant violation(s). See report.md. Exiting 1.`);
    return 1;
  }
  return 0;
}

// result.json keeps the full engine output only for the first seed per policy
// (runScenario already does that) and drops per-decision snapshots, which
// are the bulk of the size and are reproducible from scenario.json.
function slimForDisk(out: RunOutput): RunOutput {
  return {
    ...out,
    runs: out.runs.map((r) =>
      r.result
        ? { ...r, result: { ...r.result, decisions: r.result.decisions.map((d) => ({ ...d, snapshot: {} })) } }
        : r,
    ),
  };
}

// --- sweep -------------------------------------------------------------------

function cmdSweep(args: Args): number {
  const scenario = loadScenarioWithOverrides(args);
  const varyArg = flagStr(args, "vary");
  if (!varyArg) throw new SimInputError("usage: sweep <scenario.json> --vary <path>=<a,b,c | start:end:step> [--seeds N] [--policies ...]");
  const vary = parseVaryArg(varyArg);
  const t0 = performance.now();
  const points: SweepPoint[] = [];
  let violations = 0;
  for (const value of vary.values) {
    const sc = applyVary(scenario, vary.path, value);
    const check = ScenarioSchema.safeParse(sc);
    if (!check.success) throw new SimInputError(formatIssues(`${vary.path}=${labelFor(value)}`, check.error));
    const { output } = runOne(sc, args);
    violations += output.runs.reduce((s, r) => s + r.violations.length, 0);
    points.push({ label: labelFor(value), value, scenario: sc, output: slimOutput(output) });
    process.stdout.write(`  ${vary.path} = ${labelFor(value)} · fill ${(100 * (output.aggregates[0]!.scalars["fill.fillRate"]!.p50)).toFixed(1)}%\n`);
  }
  const sweep = assembleSweep(scenario.name, vary.path, points);
  const runName = flagStr(args, "name") ?? `sweep-${scenario.name}-${vary.path.split(".").pop()}-${sweep.generatedAt.replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-")}`;
  const dir = resolve(flagStr(args, "out") ?? RUNS_DIR, runName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sweep.md"), renderSweep(sweep) + "\n");
  writeFileSync(join(dir, "sweep.csv"), renderSweepCsv(sweep));
  writeFileSync(join(dir, "sweep.json"), JSON.stringify(sweep, null, 2) + "\n");
  console.log("");
  console.log(renderSweepConsole(sweep));
  console.log("");
  console.log(`  ${points.length} points · ${points.reduce((s, p) => s + p.output.runs.length, 0)} allocations in ${(performance.now() - t0).toFixed(0)} ms · ${dir}`);
  console.log("  sweep.md · sweep.csv · sweep.json");
  if (violations > 0) {
    console.error(`\n  !! ${violations} invariant violation(s) across the sweep. Exiting 1.`);
    return 1;
  }
  return 0;
}

// --- import-pool ---------------------------------------------------------------

function cmdImportPool(args: Args): void {
  const file = args.positional[1];
  if (!file) throw new SimInputError("usage: import-pool <file.xlsx|.csv> [--sheet name] --out sim/pools/<name>.csv [--price=cents]");
  const path = resolve(ROOT, file);
  if (!existsSync(path)) throw new SimInputError(`no such file: ${path}`);
  const priceMode = flagStr(args, "price") === "cents" ? "cents" : "dollars";
  const lower = path.toLowerCase();
  let offers: RankedOffer[];
  let autoBids: AutoBids = {};
  let sourceLabel = basename(file);
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm") || lower.endsWith(".xls")) {
    const { name, rows } = readSheet(path, flagStr(args, "sheet"), [/full offer pool/i, /offer pool/i, /pool/i, /offers/i]);
    sourceLabel += ` · sheet "${name}"`;
    offers = offersFromSheet(rows, { priceMode, label: sourceLabel });
  } else {
    const loaded = loadPoolCsv(readText(path), { priceMode, label: sourceLabel });
    offers = loaded.offers;
    autoBids = loaded.autoBids;
  }
  const out = flagStr(args, "out") ?? join("sim", "pools", `${basename(file).replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`);
  const dest = resolve(ROOT, out);
  if (existsSync(dest) && args.flags.force !== true) throw new SimInputError(`${dest} already exists. Pass --force to replace it, or --out to pick another path.`);
  mkdirSync(join(dest, ".."), { recursive: true });
  writeFileSync(dest, poolToCsv(offers, autoBids));
  const tickets = offers.reduce((s, o) => s + o.groupSize, 0);
  const sizes = new Map<number, number>();
  for (const o of offers) sizes.set(o.groupSize, (sizes.get(o.groupSize) ?? 0) + 1);
  console.log(`Imported ${offers.length} offers (${tickets} tickets) from ${sourceLabel} → ${dest}`);
  console.log(`  by size: ${[...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}×${v}`).join("  ")}`);
  console.log(`  prices: ${usd(Math.min(...offers.map((o) => o.pricePerTicketCents)))} – ${usd(Math.max(...offers.map((o) => o.pricePerTicketCents)))}`);
  console.log(`  use it with: "pool": { "file": "${out}" }`);
}

// --- compare-runs ------------------------------------------------------------

function cmdCompareRuns(args: Args): void {
  const dirs = args.positional.slice(1);
  if (dirs.length < 2) throw new SimInputError("usage: compare-runs <run-dir> <run-dir> [...] [--out dir]");
  const inputs = dirs.map((d) => {
    const dir = existsSync(resolve(ROOT, d)) ? resolve(ROOT, d) : resolve(RUNS_DIR, d);
    const file = join(dir, "result.json");
    if (!existsSync(file)) throw new SimInputError(`${d}: no result.json (is it a run folder under sim/runs?)`);
    return { runName: basename(dir), output: readJson(file) as RunOutput };
  });
  const comparison = compareRuns(inputs);
  const outDir = resolve(flagStr(args, "out") ?? join(RUNS_DIR, `compare-${inputs.map((i) => i.runName).join("-vs-")}`.slice(0, 120)));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "compare.md"), renderComparison(comparison) + "\n");
  console.log(renderComparisonConsole(comparison));
  console.log("");
  console.log(`  compare.md → ${outDir}`);
}

// --- main --------------------------------------------------------------------

function usage(): string {
  return [
    "GAE simulator — docs/GAE_SIMULATOR.md",
    "",
    "  npm run sim -- venue list",
    "  npm run sim -- venue show <name>",
    "  npm run sim -- venue add <file> [--name x] [--display \"...\"] [--force]",
    "        .json  venue file or tier spec            [--format json|tierspec]",
    "        .xlsx  Cope RowRank workbook              [--sheet name] [--floors \"orchestra=85,front_balcony=70\"] [--tier-by area|section]",
    "        .csv   box-office manifest (UTF-16 ok)    [--rank-file section,row,rowRank.csv] [--sold-as-held] [--ignore-holds]",
    "  npm run sim -- import-pool <file.xlsx|.csv> [--sheet name] [--out sim/pools/x.csv] [--price=cents]",
    "  npm run sim -- compare-runs <run-dir> <run-dir> [...] [--out dir]",
    "  npm run sim -- run <scenario.json> [--venue name] [--group-mix \"1:10,2:45,3:10,4:25,5:5,6:5\"]",
    "                                     [--seeds N] [--seed N] [--oversub 1.25] [--active \"ORCH C,FC BAL\"]",
    "                                     [--name run-name] [--out dir] [--price=cents]",
    "                                     [--policies greedy,clean-fit,parity-tiebreak,singles-reserve[:k],clean-fit+singles-reserve]",
    "                                     [--raise fixed:5 | percent:5]   (auto-bid step rule)",
    "  npm run sim -- compare <scenario.json> --policies greedy,clean-fit    (run with policies side by side)",
    "  npm run sim -- sweep <scenario.json> --vary pool.oversubscription=0.6:2.0:0.1 [--seeds N] [--policies ...]",
    "        --vary paths: venue=a,b · pool.<knob>=... · show.<knob>=... · seeds · autoBidRaiseRule={json}",
    "        e.g. --vary pool.groupSizeMix=even-heavy,odd-heavy,singles-rich   --vary show.maxGroupSize=6,8,10",
    "             --vary pool.autoBid.sharePct=0,25,50   --vary show.floorsCents.orchestra=8500,10000,12500",
  ].join("\n");
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args.positional[0];
  try {
    switch (cmd) {
      case "venue":
        cmdVenue(args);
        return 0;
      case "run":
      case "compare":
        return cmdRun(args);
      case "sweep":
        return cmdSweep(args);
      case "import-pool":
        cmdImportPool(args);
        return 0;
      case "compare-runs":
        cmdCompareRuns(args);
        return 0;
      default:
        console.log(usage());
        return cmd === undefined || cmd === "help" ? 0 : 1;
    }
  } catch (e) {
    if (e instanceof SimInputError) {
      console.error(`error: ${e.message}`);
      return 2;
    }
    throw e;
  }
}

process.exitCode = main();
