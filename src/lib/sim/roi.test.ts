/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { renderFillReport } from "./report";
import { compareToBaseline, formatRoi, renderRoi } from "./roi";
import { runScenario } from "./run";
import { offer, row, venue } from "./test-helpers";

const v = venue([row({ id: "a", rank: 1, cap: 4, tier: "premium" }), row({ id: "b", rank: 2, cap: 4, tier: "mid" }), row({ id: "c", rank: 3, cap: 3, tier: "rear" })]);
const pool = [offer("q", 2, 15000, { type: "any" }, 1), offer("p", 2, 7000, { type: "any" }, 0), offer("r", 2, 9500, { type: "any" }, 2), offer("cheap", 1, 3000, { type: "any" }, 3)];
const out = runScenario({ scenario: { name: "roi", venue: "test-venue", pool: { file: "inline" }, policies: ["first-come", "greedy"], firstComeArrival: "as-submitted" }, venue: v, poolOffers: pool, now: "2026-09-28T00:00:00Z" });

describe("compareToBaseline", () => {
  it("puts the old way beside ours on the same crowd, with the difference signed", () => {
    const r = compareToBaseline(out.runs[0]!, out.runs[1]!);
    const by = Object.fromEntries(r.lines.map((l) => [l.key, l]));
    expect(by.gross).toMatchObject({ old: 44000, ours: 66000, diff: 22000, kind: "usd" });
    expect(by.seats).toMatchObject({ old: 6, ours: 7, diff: 1 });
    expect(by.unseated).toMatchObject({ old: 1, ours: 0, diff: -1, betterWhen: "lower" });
    expect(r.offeredAboveFaceCents).toBe(19000);
    expect(r.headline).toContain("+$220.00 (+50.0%) and +1 seats");
    expect(r.headline).toContain("Fans offered $190.00 above face");
    expect(r.byTier.map((t) => t.tier)).toEqual(["premium", "mid", "rear"]);
    expect(() => compareToBaseline(out.runs[1]!, out.runs[0]!)).toThrow(/not a first-come run/);
  });

  it("renders as markdown, and the fill report carries it when both ran", () => {
    const md = renderRoi(compareToBaseline(out.runs[0]!, out.runs[1]!));
    expect(md).toContain("## The old way vs Auckets (rank order)");
    expect(md).toContain("| Gross | $440.00 | $660.00 | +$220.00 |");
    expect(renderFillReport(out)).toContain("## The old way vs Auckets (rank order)");
    expect(formatRoi(-5, "n", true)).toBe("−5");
    expect(formatRoi(0, "usd", true)).toBe("$0.00");
  });
});
