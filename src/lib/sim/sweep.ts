// Sweeps: vary one scenario parameter over a list or range, run every
// point (× seeds × policies), and lay the results out as curves — Cope's
// "distribution with yield capacity". Pure: the CLI resolves venues and
// pool files per point and hands the points in.

import { n, pct, usd } from "./format";
import type { Percentiles, PolicyRun, RunOutput, Scenario, SweepOutput, SweepPoint } from "./types";
import { SimInputError } from "./venue";

export type VarySpec = { path: string; values: unknown[] };

// "pool.oversubscription=0.6:2.0:0.1" → range; "pool.groupSizeMix=a,b,c" → list.
// Values parse as numbers when numeric, JSON when they start with { or [,
// otherwise strings. "pool.X" is shorthand for "pool.generate.X".
export function parseVaryArg(arg: string): VarySpec {
  const eq = arg.indexOf("=");
  if (eq === -1) throw new SimInputError(`--vary: want path=values, e.g. pool.oversubscription=0.6:2.0:0.1 or pool.groupSizeMix=even-heavy,odd-heavy`);
  const path = normalizePath(arg.slice(0, eq).trim());
  const raw = arg.slice(eq + 1).trim();
  const range = /^(-?[\d.]+):(-?[\d.]+):(-?[\d.]+)$/.exec(raw);
  if (range) {
    const [start, end, step] = [Number(range[1]), Number(range[2]), Number(range[3])];
    if (!(step > 0) || end < start) throw new SimInputError(`--vary: bad range "${raw}" (want start:end:step with step > 0)`);
    const values: number[] = [];
    const decimals = Math.max(0, ...[range[1]!, range[3]!].map((x) => (x.split(".")[1] ?? "").length));
    for (let v = start; v <= end + step / 1e6; v += step) values.push(Number(v.toFixed(decimals)));
    return { path, values };
  }
  const values = splitTopLevel(raw).map((v) => parseValue(v.trim()));
  if (values.length === 0) throw new SimInputError("--vary: no values");
  return { path, values };
}

