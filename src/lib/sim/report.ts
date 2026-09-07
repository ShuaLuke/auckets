// Renderers for a run: the fill report (markdown, also printed to the
// terminal), the per-offer CSV that opens in Excel, and a text seat map.
// Dollars appear only here — everything upstream is integer cents.

import { formatTierPref } from "./pool";
import type { FillMetrics, Percentiles, PolicyAggregate, PolicyRun, RunOutput, SimVenue } from "./types";
import { activeRows, tierOrder } from "./venue";

export function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export function pct(rate: number, digits = 1): string {
  return `${(100 * rate).toFixed(digits)}%`;
}

const n = (v: number): string => Math.round(v).toLocaleString("en-US");

// --- Fill report -----------------------------------------------------------

export function renderFillReport(out: RunOutput): string {
  const lines: string[] = [];
  const multi = out.seeds.length > 1;
  const gen = "generate" in out.scenario.pool ? out.scenario.pool.generate : undefined;

  lines.push(`# Fill report — ${out.scenarioName}`);
  lines.push("");
  lines.push(`Venue **${out.venueDisplayName}** (\`${out.venueName}\`) · pool ${gen ? `generated (${multi ? `${out.seeds.length} seeds from ${out.seeds[0]}` : `seed ${out.seeds[0]}`})` : `file \`${(out.scenario.pool as { file: string }).file}\``} · policies ${out.policies.join(", ")}`);
  lines.push(`Run ${out.generatedAt} · input hash \`${out.inputHash.slice(0, 12)}\``);
  lines.push("");

  // Venue parity summary (Cope's Architecture Summary)
  lines.push("## Venue");
  lines.push("");
  lines.push("| Scope | On sale | Rows | Even | Odd | 1-seat | 2-seat | Relief-flagged | Held | GA |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const v of out.venueSummary) {
    lines.push(`| ${v.scope} | ${n(v.capacity)} | ${v.activeRows}/${v.rows} | ${v.evenRows} | ${v.oddRows} | ${v.singleRows} | ${v.pairRows} | ${v.reliefFlaggedRows} | ${v.heldSeats} | ${n(v.gaSeats)} |`);
  }
  lines.push("");

  // Offer parity summary (Cope's Offer Pool Summary)
  const os = out.offerSummary;
  lines.push(`## Offer pool${multi ? " (first seed)" : ""}`);
  lines.push("");
  lines.push(`${n(os.offers)} offers · ${n(os.ticketsRequested)} tickets requested for ${n(os.availableSeats)} seats · demand ${os.demandMultiple.toFixed(2)}× · prices ${usd(os.priceMinCents)}–${usd(os.priceMaxCents)} (median ${usd(os.priceMedianCents)})`);
  lines.push(`Even groups: ${n(os.evenOffers)} offers / ${n(os.evenTickets)} tickets · odd groups: ${n(os.oddOffers)} / ${n(os.oddTickets)}`);
  lines.push(`Preferences: specific ${os.byPreference.specific} · this-or-worse ${os.byPreference.this_or_worse} · this-or-better ${os.byPreference.this_or_better} · any ${os.byPreference.any}`);
  lines.push("");
  lines.push("| Group size | Offers | % of offers | Tickets | % of tickets |");
  lines.push("|---:|---:|---:|---:|---:|");
  for (const size of Object.keys(os.byGroupSize).map(Number).sort((a, b) => a - b)) {
    const g = os.byGroupSize[size]!;
    lines.push(`| ${size} | ${n(g.offers)} | ${g.shareOfOffersPct.toFixed(1)}% | ${n(g.tickets)} | ${g.shareOfTicketsPct.toFixed(1)}% |`);
  }
  if (gen) {
    const asked = typeof gen.groupSizeMix === "string" ? `preset "${gen.groupSizeMix}"` : Object.entries(gen.groupSizeMix).map(([s, p]) => `${s}:${p}%`).join(" ");
    lines.push("");
    lines.push(`Requested mix: ${asked}. The table above is the mix actually drawn.`);
  }
  lines.push("");

  for (const agg of out.aggregates) {
    const first = out.runs.find((r) => r.policy === agg.policy)!;
    lines.push(...renderPolicySection(out, agg, first, multi));
  }
  return lines.join("\n");
}

