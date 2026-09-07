// compare-runs: put saved runs side by side. Each run folder's result.json
// is a RunOutput; every (run, policy) pair becomes a column. Deltas are
// against the first column. When two columns ran the same offers on the
// same room, a per-offer diff shows who moved.

import type { RankedOffer } from "@/lib/gae/types";

import { pct, usd } from "./format";
import type { PolicyAggregate, PolicyRun, RunOutput } from "./types";

export type CompareColumn = {
  label: string;
  runName: string;
  venue: string;
  poolLabel: string;
  policy: string;
  seeds: number;
  agg: PolicyAggregate;
  first: PolicyRun;
  output: RunOutput;
};

export type OfferMove = {
  offerId: string;
  groupSize: number;
  priceCents: number;
  from: string; // "row 12" | "unplaced"
  to: string;
  fromRank: number | null;
  toRank: number | null;
};

export type OfferDiff = {
  a: string;
  b: string;
  moved: OfferMove[];
  gained: number; // unplaced in a, placed in b
  lost: number; // placed in a, unplaced in b
  sameRow: number;
};

export type Comparison = {
  columns: CompareColumn[];
  // metric key → per-column p50
  metrics: { key: string; label: string; fmt: "n" | "pct" | "usd"; values: number[] }[];
  groupSizes: number[];
  tiers: string[];
  offerDiffs: OfferDiff[]; // column 0 vs each other comparable column
};

const METRICS: { key: string; label: string; fmt: "n" | "pct" | "usd" }[] = [
  { key: "fill.placedSeats", label: "Seats filled", fmt: "n" },
  { key: "fill.fillRate", label: "Fill rate", fmt: "pct" },
  { key: "fill.emptySeats", label: "Empty seats", fmt: "n" },
  { key: "fill.holesBySize.1", label: "  1-seat holes", fmt: "n" },
  { key: "fill.holesBySize.2", label: "  2-seat holes", fmt: "n" },
  { key: "fill.holesBySize.3", label: "  3-seat holes", fmt: "n" },
  { key: "fill.emptySeatsOddRows", label: "  empty in odd-capacity rows", fmt: "n" },
  { key: "revenue.grossPlacedCents", label: "Gross placed", fmt: "usd" },
  { key: "revenue.unplacedValueCents", label: "Left on table", fmt: "usd" },
  { key: "revenue.avgPlacedPriceCents", label: "Avg placed price", fmt: "usd" },
  { key: "offers.total", label: "Offers", fmt: "n" },
  { key: "offers.placed", label: "Offers placed", fmt: "n" },
  { key: "offers.unplaced", label: "Offers unplaced", fmt: "n" },
  { key: "rankRespect.passedOver", label: "Passed over (rank-respect)", fmt: "n" },
  { key: "rankRespect.rowsLostMax", label: "Rows lost, max", fmt: "n" },
  { key: "rankRespect.priceGapMaxCents", label: "Price gap, max", fmt: "usd" },
  { key: "rankRespect.fitResolvedDeferrals", label: "FitResolver deferrals", fmt: "n" },
  { key: "rankRespect.waterfalled", label: "Waterfalled", fmt: "n" },
  { key: "policy.cleanFitDeferrals", label: "Clean-fit deferrals", fmt: "n" },
  { key: "policy.parityTiebreaks", label: "Parity tiebreaks", fmt: "n" },
  { key: "policy.reservedSinglesPlaced", label: "Reserved singles placed", fmt: "n" },
  { key: "policy.lookaheadDeferrals", label: "Lookahead deferrals", fmt: "n" },
  { key: "policy.protectedSeats", label: "Seats protected (tables/boxes)", fmt: "n" },
  { key: "seatPrefs.satisfied", label: "Seat prefs met by chance", fmt: "n" },
  { key: "temporal.upgrades.upliftCents", label: "Upgrade uplift to artist", fmt: "usd" },
  { key: "autoBid.raised", label: "Auto-bidders raised", fmt: "n" },
  { key: "autoBid.totalRaiseCents", label: "Auto-bid $ added", fmt: "usd" },
  { key: "autoBid.privateConverted", label: "Private offers converted", fmt: "n" },
  { key: "bleacher.estSoldSeats", label: "Bleacher est. sold seats", fmt: "n" },
  { key: "bleacher.combinedGrossCents", label: "Gross incl. Bleacher est.", fmt: "usd" },
  { key: "temporal.displacement.fansToldInThenOut", label: "Told in then out (fans)", fmt: "n" },
  { key: "temporal.rollingConfirmed.brokenConfirmations", label: "Broken confirmations", fmt: "n" },
  { key: "temporal.revisions.addedCents", label: "Added by revisions", fmt: "usd" },
  { key: "temporal.withdrawals.withdrawn", label: "Withdrawals", fmt: "n" },
  { key: "temporal.returns.refilledSeats", label: "Seats refilled after returns", fmt: "n" },
  { key: "temporal.returns.grossAfterReturnsCents", label: "Gross after returns", fmt: "usd" },
  { key: "temporal.registerFirst.acceptedUnseatedValueCents", label: "Accepted but unseated $", fmt: "usd" },
];
const OPTIONAL_KEYS = /^(fill\.holesBySize|policy\.|autoBid\.|bleacher\.|temporal\.|seatPrefs\.)/;

