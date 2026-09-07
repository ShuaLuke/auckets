// Renderers for a run: the fill report (markdown, also printed to the
// terminal), the per-offer CSV that opens in Excel, and a text seat map.
// Dollars appear only here — everything upstream is integer cents.

import { compareRuns, renderComparison } from "./compare";
import { n, pct, usd } from "./format";
import { formatTierPref } from "./pool";
import type { FillMetrics, Percentiles, PolicyAggregate, PolicyRun, RunOutput, SimVenue } from "./types";
import { activeRows, tierOrder } from "./venue";

export { usd, pct } from "./format";

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

  if (out.scenario.autoBidRaiseRule || out.runs.some((r) => r.metrics.autoBid.bidders > 0)) {
    const rule = out.scenario.autoBidRaiseRule ?? { kind: "fixed", cents: 500 };
    lines.push(`Auto-bid raise rule: ${rule.kind === "fixed" ? `fixed ${usd(rule.cents)} per step (shipped, ADR-0018)` : `${rule.pct}% of the current price per step, rounded up to whole dollars (Cope's preference)`}.`);
    lines.push("");
  }

  for (const agg of out.aggregates) {
    const first = out.runs.find((r) => r.policy === agg.policy)!;
    lines.push(...renderPolicySection(out, agg, first, multi));
  }
  if (out.policies.length > 1) {
    lines.push("---");
    lines.push("");
    lines.push(renderComparison(compareRuns([{ runName: out.scenarioName, output: out }])).replace(/^# Run comparison/, "## Policies compared"));
    lines.push("");
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
  L.push(`> ${first.caveat}`);
  L.push("");
  if (multi) {
    const fr = sc["fill.fillRate"]!;
    const gr = sc["revenue.grossPlacedCents"]!;
    L.push(`Across ${agg.seeds} seeds: fill ${pct(fr.mean)} ± ${pct(fr.stdev)} (min ${pct(fr.min)}, max ${pct(fr.max)}) · gross ${usd(gr.mean)} ± ${usd(gr.stdev)}.`);
    L.push("");
  }
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
  if (agg.policy !== "greedy") {
    L.push(`| Clean-fit deferrals | ${cell("policy.cleanFitDeferrals", n)} |`);
    L.push(`| Seats a clean-fit deferral kept from stranding | ${cell("policy.seatsSavedByCleanFit", n)} |`);
    L.push(`| Parity tiebreaks taken | ${cell("policy.parityTiebreaks", n)} |`);
    L.push(`| Reserved singles placed / unplaced | ${cell("policy.reservedSinglesPlaced", n)} |`);
    L.push(`| Reserved singles unplaced | ${cell("policy.reservedSinglesUnplaced", n)} |`);
  }
  L.push("");
  if (first.metrics.autoBid.bidders > 0) {
    L.push("### Auto-bid");
    L.push("");
    L.push(hdr);
    L.push(sep);
    L.push(`| Auto-bidders in the pool | ${cell("autoBid.bidders", n)} |`);
    L.push(`| Raised at least once | ${cell("autoBid.raised", n)} |`);
    L.push(`| Total added to prices | ${cell("autoBid.totalRaiseCents", usd)} |`);
    L.push(`| Largest single raise | ${cell("autoBid.maxRaiseCents", usd)} |`);
    L.push(`| Avg steps per raised bidder | ${cell("autoBid.avgStepsPerRaised", (v) => v.toFixed(1))} |`);
    L.push(`| Held their section after raising | ${cell("autoBid.heldSectionAfterRaise", n)} |`);
    L.push(`| Hit their cap and still displaced | ${cell("autoBid.cappedOut", n)} |`);
    L.push(`| Resolution rounds | ${cell("autoBid.rounds", n)} |`);
    if (first.metrics.autoBid.privateOffers > 0) {
      L.push(`| Private offers (hidden threshold) | ${cell("autoBid.privateOffers", n)} |`);
      L.push(`| &nbsp;&nbsp;converted above their visible price | ${cell("autoBid.privateConverted", n)} |`);
      L.push(`| &nbsp;&nbsp;added to prices by conversion | ${cell("autoBid.privateAddedCents", usd)} |`);
    }
    L.push("");
    if (first.metrics.autoBid.privateOffers > 0) {
      L.push("Private offers are modelled as an auto-bid whose cap is the hidden threshold (ADR-0017 says the offer \"auto-converts\" when a competing offer exceeds it). Confirm the reading with Cope before relying on the conversion numbers.");
      L.push("");
    }
  }
  if (first.temporal) L.push(...renderTimeline(out, agg, first, multi, hdr, sep, cell));
  if (first.metrics.bleacher) {
    const b = first.metrics.bleacher;
    L.push("### Bleacher carve-out (NEW-8 — not confirmed by Cope)");
    L.push("");
    L.push(`${n(b.seats)} seats in the ${b.rows} worst row(s) held out of the GAE and priced at ${usd(b.priceCents)} flat. If every seat sells: ${usd(b.grossIfSoldOutCents)}. Fans the GAE did not seat asked for ${n(b.overflowTickets)} tickets, so the estimate is ${n(b.estSoldSeats)} sold → ${usd(b.estGrossCents)}; GAE gross + Bleacher estimate = ${usd(b.combinedGrossCents)}. Compare against a run without the carve-out to see what the same rows earn inside the engine.`);
    L.push("");
    if (multi) {
      L.push(hdr);
      L.push(sep);
      L.push(`| Bleacher est. sold seats | ${cell("bleacher.estSoldSeats", n)} |`);
      L.push(`| Bleacher est. gross | ${cell("bleacher.estGrossCents", usd)} |`);
      L.push(`| Combined gross | ${cell("bleacher.combinedGrossCents", usd)} |`);
      L.push("");
    }
  }
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

function renderTimeline(
  out: RunOutput,
  agg: PolicyAggregate,
  first: PolicyRun,
  multi: boolean,
  hdr: string,
  sep: string,
  cell: (key: string, fmt: (v: number) => string) => string,
): string[] {
  const L: string[] = [];
  const t = first.temporal!;
  const tl = out.scenario.timeline!;
  L.push("### Timeline");
  L.push("");
  L.push(`Window ${tl.windowDays} days · arrivals ${tl.arrival ?? "uniform"} · preview every ${tl.previewEveryHours ?? 12}h (${t.previews} previews) · binding at close${tl.autoBidAtPreviews === false ? " · auto-bid resolved at binding only" : ""}. These answer questions that are still open (Q3, Q4, Q5, Q12, NEW-9); the model is described in sim/README.md.`);
  L.push("");
  L.push(`#### Day by day${multi ? " (first seed)" : ""}`);
  L.push("");
  L.push("| Day | Offers arrived | Active | Fill at end of day | Told out that day | Moved down | Revisions | Withdrawals | Booked (cumulative) | Seated value |");
  L.push("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  const byDay = new Map<number, typeof t.ticks>();
  for (const tick of t.ticks) {
    const day = Math.min(tl.windowDays - 1, Math.floor((tick.hour - 1e-9) / 24));
    const list = byDay.get(day) ?? [];
    list.push(tick);
    byDay.set(day, list);
  }
  for (const [day, ticks] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const last = ticks[ticks.length - 1]!;
    const sum = (k: "displacedOut" | "displacedDown" | "revisionsApplied" | "withdrawalsApplied"): number => ticks.reduce((s, x) => s + x[k], 0);
    L.push(`| ${day + 1} | ${n(last.arrivedOffers)} | ${n(last.activeOffers)} | ${pct(last.fillRate)} | ${n(sum("displacedOut"))} | ${n(sum("displacedDown"))} | ${n(sum("revisionsApplied"))} | ${n(sum("withdrawalsApplied"))} | ${usd(last.bookedCents)} | ${usd(last.seatedValueCents)} |`);
  }
  L.push("");
  L.push("#### Displacement (Q3 — what fans were told, then untold)");
  L.push("");
  L.push(hdr);
  L.push(sep);
  L.push(`| Fans seated at a preview, then unseated at a later one | ${cell("temporal.displacement.fansToldInThenOut", n)} |`);
  L.push(`| Fans ever displaced (out or to a worse tier) | ${cell("temporal.displacement.fansEverDisplaced", n)} |`);
  L.push(`| "You're out" events | ${cell("temporal.displacement.outEvents", n)} |`);
  L.push(`| "You moved down a tier" events | ${cell("temporal.displacement.downEvents", n)} |`);
  L.push(`| Seated at the first preview, not seated at binding | ${cell("temporal.displacement.seatedAtFirstPreviewThenUnseatedAtBinding", n)} |`);
  if (t.rollingConfirmed) {
    L.push(`| Would have been "Admission Confirmed" (seated ${t.rollingConfirmed.afterHours}h straight) | ${cell("temporal.rollingConfirmed.confirmedFans", n)} |`);
    L.push(`| &nbsp;&nbsp;…and NOT seated at binding (broken confirmations) | ${cell("temporal.rollingConfirmed.brokenConfirmations", n)} |`);
    L.push(`| &nbsp;&nbsp;value of broken confirmations | ${cell("temporal.rollingConfirmed.brokenValueCents", usd)} |`);
    L.push(`| &nbsp;&nbsp;avg hours from arrival to confirmation | ${cell("temporal.rollingConfirmed.avgHoursToConfirm", (v) => v.toFixed(1))} |`);
  }
  L.push("");
  if (tl.revisions || tl.withdrawals || t.autoBidDuringWindow.fansRaised > 0) {
    L.push("#### Revisions, auto-bid and withdrawals during the window (Q12, ADR-0018, NEW-9)");
    L.push("");
    L.push(hdr);
    L.push(sep);
    if (t.autoBidDuringWindow.fansRaised > 0 || first.metrics.autoBid.bidders > 0) {
      L.push(`| Auto-bidders raised at previews | ${cell("temporal.autoBidDuringWindow.fansRaised", n)} |`);
      L.push(`| &nbsp;&nbsp;steps taken | ${cell("temporal.autoBidDuringWindow.raises", n)} |`);
      L.push(`| &nbsp;&nbsp;added to the pool by auto-bid | ${cell("temporal.autoBidDuringWindow.addedCents", usd)} |`);
    }
    if (tl.revisions) {
      L.push(`| Fans who revised upward after being displaced | ${cell("temporal.revisions.fansRevised", n)} |`);
      L.push(`| Revisions applied | ${cell("temporal.revisions.revisionsApplied", n)} |`);
      L.push(`| Added to the pool by revisions | ${cell("temporal.revisions.addedCents", usd)} |`);
      L.push(`| Revisers seated at binding | ${cell("temporal.revisions.revisedAndSeatedAtBinding", n)} |`);
    }
    if (tl.withdrawals) {
      L.push(`| Withdrawals before binding | ${cell("temporal.withdrawals.withdrawn", n)} |`);
      L.push(`| &nbsp;&nbsp;value withdrawn | ${cell("temporal.withdrawals.withdrawnValueCents", usd)} |`);
      L.push(`| &nbsp;&nbsp;were seated when they left | ${cell("temporal.withdrawals.wereSeatedWhenTheyLeft", n)} |`);
    }
    L.push("");
  }
  if (t.returns) {
    L.push(`#### After binding (Q4) — returns ${tl.returns ? `${tl.returns.sharePct}%` : "0%"}, releases ${tl.releases?.seats ?? 0} seats, refill \`${t.returns.refill}\``);
    L.push("");
    L.push(hdr);
    L.push(sep);
    L.push(`| Offers that returned their seats | ${cell("temporal.returns.returnedOffers", n)} |`);
    L.push(`| Seats returned | ${cell("temporal.returns.returnedSeats", n)} |`);
    L.push(`| Value returned | ${cell("temporal.returns.returnedValueCents", usd)} |`);
    L.push(`| Seats released from holds | ${cell("temporal.returns.releasedSeats", n)} |`);
    L.push(`| Seats refilled from the unplaced pool | ${cell("temporal.returns.refilledSeats", n)} |`);
    L.push(`| Value recovered by refilling | ${cell("temporal.returns.refilledValueCents", usd)} |`);
    L.push(`| Fill after returns | ${cell("temporal.returns.fillAfterReturns", (v) => pct(v))} |`);
    L.push(`| Gross after returns | ${cell("temporal.returns.grossAfterReturnsCents", usd)} |`);
    L.push("");
    L.push(t.returns.refill === "release" ? "Refill \"release\" is today's rule (May Q13/Q14: outbid offers are released immediately, no waitlist): returned seats stay empty. Run the same scenario with `keep-pool-live` to see what a live pool recovers." : "Refill \"keep-pool-live\" keeps unplaced offers alive after binding and re-seats them in rank order into returned and released seats. Today's rule (May Q13/Q14) is \"release\"; this is Cope's playbook reading.");
    L.push("");
  }
  L.push("#### Register-first view (Q5 — booked vs seated)");
  L.push("");
  L.push(hdr);
  L.push(sep);
  L.push(`| Booked by close (every active offer's price × size) | ${cell("temporal.registerFirst.bookedAtCloseCents", usd)} |`);
  L.push(`| Seated at binding | ${cell("temporal.registerFirst.seatedAtBindingCents", usd)} |`);
  L.push(`| Accepted but unseated — offers | ${cell("temporal.registerFirst.acceptedUnseatedOffers", n)} |`);
  L.push(`| Accepted but unseated — value | ${cell("temporal.registerFirst.acceptedUnseatedValueCents", usd)} |`);
  L.push(`| &nbsp;&nbsp;as a share of booked | ${cell("temporal.registerFirst.acceptedUnseatedShareOfBooked", (v) => pct(v))} |`);
  L.push("");
  L.push(`Booked by day${multi ? " (first seed)" : ""}: ${t.registerFirst.bookedByDayCents.map((c, i) => `d${i + 1} ${usd(c)}`).join(" · ")}. "Ring the register" means taking the booked number during the window; the accepted-but-unseated line is what would have to be refunded or waitlisted at binding.`);
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
    if (agg.policy !== "greedy") L.push(row("Clean-fit deferrals / parity picks", "policy.cleanFitDeferrals", n) + `   parity ${n(s["policy.parityTiebreaks"]!.p50)} · reserved ${n(s["policy.reservedSinglesPlaced"]!.p50)}`);
    if (first.metrics.autoBid.bidders > 0) L.push(row("Auto-bid raised / added", "autoBid.raised", n) + `   ${usd(s["autoBid.totalRaiseCents"]!.p50)} · held section ${n(s["autoBid.heldSectionAfterRaise"]!.p50)}${first.metrics.autoBid.privateOffers > 0 ? ` · private converted ${n(s["autoBid.privateConverted"]!.p50)}` : ""}`);
    if (first.temporal) {
      L.push(row("Told in then out (fans)", "temporal.displacement.fansToldInThenOut", n) + `   ${n(s["temporal.displacement.outEvents"]!.p50)} out events over ${first.temporal.previews} previews`);
      if (first.temporal.autoBidDuringWindow.fansRaised > 0) L.push(row("Auto-bid raised at previews", "temporal.autoBidDuringWindow.fansRaised", n) + `   ${usd(s["temporal.autoBidDuringWindow.addedCents"]!.p50)} added`);
      if (first.temporal.rollingConfirmed) L.push(row("Rolling confirmed / broken", "temporal.rollingConfirmed.confirmedFans", n) + `   broken ${n(s["temporal.rollingConfirmed.brokenConfirmations"]!.p50)} (${usd(s["temporal.rollingConfirmed.brokenValueCents"]!.p50)})`);
      if (first.temporal.returns) L.push(row("Returned / refilled seats", "temporal.returns.returnedSeats", n) + `   refilled ${n(s["temporal.returns.refilledSeats"]!.p50)} · fill after ${pct(s["temporal.returns.fillAfterReturns"]!.p50)}`);
      L.push(row("Booked vs seated $", "temporal.registerFirst.bookedAtCloseCents", usd) + `   seated ${usd(s["temporal.registerFirst.seatedAtBindingCents"]!.p50)} · unseated ${pct(s["temporal.registerFirst.acceptedUnseatedShareOfBooked"]!.p50)} of booked`);
    }
    if (first.metrics.bleacher) L.push(row("Bleacher est. sold / combined $", "bleacher.estSoldSeats", n) + `   ${usd(s["bleacher.combinedGrossCents"]!.p50)}  (${n(first.metrics.bleacher.seats)} seats @ ${usd(first.metrics.bleacher.priceCents)}, unconfirmed)`);
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