function renderPolicySection(out: RunOutput, agg: PolicyAggregate, first: PolicyRun, multi: boolean): string[] {
  const L: string[] = [];
  const m = first.metrics;
  const cap = m.capacity;
  const sc = agg.scalars;
  const cell = (key: string, fmt: (v: number) => string): string => {
    const p = sc[key]!;
    return multi ? `${fmt(p.p50)} | ${fmt(p.p5)} | ${fmt(p.p95)}` : fmt(p.p50);
  };
  const hdr = multi ? "| Metric | p50 | p5 | p95 |" : "| Metric | Value |";
  const sep = multi ? "|---|---:|---:|---:|" : "|---|---:|";

  L.push(`## FILL REPORT — policy \`${agg.policy}\`${multi ? ` · ${agg.seeds} seeds` : ""}`);
  L.push("");
  L.push(`On sale: ${n(cap.availableSeats)} seats (${n(cap.totalSeats)} total, ${n(cap.heldSeats)} held${heldBreakdown(cap.heldBySource)}) across ${cap.activeRows} active rows.`);
  L.push("");
  L.push(hdr);
  L.push(sep);
  L.push(`| Seats filled | ${cell("fill.placedSeats", n)} |`);
  L.push(`| Fill rate | ${cell("fill.fillRate", (v) => pct(v))} |`);
  L.push(`| Empty seats | ${cell("fill.emptySeats", n)} |`);
  for (let size = 1; size <= 6; size++) {
    if (sc[`fill.holesBySize.${size}`]!.p95 > 0) {
      L.push(`| &nbsp;&nbsp;${size}-seat holes | ${cell(`fill.holesBySize.${size}`, n)} |`);
    }
  }
  L.push(`| &nbsp;&nbsp;empty seats in odd-capacity rows | ${cell("fill.emptySeatsOddRows", n)} |`);
  L.push(`| &nbsp;&nbsp;empty seats in even-capacity rows | ${cell("fill.emptySeatsEvenRows", n)} |`);
  L.push(`| Rows full | ${cell("fill.rowsFull", n)} |`);
  L.push(`| Rows partly filled | ${cell("fill.rowsPartial", n)} |`);
  L.push(`| Rows untouched | ${cell("fill.rowsEmpty", n)} |`);
  L.push(`| Gross placed | ${cell("revenue.grossPlacedCents", usd)} |`);
  L.push(`| Left on table (all unplaced) | ${cell("revenue.unplacedValueCents", usd)} |`);
  L.push(`| &nbsp;&nbsp;of which would have fit somewhere | ${cell("revenue.unplacedFittableValueCents", usd)} |`);
  L.push(`| Avg placed price | ${cell("revenue.avgPlacedPriceCents", usd)} |`);
  L.push(`| Median placed price | ${cell("revenue.medianPlacedPriceCents", usd)} |`);
  L.push(`| Offers placed | ${cell("offers.placed", n)} |`);
  L.push(`| Offers unplaced | ${cell("offers.unplaced", n)} |`);
  L.push("");

  // By tier
  L.push(`### By tier${multi ? " (p50)" : ""}`);
  L.push("");
  L.push("| Tier | Filled / on sale | Fill | Empty | Offers | Gross | Avg price | Median price |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const tier of Object.keys(m.byTier)) {
    const t = m.byTier[tier]!;
    const a = agg.byTier[tier];
    const placed = multi && a ? a.placedSeats.p50 : t.placedSeats;
    const empty = multi && a ? a.emptySeats.p50 : t.emptySeats;
    const offers = multi && a ? a.offersPlaced.p50 : t.offersPlaced;
    const fill = multi && a ? a.fillRate.p50 : t.fillRate;
    const gross = multi && a ? a.grossCents.p50 : t.grossCents;
    L.push(`| ${tier} | ${n(placed)} / ${n(t.availableSeats)} | ${pct(fill)} | ${n(empty)} | ${n(offers)} | ${usd(gross)} | ${usd(t.avgPriceCents)} | ${usd(t.medianPriceCents)} |`);
  }
  if (multi) L.push("", "Avg and median price are from the first seed.");
  L.push("");

  // By area
  L.push(`### By area${multi ? " (first seed)" : ""}`);
  L.push("");
  L.push("| Area | Filled / on sale | Fill | Empty | Gross |");
  L.push("|---|---:|---:|---:|---:|");
  for (const [area, a] of Object.entries(m.byArea)) {
    L.push(`| ${area} | ${n(a.placedSeats)} / ${n(a.availableSeats)} | ${pct(a.fillRate)} | ${n(a.emptySeats)} | ${usd(a.grossCents)} |`);
  }
  L.push("");

  // By group size — the "how does this mix fill" table
  L.push(`### By group size${multi ? " (p50 across seeds)" : ""}`);
  L.push("");
  L.push("| Group size | Offers | Placed | Placed % | Tickets placed | Median row rank | Best | Worst |");
  L.push("|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const size of Object.keys(agg.byGroupSize).map(Number).sort((a, b) => a - b)) {
    const g = m.byGroupSize[size];
    const a = agg.byGroupSize[size]!;
    const offers = multi ? a.offers.p50 : (g?.offers ?? 0);
    const placed = multi ? a.placed.p50 : (g?.placed ?? 0);
    const tickets = multi ? a.ticketsPlaced.p50 : (g?.ticketsPlaced ?? 0);
    const placedRate = multi ? a.placedRate.p50 : (g?.placedRate ?? 0);
    const medRank = multi ? a.medianRowRank.p50 : g?.medianRowRank;
    L.push(`| ${size} | ${n(offers)} | ${n(placed)} | ${pct(placedRate, 0)} | ${n(tickets)} | ${medRank === null || medRank === undefined || placed === 0 ? "—" : n(medRank)} | ${g?.bestRowRank ?? "—"} | ${g?.worstRowRank ?? "—"} |`);
  }
  if (multi) L.push("", "Best / worst row rank are from the first seed.");
  L.push("");

  // Preference honouring
  L.push("### Preference honouring" + (multi ? " (first seed)" : ""));
  L.push("");
  L.push("| Preference | Offers | In preferred tier | Waterfalled down | Moved up | Unplaced |");
  L.push("|---|---:|---:|---:|---:|---:|");
  for (const [k, p] of Object.entries(m.preference)) {
    if (p.offers === 0) continue;
    L.push(`| ${k.replace(/_/g, "-")} | ${n(p.offers)} | ${n(p.placedPreferred)} | ${n(p.placedWorse)} | ${n(p.placedBetter)} | ${n(p.unplaced)} |`);
  }
  L.push("");

  // Rank respect
  L.push("### Rank-respect");
  L.push("");
  L.push(hdr);
  L.push(sep);
  L.push(`| Offers passed over by a lower-ranked offer in a better row they could have fit | ${cell("rankRespect.passedOver", n)} |`);
  L.push(`| Rows lost, total | ${cell("rankRespect.rowsLostSum", n)} |`);
  L.push(`| Rows lost, max | ${cell("rankRespect.rowsLostMax", n)} |`);
  L.push(`| Price gap to the cheaper fan who got the better row, max | ${cell("rankRespect.priceGapMaxCents", usd)} |`);
  L.push(`| FitResolver deferrals | ${cell("rankRespect.fitResolvedDeferrals", n)} |`);
  L.push(`| Waterfalled placements | ${cell("rankRespect.waterfalled", n)} |`);
  L.push("");
  L.push("\"Passed over\" is the spec's rank-respect test made countable: a lower-ranked group sits in a better row, and its block plus the empty seats touching it could have held this offer. A single that took a 1-seat hole has not passed a pair. With the shipped greedy policy these arise only from the strict-then-waterfall pass order (an `any` fan seated in a lower tier before a this-or-worse fan cascades down); fill-first policies will produce them by design.");
  L.push("");

  // Artist view
  L.push("### What the artist sees — per section totals and averages" + (multi ? " (first seed)" : ""));
  L.push("");
  L.push("| Section | Sold / on sale | Gross | Avg price |");
  L.push("|---|---:|---:|---:|");
  for (const [section, s] of Object.entries(m.bySection)) {
    L.push(`| ${section} | ${n(s.placedSeats)} / ${n(s.availableSeats)} | ${usd(s.grossCents)} | ${usd(s.avgPriceCents)} |`);
  }
  L.push("");

  // Invariants
  const runsForPolicy = out.runs.filter((r) => r.policy === agg.policy);
  const violations = runsForPolicy.flatMap((r) => r.violations.map((v) => ({ seed: r.seed, ...v })));
  L.push("### Invariants");
  L.push("");
  if (violations.length === 0) {
    L.push(`All clear across ${runsForPolicy.length} run(s): contiguity, total accounting, no double booking, no free upgrades. Result hash${multi ? "es" : ""}: ${runsForPolicy.map((r) => `\`${r.resultHash.slice(0, 12)}\``).slice(0, 5).join(", ")}${runsForPolicy.length > 5 ? ", …" : ""}`);
  } else {
    L.push(`**${violations.length} VIOLATION(S)** — this is a bug in the policy, not a result:`);
    L.push("");
    for (const v of violations.slice(0, 50)) L.push(`- seed ${v.seed} · ${v.invariant}: ${v.message}`);
  }
  L.push("");
  L.push(`Runtime ${multi ? `${(runsForPolicy.reduce((s, r) => s + r.metrics.runtimeMs, 0) / runsForPolicy.length).toFixed(1)} ms avg` : `${m.runtimeMs.toFixed(1)} ms`} per allocation.`);
  L.push("");
  return L;
}

function heldBreakdown(bySource: Record<string, number>): string {
  const parts = Object.entries(bySource)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${v}`);
  return parts.length ? `: ${parts.join(", ")}` : "";
}

