/** @vitest-environment node */
// Slice 6 sim-side: seat-preference scoring, upgrade buyouts, and the
// lookahead / protect-units policies through the scenario runner.
import { describe, expect, it } from "vitest";

import { generatePool } from "./demand";
import { loadPoolCsv } from "./pool";
import { renderFillReport } from "./report";
import { runScenario } from "./run";
import { row, venue } from "./test-helpers";
import type { DemandModel, Scenario } from "./types";
import { venueFromTierSpec } from "./venue";

const ctx = { tierOrder: ["premium", "mid"], floorsCents: { premium: 10000, mid: 6000 }, availableSeats: 40, maxGroupSize: 10 };
const model: DemandModel = { seed: 9, oversubscription: 1.2, groupSizeMix: "couples", priceModel: { kind: "ladder", ladderCents: 500 }, seatPrefs: { sharePct: 50, mix: { aisle: 50, centre: 50, front: 0 } } };

describe("seat preferences (scored, never enforced)", () => {
  it("draws a share of fans with a preference from the mix, without changing the crowd", () => {
    const withPrefs = generatePool(model, ctx);
    const without = generatePool({ ...model, seatPrefs: undefined } as unknown as DemandModel, ctx);
    expect(without.offers.map((o) => o.id + o.pricePerTicketCents)).toEqual(withPrefs.offers.map((o) => o.id + o.pricePerTicketCents));
    const kinds = Object.values(withPrefs.seatPrefs);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds).not.toContain("front");
    expect(new Set(kinds)).toEqual(new Set(["aisle", "centre"]));
  });

  it("scores aisle / centre / front against the final seat map and shows up in the report", () => {
    const v = venue([row({ id: "a", rank: 1, cap: 12, tier: "premium", lean: "CENTER" }), row({ id: "b", rank: 2, cap: 12, tier: "mid", lean: "LEFT" })]);
    const scenario: Scenario = {
      name: "sp",
      venue: "test-venue",
      pool: { generate: { ...model, oversubscription: 1.0, seatPrefs: { sharePct: 100, mix: { aisle: 1, centre: 1, front: 1 }, frontRows: 1 } } },
      seeds: 4,
    };
    const out = runScenario({ scenario, venue: v });
    const sp = out.runs[0]!.metrics.seatPrefs!;
    expect(sp.fans).toBe(out.offerSummary.offers);
    expect(sp.satisfied).toBeLessThanOrEqual(sp.seated);
    expect(sp.byKind.front.satisfied).toBeLessThanOrEqual(sp.byKind.front.seated);
    expect(out.aggregates[0]!.scalars["seatPrefs.aisle.satisfiedRate"]).toBeDefined();
    expect(renderFillReport(out)).toContain("### Seat preferences beyond tier (scored, not enforced)");
  });
});

describe("lookahead and protect-units through the runner", () => {
  it("lookahead reports its deferrals and is labelled not rank-first", () => {
    const v = venue([row({ id: "r1", rank: 1, cap: 5, tier: "premium" }), row({ id: "r2", rank: 2, cap: 7, tier: "premium" })]);
    const pool = loadPoolCsv("id,size,price\nA,4,100\nB,3,90\nC,3,80\nD,2,70\n").offers;
    const out = runScenario({ scenario: { name: "la", venue: "test-venue", pool: { file: "p.csv" }, policies: ["greedy", "lookahead:1"] }, venue: v, poolOffers: pool });
    const [g, l] = out.runs;
    expect(g!.metrics.fill.emptySeats).toBe(2);
    expect(l!.metrics.fill.emptySeats).toBe(0);
    expect(l!.metrics.policy.lookaheadDeferrals).toBe(1);
    expect(l!.metrics.policy.seatsSavedByLookahead).toBe(2);
    // A now sits behind B, C and D, but no single lower-ranked block (plus its adjacent empties) could have
    // held a 4 in row 1 — so by the spec's subject-to-fit definition A was not "passed over". The cost of the
    // deferral shows up as lookaheadDeferrals and in the by-group-size rows, not as a rank violation.
    expect(l!.metrics.rankRespect.passedOver).toBe(0);
    expect(l!.metrics.byGroupSize[4]!.medianRowRank).toBe(2);
    const md = renderFillReport(out);
    expect(md).toContain("no (lookahead)");
    expect(md).toContain("fill-first, NOT rank-first");
  });

  it("protect-units keeps strangers off a table and counts the protected seats", () => {
    const v = venueFromTierSpec({ name: "club", displayName: "Club", tiers: [{ name: "tables", rowCount: 3, seatsPerRow: 4, unitType: "tables", floorCents: 5000 }] });
    const pool = loadPoolCsv("id,size,price\nA,2,100\nB,2,90\nC,3,80\nD,2,70\n").offers;
    const out = runScenario({ scenario: { name: "pu", venue: "club", pool: { file: "p.csv" }, policies: ["greedy", "protect-units"] }, venue: v, poolOffers: pool });
    const [co, pr] = out.runs;
    expect(co!.metrics.fill.placedSeats).toBe(9);
    expect(co!.metrics.policy.protectedSeats).toBe(0);
    expect(pr!.metrics.fill.placedSeats).toBe(7); // A, B, C each get their own table; D has no table left
    expect(pr!.metrics.policy.protectedSeats).toBe(5);
    expect(pr!.metrics.offers.unplaced).toBe(1);
    expect(pr!.violations).toEqual([]);
  });
});

describe("upgrade buyouts (Q29)", () => {
  it("matches same-size fans across tiers, applies the accept rate, and pays uplift to the artist", () => {
    const v = venue([row({ id: "p", rank: 1, cap: 4, tier: "premium" }), row({ id: "m", rank: 2, cap: 4, tier: "mid" })]);
    const pool = loadPoolCsv("id,size,price\nA,2,100\nB,2,90\nC,2,80\nD,2,70\n").offers; // A,B premium; C,D mid
    const scenario: Scenario = {
      name: "up",
      venue: "test-venue",
      pool: { file: "p.csv" },
      timeline: { windowDays: 1, previewEveryHours: 24, upgrades: { requestSharePct: 100, acceptRatePct: 100, premiumPct: 20 } },
    };
    const out = runScenario({ scenario, venue: v, poolOffers: pool });
    const up = out.runs[0]!.temporal!.upgrades!;
    expect(up.requests).toBe(2); // C and D (mid) ask
    expect(up.matched).toBe(2);
    expect(up.accepted).toBe(2);
    expect(up.upliftCents).toBe(Math.round(10000 * 0.2) * 2 + Math.round(9000 * 0.2) * 2); // A's and B's seats bought out at +20%
    expect(renderFillReport(out)).toContain("#### Upgrade buyouts after binding (Q29)");
    const none = runScenario({ scenario: { ...scenario, timeline: { ...scenario.timeline!, upgrades: { requestSharePct: 100, acceptRatePct: 0, premiumPct: 20 } } }, venue: v, poolOffers: pool });
    expect(none.runs[0]!.temporal!.upgrades).toMatchObject({ requests: 2, matched: 2, accepted: 0, upliftCents: 0 });
  });
});
