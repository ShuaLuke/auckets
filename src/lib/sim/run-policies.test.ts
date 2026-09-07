/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { loadPoolCsv, poolToCsv } from "./pool";
import { renderFillReport } from "./report";
import { runScenario } from "./run";
import { row, venue } from "./test-helpers";
import type { Scenario } from "./types";

const v = venue([
  row({ id: "a", rank: 1, cap: 6, tier: "premium" }),
  row({ id: "b", rank: 2, cap: 1, tier: "premium" }),
  row({ id: "c", rank: 3, cap: 8, tier: "mid", area: "front_balcony" }),
]);

describe("runScenario with policies", () => {
  it("runs each policy on the same pool and reports them side by side", () => {
    const pool = loadPoolCsv("id,size,price\nA,4,100\nB,3,90\nC,3,80\nS,1,20\n");
    const scenario: Scenario = { name: "pol", venue: "test-venue", pool: { file: "p.csv" }, policies: ["greedy", "clean-fit", "clean-fit+singles-reserve"] };
    const out = runScenario({ scenario, venue: v, poolOffers: pool.offers, now: "2026-09-07T00:00:00Z" });
    expect(out.runs.map((r) => r.policy)).toEqual(["greedy", "clean-fit", "clean-fit+singles-reserve"]);
    const by = Object.fromEntries(out.runs.map((r) => [r.policy, r]));
    // greedy: A(4) in row a, S plugs one of the 2 leftover seats → 1-seat hole; the 1-seat row b stays empty; B+C leave 2 in row c
    expect(by.greedy!.metrics.fill.holesBySize).toEqual({ 1: 2, 2: 1 });
    // clean-fit: row a = B+C (closed), row b empty (S is spent? no — S goes to row b), A → row c
    expect(by["clean-fit"]!.metrics.fill.holesBySize).toEqual({ 4: 1 });
    expect(by["clean-fit"]!.metrics.policy.cleanFitDeferrals).toBe(1);
    expect(by["clean-fit+singles-reserve"]!.config).toMatchObject({ fitPolicy: "clean_fit", singlesReserve: 1 });
    expect(by["clean-fit+singles-reserve"]!.metrics.policy.reservedSinglesPlaced).toBe(1);
    expect(out.runs.every((r) => r.violations.length === 0)).toBe(true);
    const md = renderFillReport(out);
    expect(md).toContain("## Policies compared");
    expect(md).toContain("NOT rank-first");
    expect(md).toContain("| Rank-first? |");
  });

  it("auto-bid caps from the pool file feed the pre-pass, and the raise rule comes from the scenario", () => {
    const csv = poolToCsv(loadPoolCsv("id,size,price,tier\nrich,4,120,premium-\nauto,2,100,premium-\n").offers, { auto: { capCents: 15000 } });
    expect(csv.split("\n")[0]).toBe("id,size,price,tier,order,cap,threshold");
    const pool = loadPoolCsv(csv);
    expect(pool.autoBids).toEqual({ auto: { capCents: 15000, kind: "auto" } });
    const v2 = venue([row({ id: "p", rank: 1, cap: 4, tier: "premium" }), row({ id: "m", rank: 2, cap: 4, tier: "mid" })]);
    const scenario: Scenario = { name: "ab", venue: "test-venue", pool: { file: "p.csv" }, autoBidRaiseRule: { kind: "percent", pct: 10 } };
    const out = runScenario({ scenario, venue: v2, poolOffers: pool.offers, poolAutoBids: pool.autoBids });
    const run = out.runs[0]!;
    expect(run.metrics.autoBid).toMatchObject({ bidders: 1, raised: 1, totalRaiseCents: 2100, heldSectionAfterRaise: 1, cappedOut: 0 });
    expect(run.offers!.find((o) => o.id === "auto")!.pricePerTicketCents).toBe(12100);
    expect(run.metrics.revenue.grossPlacedCents).toBe(4 * 12000 + 2 * 12100);
    expect(renderFillReport(out)).toContain("### Auto-bid");
  });

  it("generated pools carry an auto-bid share without reshuffling the crowd", () => {
    const base: Scenario = {
      name: "g",
      venue: "test-venue",
      pool: { generate: { seed: 3, oversubscription: 1.5, groupSizeMix: "couples", priceModel: { kind: "ladder", ladderCents: 500 } } },
    };
    const withAb: Scenario = { ...base, pool: { generate: { ...(base.pool as { generate: import("./types").DemandModel }).generate, autoBid: { sharePct: 50, capMultiplier: [1.2, 1.5] } } } };
    const a = runScenario({ scenario: base, venue: v });
    const b = runScenario({ scenario: withAb, venue: v });
    expect(b.offerSummary.offers).toBe(a.offerSummary.offers);
    expect(b.runs[0]!.metrics.autoBid.bidders).toBeGreaterThan(0);
    expect(b.runs[0]!.metrics.autoBid.bidders).toBeLessThan(b.offerSummary.offers);
  });
});
