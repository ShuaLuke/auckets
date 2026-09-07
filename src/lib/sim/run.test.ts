/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { offersFromCsv } from "./pool";
import { renderConsoleSummary, renderFillReport, renderOffersCsv, renderSeatMap } from "./report";
import { percentiles, runScenario } from "./run";
import { row, venue } from "./test-helpers";
import type { DemandModel, Scenario } from "./types";

const v = venue([
  row({ id: "a", rank: 1, cap: 8, tier: "premium" }),
  row({ id: "b", rank: 2, cap: 7, tier: "premium" }),
  row({ id: "c", rank: 3, cap: 6, tier: "mid", area: "front_balcony" }),
  row({ id: "d", rank: 4, cap: 5, tier: "rear", area: "upper_balcony" }),
]);

const generated: Scenario = {
  name: "gen",
  venue: "test-venue",
  show: { holds: [{ source: "artist", tier: "premium", seats: 2 }] },
  pool: {
    generate: { seed: 11, oversubscription: 1.4, groupSizeMix: { 1: 20, 2: 50, 3: 10, 4: 20 }, priceModel: { kind: "ladder", ladderCents: 500 } },
  },
  seeds: 5,
};

describe("runScenario", () => {
  it("is deterministic: same inputs → same hashes, and seeds advance from the base seed", () => {
    const a = runScenario({ scenario: generated, venue: v, now: "2026-09-07T00:00:00Z" });
    const b = runScenario({ scenario: generated, venue: v, now: "2026-09-07T00:00:00Z" });
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.runs.map((r) => r.resultHash)).toEqual(b.runs.map((r) => r.resultHash));
    expect(a.seeds).toEqual([11, 12, 13, 14, 15]);
    expect(a.runs).toHaveLength(5);
    expect(a.runs.filter((r) => r.result !== undefined)).toHaveLength(1);
    expect(a.runs.every((r) => r.violations.length === 0)).toBe(true);
    expect(a.runs[0]!.metrics.capacity.heldSeats).toBe(2);
    expect(a.runs[0]!.metrics.capacity.heldBySource).toMatchObject({ artist: 2, venue: 0 });
  });

  it("aggregates percentiles per policy, group size, and tier", () => {
    const out = runScenario({ scenario: generated, venue: v });
    const agg = out.aggregates[0]!;
    expect(agg.seeds).toBe(5);
    expect(agg.scalars["fill.fillRate"]!.p50).toBeGreaterThan(0.5);
    expect(agg.scalars["fill.fillRate"]!.p5).toBeLessThanOrEqual(agg.scalars["fill.fillRate"]!.p95);
    expect(agg.byGroupSize[2]!.placedRate.p50).toBeGreaterThan(0);
    expect(Object.keys(agg.byTier)).toEqual(["premium", "mid", "rear"]);
  });

  it("runs a file pool and refuses seeds > 1 for it", () => {
    const poolOffers = offersFromCsv("size,price,tier\n4,120,premium\n2,110,premium-\n3,90,mid\n1,50,any\n");
    const scenario: Scenario = { name: "file", venue: "test-venue", pool: { file: "x.csv" } };
    const out = runScenario({ scenario, venue: v, poolOffers });
    expect(out.runs[0]!.metrics.offers.placed).toBe(4);
    expect(() => runScenario({ scenario: { ...scenario, seeds: 2 }, venue: v, poolOffers })).toThrow(/seeds > 1/);
    expect(() => runScenario({ scenario, venue: v })).toThrow(/no offers were loaded/);
  });

  it("changing the group mix changes the pool and the result", () => {
    const couples = runScenario({ scenario: generated, venue: v });
    const gen = (generated.pool as { generate: DemandModel }).generate;
    const singles: Scenario = { ...generated, pool: { generate: { ...gen, groupSizeMix: { 1: 80, 2: 20 } } } };
    const singlesOut = runScenario({ scenario: singles, venue: v });
    expect(singlesOut.offerSummary.byGroupSize[1]!.shareOfOffersPct).toBeGreaterThan(couples.offerSummary.byGroupSize[1]!.shareOfOffersPct);
    expect(singlesOut.runs[0]!.resultHash).not.toBe(couples.runs[0]!.resultHash);
  });
});

describe("renderers", () => {
  const out = runScenario({ scenario: generated, venue: v, now: "2026-09-07T00:00:00Z" });

  it("fill report has the headline sections and p50/p5/p95 columns for multi-seed", () => {
    const md = renderFillReport(out);
    expect(md).toContain("# Fill report — gen");
    expect(md).toContain("## FILL REPORT — policy `greedy` · 5 seeds");
    expect(md).toContain("| Metric | p50 | p5 | p95 |");
    expect(md).toContain("### By group size");
    expect(md).toContain("### Rank-respect");
    expect(md).toContain("All clear across 5 run(s)");
    expect(renderConsoleSummary(out)).toContain("FILL REPORT — gen");
  });

  it("offers.csv has one line per offer plus a header; seat map has one line per active row", () => {
    const first = out.runs[0]!;
    const csv = renderOffersCsv(first, v);
    expect(csv.trim().split("\n")).toHaveLength(first.offers!.length + 1);
    expect(csv.split("\n")[0]).toContain("offer_rank,offer_id,group_size");
    const map = renderSeatMap(first, v);
    expect(map.split("\n").filter((l) => /^\s+\d+\s/.test(l))).toHaveLength(4);
  });
});

describe("percentiles", () => {
  it("interpolates", () => {
    expect(percentiles([1, 2, 3, 4, 5])).toEqual({ p5: 1.2, p50: 3, p95: 4.8, mean: 3 });
    expect(percentiles([])).toEqual({ p5: 0, p50: 0, p95: 0, mean: 0 });
  });
});
