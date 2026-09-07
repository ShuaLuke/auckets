// GAE simulator CLI — the only place in the sim that touches the filesystem.
// Everything it calls lives in src/lib/sim (pure) and src/lib/gae (pure).
// See docs/GAE_SIMULATOR.md and sim/README.md.
//
//   npm run sim -- venue list
//   npm run sim -- venue show lincoln-v4
//   npm run sim -- venue add <file.json> [--name x] [--format json|tierspec]
//   npm run sim -- run sim/scenarios/<name>.json [--venue x] [--group-mix "1:10,2:45,..."]
//                       [--seeds N] [--seed N] [--oversub X] [--active "A,B"] [--name run] [--price=cents]

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  applyShowOverlay,
  formatIssues,
  offersFromCsv,
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
  type RunOutput,
  type Scenario,
  type SimVenue,
} from "../src/lib/sim";

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
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      throw new SimInputError(
        "xlsx import lands in slice 2. Cope's Lincoln v4 workbook is already in the library as `lincoln-v4`; for another workbook, export the architecture sheet to JSON in the venue-file shape (see sim/README.md).",
      );
    }
    if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
      throw new SimInputError("box-office manifest import lands in slice 2. Slice 1 accepts venue JSON and tier-spec JSON.");
    }
    const raw = readJson(path) as Record<string, unknown>;
    const format = flagStr(args, "format") ?? (Array.isArray(raw.tiers) ? "tierspec" : "json");
    if (flagStr(args, "name")) raw.name = flagStr(args, "name");
    if (flagStr(args, "display")) raw.displayName = flagStr(args, "display");
    if (typeof raw.name !== "string") raw.name = basename(file).replace(/\.json$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (typeof raw.displayName !== "string") raw.displayName = raw.name;
    const venue = format === "tierspec" ? venueFromTierSpec(raw, file) : parseVenueFile(raw, file);
    mkdirSync(VENUES_DIR, { recursive: true });
    const dest = join(VENUES_DIR, `${venue.name}.json`);
    if (existsSync(dest) && args.flags.force !== true) {
      throw new SimInputError(`${dest} already exists. Pass --force to replace it, or --name to pick another name.`);
    }
    const stored: SimVenue = {
      ...venue,
      source: { ...(venue.source ?? { kind: format }), file: basename(file), importedAt: new Date().toISOString().slice(0, 10) },
    };
    writeFileSync(dest, JSON.stringify(stored, null, 2) + "\n");
    console.log(`Added ${venue.name} → ${dest}`);
    console.log(venueSummaryLine(venue));
    return;
  }
  throw new SimInputError(`unknown venue command "${sub}". Try: venue list | venue show <name> | venue add <file>`);
}

// --- run ---------------------------------------------------------------------

function cmdRun(args: Args): number {
  const scenarioPath = args.positional[1];
  if (!scenarioPath) throw new SimInputError("usage: run <scenario.json> [--venue x] [--group-mix ...] [--seeds N] ...");
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
  const check = ScenarioSchema.safeParse(scenario);
  if (!check.success) throw new SimInputError(formatIssues("overrides", check.error));

  const venue = loadVenue(scenario.venue);
  const poolOffers =
    "file" in scenario.pool
      ? offersFromCsv(readFileSync(resolve(ROOT, scenario.pool.file), "utf8"), {
          priceMode: flagStr(args, "price") === "cents" ? "cents" : "dollars",
          label: scenario.pool.file,
        })
      : undefined;

  const t0 = performance.now();
  const output = runScenario(poolOffers ? { scenario, venue, poolOffers } : { scenario, venue });
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

// --- main --------------------------------------------------------------------

function usage(): string {
  return [
    "GAE simulator — docs/GAE_SIMULATOR.md",
    "",
    "  npm run sim -- venue list",
    "  npm run sim -- venue show <name>",
    "  npm run sim -- venue add <file.json> [--name x] [--display \"...\"] [--format json|tierspec] [--force]",
    "  npm run sim -- run <scenario.json> [--venue name] [--group-mix \"1:10,2:45,3:10,4:25,5:5,6:5\"]",
    "                                     [--seeds N] [--seed N] [--oversub 1.25] [--active \"ORCH C,FC BAL\"]",
    "                                     [--name run-name] [--out dir] [--price=cents]",
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
        return cmdRun(args);
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