// Short terminal summary: one block per policy.
export function renderConsoleSummary(out: RunOutput): string {
  const L: string[] = [];
  const multi = out.seeds.length > 1;
  L.push(`FILL REPORT — ${out.scenarioName} · ${out.venueDisplayName}${multi ? ` · ${out.seeds.length} seeds` : ""}`);
  for (const agg of out.aggregates) {
    const first = out.runs.find((r) => r.policy === agg.policy)!;
    const cap = first.metrics.capacity;
    const s = agg.scalars;
    const row = (label: string, key: string, fmt: (v: number) => string): string => {
      const p = s[key]!;
      const cols = multi ? `${fmt(p.p50).padStart(12)}${fmt(p.p5).padStart(12)}${fmt(p.p95).padStart(12)}` : fmt(p.p50).padStart(12);
      return `  ${label.padEnd(34)}${cols}`;
    };
    L.push("");
    L.push(`  policy: ${agg.policy}${multi ? "                                p50         p5        p95" : ""}`);
    L.push(row("Seats filled", "fill.placedSeats", n) + `   of ${n(cap.availableSeats)}`);
    L.push(row("Fill rate", "fill.fillRate", (v) => pct(v)));
    L.push(row("Empty seats", "fill.emptySeats", n));
    for (let size = 1; size <= 4; size++) {
      if (s[`fill.holesBySize.${size}`]!.p95 > 0) L.push(row(`  in ${size}-seat holes`, `fill.holesBySize.${size}`, n));
    }
    L.push(row("  in odd-capacity rows", "fill.emptySeatsOddRows", n));
    L.push(row("Gross placed", "revenue.grossPlacedCents", usd));
    L.push(row("Left on table (unplaced $)", "revenue.unplacedValueCents", usd));
    L.push(row("Offers placed", "offers.placed", n) + `   of ${n(first.metrics.offers.total)}`);
    L.push(row("Passed over (rank-respect)", "rankRespect.passedOver", n));
    L.push("");
    L.push(`  By group size${multi ? " (p50)" : ""}:   size   offers   placed   placed%   median row rank`);
    const m = first.metrics;
    for (const size of Object.keys(agg.byGroupSize).map(Number).sort((a, b) => a - b)) {
      const g = m.byGroupSize[size];
      const a = agg.byGroupSize[size]!;
      const offers = multi ? a.offers.p50 : (g?.offers ?? 0);
      const placed = multi ? a.placed.p50 : (g?.placed ?? 0);
      const rate = multi ? a.placedRate.p50 : (g?.placedRate ?? 0);
      const med = multi ? a.medianRowRank.p50 : g?.medianRowRank;
      L.push(`                    ${String(size).padStart(4)}   ${n(offers).padStart(6)}   ${n(placed).padStart(6)}   ${pct(rate, 0).padStart(7)}   ${med === null || med === undefined || placed === 0 ? "—" : n(med)}`);
    }
    if (agg.violations > 0) L.push(`  !! ${agg.violations} INVARIANT VIOLATION(S) — see report.md`);
  }
  return L.join("\n");
}