export function poolLabel(out: RunOutput): string {
  const p = out.scenario.pool;
  if ("file" in p) return `file ${p.file.split("/").pop()}`;
  const g = p.generate;
  const mix = typeof g.groupSizeMix === "string" ? g.groupSizeMix : Object.entries(g.groupSizeMix).map(([s, v]) => `${s}:${v}`).join(" ");
  return `gen ${g.oversubscription}× · mix ${mix} · seed ${g.seed}`;
}

export function compareRuns(inputs: { runName: string; output: RunOutput }[]): Comparison {
  const columnCount = inputs.reduce((s, i) => s + i.output.aggregates.length, 0);
  if (columnCount < 2) throw new Error("compare-runs needs at least two runs (or one run with two policies)");
  const columns: CompareColumn[] = [];
  for (const { runName, output } of inputs) {
    for (const agg of output.aggregates) {
      const first = output.runs.find((r) => r.policy === agg.policy)!;
      columns.push({
        label: inputs.length === 1 ? agg.policy : output.aggregates.length > 1 ? `${runName} / ${agg.policy}` : runName,
        runName,
        venue: output.venueName,
        poolLabel: poolLabel(output),
        policy: agg.policy,
        seeds: agg.seeds,
        agg,
        first,
        output,
      });
    }
  }
  const metrics = METRICS.map((m) => ({ ...m, values: columns.map((c) => c.agg.scalars[m.key]?.p50 ?? 0) }));
  const groupSizes = [...new Set(columns.flatMap((c) => Object.keys(c.agg.byGroupSize).map(Number)))].sort((a, b) => a - b);
  const tiers = [...new Set(columns.flatMap((c) => Object.keys(c.agg.byTier)))];
  const offerDiffs: OfferDiff[] = [];
  const base = columns[0]!;
  for (const other of columns.slice(1)) {
    if (comparable(base, other)) offerDiffs.push(diffOffers(base, other));
  }
  return { columns, metrics, groupSizes, tiers, offerDiffs };
}

