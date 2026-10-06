// The old way next to ours, on the same crowd: the numbers a venue asks for
// first, and the sentences that go with them. Pure — built from two
// PolicyRuns of the same scenario (one "first-come", one engine policy).

import { usd } from "./format";
import type { PolicyRun } from "./types";

// What a venue sees a policy called. "greedy" is our word for the shipped
// rank-order method and means nothing to anyone else; the key stays the
// key everywhere else (CLI, reports, tests).
export const POLICY_DISPLAY: Record<string, string> = {
  "first-come": "first-come at face price",
  greedy: "rank order",
  "clean-fit": "rank order with clean fit",
  "parity-tiebreak": "rank order with parity tiebreak",
  "singles-reserve": "rank order with a singles reserve",
  "clean-fit+singles-reserve": "clean fit with a singles reserve",
  lookahead: "lookahead",
  "protect-units": "rank order, tables protected",
};
export const policyDisplayName = (key: string): string => POLICY_DISPLAY[key] ?? POLICY_DISPLAY[key.split(":")[0]!] ?? key;

export type RoiLine = {
  key: string;
  label: string;
  old: number;
  ours: number;
  diff: number; // ours − old
  kind: "n" | "usd" | "pct";
  betterWhen: "higher" | "lower";
};

export type RoiSummary = {
  oldPolicy: string;
  ourPolicy: string;
  lines: RoiLine[];
  byTier: { tier: string; oldGrossCents: number; ourGrossCents: number; oldFilled: number; ourFilled: number; onSale: number }[];
  // What the old way left with the fans (or the resellers) — the money
  // Auckets collects because fans pay what they offered.
  offeredAboveFaceCents: number;
  headline: string;
};

const fmt = (v: number, kind: RoiLine["kind"]): string => (kind === "usd" ? usd(v) : kind === "pct" ? `${v.toFixed(1)}%` : v.toLocaleString("en-US"));

export function formatRoi(v: number, kind: RoiLine["kind"], signed = false): string {
  const s = fmt(Math.abs(v), kind);
  return signed ? (v > 0 ? `+${s}` : v < 0 ? `−${s}` : s) : fmt(v, kind);
}

export function compareToBaseline(old: PolicyRun, ours: PolicyRun): RoiSummary {
  const fc = old.metrics.firstCome;
  if (!fc) throw new Error(`compareToBaseline: "${old.policy}" is not a first-come run`);
  const line = (key: string, label: string, o: number, u: number, kind: RoiLine["kind"], betterWhen: RoiLine["betterWhen"]): RoiLine => ({ key, label, old: o, ours: u, diff: u - o, kind, betterWhen });
  const om = old.metrics;
  const um = ours.metrics;
  const lines: RoiLine[] = [
    line("gross", "Gross", om.revenue.grossPlacedCents, um.revenue.grossPlacedCents, "usd", "higher"),
    line("seats", "Seats filled", om.fill.placedSeats, um.fill.placedSeats, "n", "higher"),
    line("fill", "Fill rate", 100 * om.fill.fillRate, 100 * um.fill.fillRate, "pct", "higher"),
    line("avg", "Average price paid", om.revenue.avgPlacedPriceCents, um.revenue.avgPlacedPriceCents, "usd", "higher"),
    line("fans", "Groups seated", om.offers.placed, um.offers.placed, "n", "higher"),
    line("unseated", "Groups turned away", om.offers.unplaced, um.offers.unplaced, "n", "lower"),
    line("inversions", "Fans seated behind a lower offer, in seats they'd have fit (pairs)", om.rankRespect.inversions, um.rankRespect.inversions, "n", "lower"),
  ];
  const tiers = [...new Set([...Object.keys(om.byTier), ...Object.keys(um.byTier)])];
  const byTier = tiers.map((tier) => ({
    tier,
    oldGrossCents: om.byTier[tier]?.grossCents ?? 0,
    ourGrossCents: um.byTier[tier]?.grossCents ?? 0,
    oldFilled: om.byTier[tier]?.placedSeats ?? 0,
    ourFilled: um.byTier[tier]?.placedSeats ?? 0,
    onSale: um.byTier[tier]?.availableSeats ?? om.byTier[tier]?.availableSeats ?? 0,
  }));
  const grossDiff = um.revenue.grossPlacedCents - om.revenue.grossPlacedCents;
  const seatsDiff = um.fill.placedSeats - om.fill.placedSeats;
  const pctMore = om.revenue.grossPlacedCents === 0 ? null : (100 * grossDiff) / om.revenue.grossPlacedCents;
  const headline =
    `On the same crowd, the old way takes ${usd(om.revenue.grossPlacedCents)} and fills ${om.fill.placedSeats.toLocaleString("en-US")} seats; ` +
    `Auckets (${policyDisplayName(ours.policy)}) takes ${usd(um.revenue.grossPlacedCents)} and fills ${um.fill.placedSeats.toLocaleString("en-US")} — ` +
    `${formatRoi(grossDiff, "usd", true)}${pctMore !== null ? ` (${formatRoi(pctMore, "pct", true)})` : ""} and ${formatRoi(seatsDiff, "n", true)} seats. ` +
    `Fans offered ${usd(fc.offeredAboveFaceCents)} above face that the old way never collected.`;
  return { oldPolicy: old.policy, ourPolicy: ours.policy, lines, byTier, offeredAboveFaceCents: fc.offeredAboveFaceCents, headline };
}

export function renderRoi(r: RoiSummary): string {
  const L: string[] = [];
  L.push(`## The old way vs Auckets (${policyDisplayName(r.ourPolicy)})`);
  L.push("");
  L.push(r.headline);
  L.push("");
  L.push(`| | Old way (${r.oldPolicy}) | Auckets (${policyDisplayName(r.ourPolicy)}) | Difference |`);
  L.push("|---|---:|---:|---:|");
  for (const l of r.lines) L.push(`| ${l.label} | ${fmt(l.old, l.kind)} | ${fmt(l.ours, l.kind)} | ${formatRoi(l.diff, l.kind, true)} |`);
  L.push("");
  L.push("| Tier | Old way gross | Auckets gross | Old way filled | Auckets filled | On sale |");
  L.push("|---|---:|---:|---:|---:|---:|");
  for (const t of r.byTier) L.push(`| ${t.tier} | ${usd(t.oldGrossCents)} | ${usd(t.ourGrossCents)} | ${t.oldFilled.toLocaleString("en-US")} | ${t.ourFilled.toLocaleString("en-US")} | ${t.onSale.toLocaleString("en-US")} |`);
  L.push("");
  L.push("Same venue, same fans, same offers. The old way sells each tier at its face price to whoever arrives first; Auckets seats the same fans by what they offered. The only thing that changed is the allocation — and the demand is the one assumption to check: these offers are what this crowd said it would pay.");
  return L.join("\n");
}
