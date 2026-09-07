/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { runScenario } from "./run";
import { applyVary, assembleSweep, labelFor, normalizePath, parseVaryArg, renderSweep, renderSweepConsole, renderSweepCsv, slimOutput } from "./sweep";
import { row, venue } from "./test-helpers";
import type { Scenario } from "./types";

const v = venue([row({ id: "a", rank: 1, cap: 8, tier: "premium" }), row({ id: "b", rank: 2, cap: 7, tier: "mid", area: "front_balcony" }), row({ id: "c", rank: 3, cap: 5, tier: "rear", area: "upper_balcony" })]);
const base: Scenario = {
  name: "sw",
  venue: "test-venue",
  pool: { generate: { seed: 1, oversubscription: 1.0, groupSizeMix: "couples", priceModel: { kind: "ladder", ladderCents: 500 } } },
  policies: ["greedy", "clean-fit"],
  seeds: 3,
};

describe("parseVaryArg / applyVary", () => {
  it("parses ranges, lists, JSON, and the pool.* shorthand", () => {
    expect(parseVaryArg("pool.oversubscription=0.6:1.0:0.2")).toEqual({ path: "pool.generate.oversubscription", values: [0.6, 0.8, 1] });
    expect(parseVaryArg("pool.groupSizeMix=even-heavy,odd-heavy")).toEqual({ path: "pool.generate.groupSizeMix", values: ["even-heavy", "odd-heavy"] });
    expect(parseVaryArg("show.maxGroupSize=6,8,10").values).toEqual([6, 8, 10]);
    expect(parseVaryArg('pool.groupSizeMix={"1":50,"2":50},couples').values).toEqual([{ 1: 50, 2: 50 }, "couples"]);
    expect(parseVaryArg("venue=a,b").path).toBe("venue");
    expect(normalizePath("pool.file")).toBe("pool.file");
    expect(() => parseVaryArg("nope")).toThrow(/path=values/);
    expect(() => parseVaryArg("pool.oversubscription=2:1:0.5")).toThrow(/bad range/);
    expect(() => parseVaryArg("x=a,,b")).toThrow(/empty value/);
  });

  it("sets nested values on a copy and refuses unsweepable or impossible paths", () => {
    const s2 = applyVary(base, "pool.generate.oversubscription", 1.5);
    expect((s2.pool as { generate: { oversubscription: number } }).generate.oversubscription).toBe(1.5);
    expect((base.pool as { generate: { oversubscription: number } }).generate.oversubscription).toBe(1);
    const s3 = applyVary(base, "show.floorsCents.premium", 12000);
    expect(s3.show?.floorsCents).toEqual({ premium: 12000 });
    expect(applyVary(base, "venue", "other").venue).toBe("other");
    expect(() => applyVary(base, "policies", ["greedy"])).toThrow(/not sweepable/);
    const filePool: Scenario = { name: "f", venue: "test-venue", pool: { file: "p.csv" } };
    expect(() => applyVary(filePool, "pool.generate.oversubscription", 2)).toThrow(/needs a generated pool/);
    expect(labelFor({ 1: 50 })).toBe('{"1":50}');
  });
});

describe("sweep output", () => {
  const values = [0.6, 1.0, 1.4];
  const points = values.map((val) => {
    const scenario = applyVary(base, "pool.generate.oversubscription", val);
    return { label: labelFor(val), value: val, scenario, output: slimOutput(runScenario({ scenario, venue: v, now: "2026-09-07T00:00:00Z" })) };
  });
  const sw = assembleSweep("sw", "pool.generate.oversubscription", points, "2026-09-07T00:00:00Z");

  it("keeps aggregates but drops per-seed engine output, and fill rises with demand", () => {
    expect(sw.points).toHaveLength(3);
    expect(sw.policies).toEqual(["greedy", "clean-fit"]);
    expect(sw.seeds).toBe(3);
    for (const p of sw.points) for (const r of p.output.runs) expect(r.result).toBeUndefined();
    const fills = sw.points.map((p) => p.output.aggregates[0]!.scalars["fill.fillRate"]!.p50);
    expect(fills[0]!).toBeLessThan(fills[2]!);
    expect(() => assembleSweep("x", "p", points.slice(0, 1))).toThrow(/at least two/);
  });

  it("renders markdown, csv, and console", () => {
    const md = renderSweep(sw);
    expect(md).toContain("# Sweep — sw · pool.generate.oversubscription");
    expect(md).toContain("## Policy `clean-fit`");
    expect(md).toContain("| 0.6 |");
    const csv = renderSweepCsv(sw);
    expect(csv.split("\n")[0]).toBe("param,value,policy,metric,p5,p50,p95,mean,stdev,min,max");
    expect(csv).toContain("pool.generate.oversubscription,1,greedy,fill.fillRate,");
    expect(csv).toContain("byGroupSize.2.placedRate");
    expect(renderSweepConsole(sw)).toContain("SWEEP — sw");
  });
});