// --- offers.csv ------------------------------------------------------------

export function renderOffersCsv(run: PolicyRun, venue: SimVenue): string {
  const offers = run.offers ?? [];
  const result = run.result;
  if (!result) return "";
  const rows = activeRows(venue);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const tierIdx = new Map(tierOrder(venue).map((t, i) => [t, i]));
  const ranked = [...offers].sort((a, b) => b.rankKey - a.rankKey || a.submittedAt.getTime() - b.submittedAt.getTime() || a.id.localeCompare(b.id));
  const seatsByOffer = new Map<string, { rowId: string; seats: string[] }>();
  for (const a of result.assignments) {
    const e = seatsByOffer.get(a.offerId) ?? { rowId: a.venueRowId, seats: [] };
    e.seats.push(a.seatNumber);
    seatsByOffer.set(a.offerId, e);
  }
  const unplacedReason = new Map(result.unplaced.map((u) => [u.offerId, u.reason]));
  const passedOver = new Set(run.metrics.rankRespect.passedOverOfferIds);
  const header = [
    "offer_rank", "offer_id", "group_size", "price_per_ticket", "offer_value", "preference", "preferred_tier",
    "placed", "row_rank", "area", "section", "row", "seats", "placed_tier", "outcome", "passed_over", "unplaced_reason",
  ];
  const lines = [header.join(",")];
  ranked.forEach((o, i) => {
    const p = seatsByOffer.get(o.id);
    const row = p ? rowById.get(p.rowId) : undefined;
    const preferredTier = o.tierPreference.type === "any" ? "" : o.tierPreference.tier;
    let outcome = "unplaced";
    if (row) {
      if (o.tierPreference.type === "any") outcome = "placed";
      else {
        const want = tierIdx.get(o.tierPreference.tier);
        const got = row.tier === undefined ? undefined : tierIdx.get(row.tier);
        outcome = want === undefined || got === undefined || want === got ? "preferred tier" : got > want ? "waterfalled down" : "moved up";
      }
    }
    lines.push(
      [
        i + 1, csv(o.id), o.groupSize, (o.pricePerTicketCents / 100).toFixed(2), ((o.pricePerTicketCents * o.groupSize) / 100).toFixed(2),
        csv(formatTierPref(o.tierPreference)), csv(preferredTier),
        row ? "yes" : "no", row?.rowRank ?? "", csv(row ? String(row.area) : ""), csv(row?.section ?? ""), csv(row?.rowName ?? ""),
        csv(p ? p.seats.join(" ") : ""), csv(row?.tier ?? ""), outcome, passedOver.has(o.id) ? "yes" : "no", unplacedReason.get(o.id) ?? "",
      ].join(","),
    );
  });
  return lines.join("\n") + "\n";
}