// Split on commas that are not inside {} or [] so JSON values survive.
function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "{" || ch === "[") depth++;
    if (ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseValue(v: string): unknown {
  if (v === "") throw new SimInputError("--vary: empty value in list");
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith("{") || v.startsWith("[")) {
    try {
      return JSON.parse(v);
    } catch {
      throw new SimInputError(`--vary: cannot parse JSON value ${v}`);
    }
  }
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

export function normalizePath(path: string): string {
  const parts = path.split(".");
  if (parts[0] === "pool" && parts[1] !== "generate" && parts[1] !== "file") return ["pool", "generate", ...parts.slice(1)].join(".");
  return path;
}

const SWEEPABLE_ROOTS = new Set(["venue", "show", "pool", "seeds", "autoBidRaiseRule"]);

// Return a copy of the scenario with `path` set to `value`. Intermediate
// objects are created; arrays are not traversed.
export function applyVary(scenario: Scenario, path: string, value: unknown): Scenario {
  const parts = path.split(".");
  if (!SWEEPABLE_ROOTS.has(parts[0]!)) throw new SimInputError(`--vary: "${parts[0]}" is not sweepable (try venue, show.*, pool.*, seeds, autoBidRaiseRule)`);
  if (parts[0] === "policies") throw new SimInputError("--vary: use --policies to compare policies; they run at every point");
  const root: Record<string, unknown> = JSON.parse(JSON.stringify(scenario)) as Record<string, unknown>;
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cur[key];
    if (next === undefined || next === null || typeof next !== "object" || Array.isArray(next)) {
      if (key === "generate" && "file" in cur) throw new SimInputError(`--vary: "${path}" needs a generated pool, but this scenario uses a pool file`);
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
  return root as unknown as Scenario;
}

export function labelFor(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

// Drop per-seed engine output so a 20-point × 50-seed sweep stays small.
export function slimOutput(out: RunOutput): RunOutput {
  return {
    ...out,
    runs: out.runs.map((r) => {
      const slim: PolicyRun = { ...r };
      delete slim.result;
      delete slim.offers;
      delete slim.raises;
      return slim;
    }),
  };
}

export function assembleSweep(scenarioName: string, path: string, points: SweepPoint[], now?: string): SweepOutput {
  if (points.length < 2) throw new SimInputError("a sweep needs at least two values");
  const first = points[0]!.output;
  return {
    scenarioName,
    path,
    points,
    policies: first.policies,
    seeds: first.seeds.length,
    generatedAt: now ?? new Date().toISOString(),
  };
}

// --- rendering ---------------------------------------------------------------

type Metric = { key: string; label: string; fmt: (v: number) => string };

const CURVES: Metric[] = [
  { key: "fill.fillRate", label: "Fill rate", fmt: (v) => pct(v) },
  { key: "fill.emptySeats", label: "Empty seats", fmt: n },
  { key: "fill.holesBySize.1", label: "1-seat holes", fmt: n },
  { key: "revenue.grossPlacedCents", label: "Gross placed", fmt: usd },
  { key: "revenue.unplacedValueCents", label: "Left on table", fmt: usd },
  { key: "revenue.avgPlacedPriceCents", label: "Avg placed price", fmt: usd },
  { key: "offers.placed", label: "Offers placed", fmt: n },
  { key: "offers.unplaced", label: "Offers unplaced", fmt: n },
  { key: "rankRespect.passedOver", label: "Passed over", fmt: n },
  { key: "autoBid.totalRaiseCents", label: "Auto-bid $ added", fmt: usd },
  { key: "bleacher.combinedGrossCents", label: "Gross incl. Bleacher est.", fmt: usd },
];

function agg(point: SweepPoint, policy: string): Record<string, Percentiles> {
  return point.output.aggregates.find((a) => a.policy === policy)?.scalars ?? {};
}

export function renderSweep(sw: SweepOutput): string {
  const L: string[] = [];
  const multi = sw.seeds > 1;
  L.push(`# Sweep — ${sw.scenarioName} · ${sw.path}`);
  L.push("");
  L.push(`${sw.points.length} values × ${sw.seeds} seed(s) × ${sw.policies.length} polic${sw.policies.length === 1 ? "y" : "ies"} (${sw.policies.join(", ")}) · ${sw.generatedAt}`);
  L.push("");
  L.push(`Each row is one value of \`${sw.path}\`; cells are p50${multi ? " with p5–p95" : ""}. The first table is the yield curve: how fill and gross move with the parameter.`);
  L.push("");
  for (const policy of sw.policies) {
    L.push(`## Policy \`${policy}\``);
    L.push("");
    L.push(`| ${sw.path} | Fill rate | Empty | Gross placed | Left on table | Offers placed | Passed over |`);
    L.push("|---|---:|---:|---:|---:|---:|---:|");
    for (const p of sw.points) {
      const s = agg(p, policy);
      const c = (key: string, fmt: (v: number) => string): string => {
        const v = s[key];
        if (!v) return "—";
        return multi ? `${fmt(v.p50)} <sub>${fmt(v.p5)}–${fmt(v.p95)}</sub>` : fmt(v.p50);
      };
      L.push(`| ${p.label} | ${c("fill.fillRate", (v) => pct(v))} | ${c("fill.emptySeats", n)} | ${c("revenue.grossPlacedCents", usd)} | ${c("revenue.unplacedValueCents", usd)} | ${c("offers.placed", n)} | ${c("rankRespect.passedOver", n)} |`);
    }
    L.push("");
    L.push("### By group size — placed % (p50)");
    L.push("");
    const sizes = [...new Set(sw.points.flatMap((p) => Object.keys(p.output.aggregates.find((a) => a.policy === policy)?.byGroupSize ?? {}).map(Number)))].sort((a, b) => a - b);
    L.push(`| ${sw.path} | ${sizes.map((z) => `size ${z}`).join(" | ")} |`);
    L.push(`|---|${sizes.map(() => "---:").join("|")}|`);
    for (const p of sw.points) {
      const bg = p.output.aggregates.find((a) => a.policy === policy)?.byGroupSize ?? {};
      L.push(`| ${p.label} | ${sizes.map((z) => (bg[z] && bg[z]!.offers.p50 > 0 ? pct(bg[z]!.placedRate.p50, 0) : "—")).join(" | ")} |`);
    }
    L.push("");
    L.push("### Every curve (p50)");
    L.push("");
    L.push(`| Metric | ${sw.points.map((p) => p.label).join(" | ")} |`);
    L.push(`|---|${sw.points.map(() => "---:").join("|")}|`);
    for (const m of CURVES) {
      const values = sw.points.map((p) => agg(p, policy)[m.key]);
      if (values.every((v) => !v || v.p50 === 0)) continue;
      L.push(`| ${m.label} | ${values.map((v) => (v ? m.fmt(v.p50) : "—")).join(" | ")} |`);
    }
    L.push("");
  }
  L.push("`sweep.csv` has every metric per value, policy and seed statistic (p5/p50/p95/mean/stdev/min/max) for charting in Excel.");
  return L.join("\n");
}

export function renderSweepCsv(sw: SweepOutput): string {
  const lines = ["param,value,policy,metric,p5,p50,p95,mean,stdev,min,max"];
  for (const p of sw.points) {
    for (const a of p.output.aggregates) {
      for (const [key, v] of Object.entries(a.scalars)) {
        lines.push([sw.path, csv(p.label), a.policy, key, v.p5, v.p50, v.p95, v.mean, v.stdev, v.min, v.max].join(","));
      }
      for (const [size, g] of Object.entries(a.byGroupSize)) {
        lines.push([sw.path, csv(p.label), a.policy, `byGroupSize.${size}.placedRate`, g.placedRate.p5, g.placedRate.p50, g.placedRate.p95, g.placedRate.mean, g.placedRate.stdev, g.placedRate.min, g.placedRate.max].join(","));
      }
      for (const [tier, t] of Object.entries(a.byTier)) {
        lines.push([sw.path, csv(p.label), a.policy, `byTier.${tier}.fillRate`, t.fillRate.p5, t.fillRate.p50, t.fillRate.p95, t.fillRate.mean, t.fillRate.stdev, t.fillRate.min, t.fillRate.max].join(","));
      }
    }
  }
  return lines.join("\n") + "\n";
}

function csv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// Terminal: fill-rate and gross bars per value, per policy.
export function renderSweepConsole(sw: SweepOutput): string {
  const L: string[] = [];
  L.push(`SWEEP — ${sw.scenarioName} · ${sw.path} · ${sw.points.length} values × ${sw.seeds} seed(s)`);
  const w = Math.max(6, ...sw.points.map((p) => p.label.length));
  for (const policy of sw.policies) {
    L.push("");
    L.push(`  policy: ${policy}`);
    L.push(`  ${"value".padEnd(w)}   fill rate                     gross placed      left on table   passed over`);
    const maxGross = Math.max(1, ...sw.points.map((p) => agg(p, policy)["revenue.grossPlacedCents"]?.p50 ?? 0));
    for (const p of sw.points) {
      const s = agg(p, policy);
      const fill = s["fill.fillRate"]?.p50 ?? 0;
      const gross = s["revenue.grossPlacedCents"]?.p50 ?? 0;
      const bar = "█".repeat(Math.round(fill * 20)).padEnd(20, "·");
      const gbar = "▪".repeat(Math.round((gross / maxGross) * 10)).padEnd(10, " ");
      L.push(`  ${p.label.padEnd(w)}   ${bar} ${pct(fill).padStart(6)}   ${gbar} ${usd(gross).padStart(12)}   ${usd(s["revenue.unplacedValueCents"]?.p50 ?? 0).padStart(12)}   ${n(s["rankRespect.passedOver"]?.p50 ?? 0).padStart(6)}`);
    }
  }
  return L.join("\n");
}
