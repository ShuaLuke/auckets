import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { compareToBaseline } from "@/lib/sim/roi";
import { runScenario } from "@/lib/sim/run";
import { offer, row, venue } from "@/lib/sim/test-helpers";

import { SimulationRoi } from "./SimulationRoi";

describe("SimulationRoi", () => {
  it("puts the old way beside ours with signed differences and the per-tier split", () => {
    const v = venue([row({ id: "a", rank: 1, cap: 4, tier: "premium" }), row({ id: "b", rank: 2, cap: 4, tier: "mid" }), row({ id: "c", rank: 3, cap: 3, tier: "rear" })]);
    const pool = [offer("q", 2, 15000, { type: "any" }, 1), offer("p", 2, 7000, { type: "any" }, 0), offer("r", 2, 9500, { type: "any" }, 2), offer("cheap", 1, 3000, { type: "any" }, 3)];
    const out = runScenario({ scenario: { name: "roi", venue: "test-venue", pool: { file: "inline" }, policies: ["first-come", "greedy"], firstComeArrival: "as-submitted" }, venue: v, poolOffers: pool, now: "2026-09-28T00:00:00Z" });
    const html = renderToStaticMarkup(<SimulationRoi roi={compareToBaseline(out.runs[0]!, out.runs[1]!)} />);
    expect(html).toContain("the old way takes $440.00 and fills 6 seats");
    expect(html).toContain("+$220.00");
    expect(html).toContain("−1"); // groups turned away, fewer under ours
    expect(html).toContain("Auckets · rank order");
    expect(html).toContain("premium");
    expect(html).toContain("2 → 4 of 4");
    expect(html).toContain("set the face prices to what the venue would really charge");
  });
});