function csv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// --- seatmap.txt -----------------------------------------------------------

export function renderSeatMap(run: PolicyRun, venue: SimVenue): string {
  const result = run.result;
  if (!result) return "";
  const rows = activeRows(venue);
  const occupant = new Map<string, string>(); // rowId#pos → offerId
  for (const a of result.assignments) occupant.set(`${a.venueRowId}#${a.positionIndex}`, a.offerId);
  const L: string[] = [`Seat map — ${venue.displayName} — policy ${run.policy} — seed ${run.seed}`, ""];
  L.push("Legend: [id×n] a seated group · . empty seat · # held seat");
  L.push("");
  for (const r of rows) {
    const held = new Set(r.holds);
    const parts: string[] = [];
    let i = 0;
    while (i < r.seatNumbers.length) {
      const seat = r.seatNumbers[i]!;
      if (held.has(seat)) {
        parts.push("#");
        i++;
        continue;
      }
      const occ = occupant.get(`${r.id}#${i}`);
      if (occ === undefined) {
        parts.push(".");
        i++;
        continue;
      }
      let count = 0;
      while (i < r.seatNumbers.length && occupant.get(`${r.id}#${i}`) === occ) {
        count++;
        i++;
      }
      parts.push(`[${occ}×${count}]`);
    }
    const placed = [...occupant.keys()].filter((k) => k.startsWith(`${r.id}#`)).length;
    const avail = r.capacity - r.holds.length;
    L.push(`${String(r.rowRank).padStart(4)}  ${String(r.area).padEnd(14)} ${r.section.padEnd(12)} ${r.rowName.padEnd(4)} ${(r.tier ?? "").padEnd(10)} ${String(placed).padStart(3)}/${String(avail).padEnd(3)} ${parts.join("")}`);
  }
  return L.join("\n") + "\n";
}

export type { FillMetrics, Percentiles };
