/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { compareRuns, renderComparison, renderComparisonConsole } from "./compare";
import { offersFromCsv } from "./pool";
import { runScenario } from "./run";
import { row, venue } from "./test-helpers";
import type { RunOutput, Scenario } from "./types";

const v = venue([row({ id: "a", rank: 1, cap: 4, tier: "premium" }), row({ id: "b", rank: 2, cap: 4, tier: "mid" }), row({ id: "c", rank: 3, cap: 4, tier: "rear" })]);
const pool = offersFromCsv("id,size,price\nA,4,100\nB,2,90\nC,3,80\nD,1,70\nE,4,60\n");

// Simulate the disk round trip: result.json is JSON, so Dates become strings.
const roundTrip = (o: RunOutput): RunOutput => JSON.parse(JSON.stringify(o)) as RunOutput;

describe("compareRuns", () => {
  const base: Scenario = { name: "base", venue: "test-venue", pool: { file: "p.csv" } };
  const held: Scenario = { ...base, name: "held", show: { holds: [{ source: "artist", seatIds: ["a:1", "a:2"] }] } };
  const a = roundTrip(runScenario({ scenario: base, venue: v, poolOffers: pool, now: "2026-09-07T00:00:00Z" }));
  const b = roundTrip(runScenario({ scenario: held, venue: v, poolOffers: pool, now: "2026-09-07T00:00:00Z" }));

  it("lines up columns, computes deltas, and diffs offers when the pool and venue match", () => {
    const c = compareRuns([
      { runName: "base", output: a },
      { runName: "held", output: b },
    ]);
    expect(c.columns.map((x) => x.label)).toEqual(["base", "held"]);
    const filled = c.metrics.find((m) => m.key === "fill.placedSeats")!;
    expect(filled.values[0]).toBeGreaterThanOrEqual(filled.values[1]!);
    expect(a.runs[0]!.metrics.capacity.availableSeats - b.runs[0]!.metrics.capacity.availableSeats).toBe(2);
    expect(c.offerDiffs).toHaveLength(1);
    const d = c.offerDiffs[0]!;
    expect(d.moved.length).toBeGreaterThan(0);
    expect(d.moved[0]).toMatchObject({ offerId: "A", from: "row 1" });
    const md = renderComparison(c);
    expect(md).toContain("# Run comparison — base vs held");
    expect(md).toContain("## Who moved — base → held");
    expect(renderComparisonConsole(c)).toContain("RUN COMPARISON");
  });

  it("skips the per-offer diff for different pools and needs two runs", () => {
    const other = roundTrip(runScenario({ scenario: base, venue: v, poolOffers: pool.slice(0, 3) }));
    const c = compareRuns([
      { runName: "base", output: a },
      { runName: "smaller", output: other },
    ]);
    expect(c.offerDiffs).toEqual([]);
    expect(renderComparison(c)).toContain("No per-offer diff");
    expect(() => compareRuns([{ runName: "x", output: a }])).toThrow(/at least two/);
  });
});