function sameOffers(a: RankedOffer[] | undefined, b: RankedOffer[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  const key = (o: RankedOffer): string => `${o.id}|${o.groupSize}|${o.pricePerTicketCents}|${JSON.stringify(o.tierPreference)}`;
  const sa = new Set(a.map(key));
  return b.every((o) => sa.has(key(o)));
}

function comparable(a: CompareColumn, b: CompareColumn): boolean {
  return a.venue === b.venue && sameOffers(a.first.offers, b.first.offers) && a.first.result !== undefined && b.first.result !== undefined;
}

function rowRankLookup(out: RunOutput): Map<string, number> {
  // result.json carries the resolved venue only through the seat map, so
  // rank is recovered from the row ids the run wrote: the seat-map renderer
  // isn't available here, but assignments carry venueRowId and the venue
  // summary doesn't carry rows. We store rowRank per assignment row in
  // PolicyRun.rowRanks when available; fall back to id order.
  const m = new Map<string, number>();
  const ranks = out.rowRanks ?? {};
  for (const [id, rank] of Object.entries(ranks)) m.set(id, rank);
  return m;
}

function diffOffers(a: CompareColumn, b: CompareColumn): OfferDiff {
  const rankA = rowRankLookup(a.output);
  const rankB = rowRankLookup(b.output);
  const rowOf = (run: PolicyRun): Map<string, string> => {
    const m = new Map<string, string>();
    for (const s of run.result!.assignments) if (!m.has(s.offerId)) m.set(s.offerId, s.venueRowId);
    return m;
  };
  const ra = rowOf(a.first);
  const rb = rowOf(b.first);
  const moved: OfferMove[] = [];
  let gained = 0;
  let lost = 0;
  let sameRow = 0;
  const ranked = [...a.first.offers!].sort((x, y) => y.rankKey - x.rankKey || x.submittedAt.toString().localeCompare(y.submittedAt.toString()) || x.id.localeCompare(y.id));
  for (const o of ranked) {
    const fa = ra.get(o.id);
    const fb = rb.get(o.id);
    if (fa === fb) {
      if (fa !== undefined) sameRow += 1;
      continue;
    }
    if (fa === undefined) gained += 1;
    if (fb === undefined) lost += 1;
    const fromRank = fa === undefined ? null : (rankA.get(fa) ?? null);
    const toRank = fb === undefined ? null : (rankB.get(fb) ?? null);
    moved.push({
      offerId: o.id,
      groupSize: o.groupSize,
      priceCents: o.pricePerTicketCents,
      from: fa === undefined ? "unplaced" : `row ${fromRank ?? fa}`,
      to: fb === undefined ? "unplaced" : `row ${toRank ?? fb}`,
      fromRank,
      toRank,
    });
  }
  return { a: a.label, b: b.label, moved, gained, lost, sameRow };
}

// --- rendering ---------------------------------------------------------------

const fmtOf = (fmt: "n" | "pct" | "usd") => (v: number): string =>
  fmt === "pct" ? pct(v) : fmt === "usd" ? usd(v) : Math.round(v).toLocaleString("en-US");

function delta(fmt: "n" | "pct" | "usd", v: number, base: number): string {
  const d = v - base;
  if (Math.abs(d) < 1e-9) return "—";
  const sign = d > 0 ? "+" : "−";
  const abs = Math.abs(d);
  return sign + (fmt === "pct" ? `${(100 * abs).toFixed(1)} pts` : fmtOf(fmt)(abs));
}

export function renderComparison(c: Comparison): string {
  const L: string[] = [];
  const cols = c.columns;
  L.push(`# Run comparison — ${cols.map((x) => x.label).join(" vs ")}`);
  L.push("");
  L.push("| | " + cols.map((x) => `**${x.label}**`).join(" | ") + " |");
  L.push("|---|" + cols.map(() => "---").join("|") + "|");
  L.push("| Venue | " + cols.map((x) => x.venue).join(" | ") + " |");
  L.push("| Pool | " + cols.map((x) => x.poolLabel).join(" | ") + " |");
  L.push("| Policy | " + cols.map((x) => x.policy).join(" | ") + " |");
  L.push("| Rank-first? | " + cols.map((x) => (x.first.config.singlesReserve ? "no (reserve)" : x.first.config.fitPolicy === "lookahead" ? "no (lookahead)" : x.first.config.fitPolicy === "clean_fit" ? "subject to clean-fit deferrals" : x.first.config.parityTiebreak ? "yes (ties reordered at equal price)" : "yes")).join(" | ") + " |");
  L.push("| Seeds | " + cols.map((x) => String(x.seeds)).join(" | ") + " |");
  L.push("| Run date | " + cols.map((x) => x.output.generatedAt.slice(0, 16).replace("T", " ")).join(" | ") + " |");
  L.push("");
  L.push("## Fill report side by side (p50 where seeds > 1; Δ vs first column)");
  L.push("");
  L.push("| Metric | " + cols.map((x) => x.label).join(" | ") + " |");
  L.push("|---|" + cols.map(() => "---:").join("|") + "|");
  for (const m of c.metrics) {
    if (OPTIONAL_KEYS.test(m.key) && m.values.every((v) => v === 0)) continue;
    const f = fmtOf(m.fmt);
    const cells = m.values.map((v, i) => (i === 0 ? f(v) : `${f(v)} (${delta(m.fmt, v, m.values[0]!)})`));
    L.push(`| ${m.label.replace(/^ {2}/, "&nbsp;&nbsp;")} | ${cells.join(" | ")} |`);
  }
  L.push("");
  L.push("## By group size — placed % / median row rank");
  L.push("");
  L.push("| Group size | " + cols.map((x) => x.label).join(" | ") + " |");
  L.push("|---:|" + cols.map(() => "---:").join("|") + "|");
  for (const size of c.groupSizes) {
    const cells = cols.map((x) => {
      const g = x.agg.byGroupSize[size];
      if (!g || g.offers.p50 === 0) return "—";
      const med = g.placed.p50 === 0 ? "—" : Math.round(g.medianRowRank.p50).toLocaleString("en-US");
      return `${pct(g.placedRate.p50, 0)} / row ${med}`;
    });
    L.push(`| ${size} | ${cells.join(" | ")} |`);
  }
  L.push("");
  L.push("## By tier — fill / gross");
  L.push("");
  L.push("| Tier | " + cols.map((x) => x.label).join(" | ") + " |");
  L.push("|---|" + cols.map(() => "---:").join("|") + "|");
  for (const tier of c.tiers) {
    const cells = cols.map((x) => {
      const t = x.agg.byTier[tier];
      return t ? `${pct(t.fillRate.p50)} / ${usd(t.grossCents.p50)}` : "—";
    });
    L.push(`| ${tier} | ${cells.join(" | ")} |`);
  }
  L.push("");
  if (c.offerDiffs.length === 0) {
    L.push("_No per-offer diff: the runs used different pools or venues. Compare runs of the same pool file (or the same generated seed) on the same venue to see who moved._");
  }
  for (const d of c.offerDiffs) {
    L.push(`## Who moved — ${d.a} → ${d.b}`);
    L.push("");
    L.push(`${d.moved.length} offers changed row · ${d.gained} gained a seat · ${d.lost} lost a seat · ${d.sameRow} unchanged.`);
    L.push("");
    if (d.moved.length > 0) {
      L.push("| Offer | Size | Price | From | To |");
      L.push("|---|---:|---:|---|---|");
      for (const m of d.moved.slice(0, 200)) L.push(`| ${m.offerId} | ${m.groupSize} | ${usd(m.priceCents)} | ${m.from} | ${m.to} |`);
      if (d.moved.length > 200) L.push(`| … | | | ${d.moved.length - 200} more | |`);
      L.push("");
    }
  }
  return L.join("\n");
}

export function renderComparisonConsole(c: Comparison): string {
  const cols = c.columns;
  const w = Math.max(14, ...cols.map((x) => x.label.length + 2));
  const L: string[] = [];
  L.push(`RUN COMPARISON` + " ".repeat(20) + cols.map((x) => x.label.padStart(w)).join(""));
  L.push("  " + "venue".padEnd(32) + cols.map((x) => x.venue.padStart(w)).join(""));
  L.push("  " + "policy · seeds".padEnd(32) + cols.map((x) => `${x.policy} · ${x.seeds}`.padStart(w)).join(""));
  for (const m of c.metrics) {
    if (OPTIONAL_KEYS.test(m.key) && m.values.every((v) => v === 0)) continue;
    const f = fmtOf(m.fmt);
    L.push("  " + m.label.padEnd(32) + m.values.map((v) => f(v).padStart(w)).join(""));
  }
  L.push("  " + "by group size (placed% / row)".padEnd(32));
  for (const size of c.groupSizes) {
    L.push(
      "  " +
        `  ${size}`.padEnd(32) +
        cols
          .map((x) => {
            const g = x.agg.byGroupSize[size];
            if (!g || g.offers.p50 === 0) return "—".padStart(w);
            return `${pct(g.placedRate.p50, 0)} / ${g.placed.p50 === 0 ? "—" : Math.round(g.medianRowRank.p50)}`.padStart(w);
          })
          .join(""),
    );
  }
  for (const d of c.offerDiffs) L.push(`  who moved (${d.a} → ${d.b}): ${d.moved.length} changed row, ${d.gained} gained, ${d.lost} lost`);
  return L.join("\n");
}
