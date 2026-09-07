/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { generatePool, parseGroupMixArg, resolveGroupMix, GROUP_MIX_PRESETS, type DemandContext } from "./demand";
import type { DemandModel } from "./types";

const ctx: DemandContext = {
  tierOrder: ["premium", "mid", "rear"],
  floorsCents: { premium: 10000, mid: 6000, rear: 4000 },
  availableSeats: 1000,
  maxGroupSize: 10,
};

const model: DemandModel = {
  seed: 5,
  oversubscription: 1.25,
  groupSizeMix: { 1: 10, 2: 45, 3: 10, 4: 25, 5: 5, 6: 5 },
  priceModel: { kind: "ladder", ladderCents: 2500, meanStepsAboveFloor: 3 },
};

describe("generatePool", () => {
  it("hits the oversubscription target and only draws sizes from the mix", () => {
    const { offers, realizedMixPct } = generatePool(model, ctx);
    const tickets = offers.reduce((s, o) => s + o.groupSize, 0);
    expect(tickets).toBeGreaterThanOrEqual(1250);
    expect(tickets).toBeLessThan(1250 + 6);
    expect(new Set(offers.map((o) => o.groupSize))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    const total = Object.values(realizedMixPct).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(100, 6);
    // couples should be the plurality, roughly 45%
    expect(realizedMixPct[2]!).toBeGreaterThan(35);
    expect(realizedMixPct[2]!).toBeLessThan(55);
  });

  it("is deterministic per seed and different across seeds", () => {
    const a = generatePool(model, ctx).offers;
    const b = generatePool(model, ctx).offers;
    const c = generatePool(model, ctx, 6).offers;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("prices sit on the ladder above the tier floor, and preferences carry tiers", () => {
    const { offers } = generatePool(model, ctx);
    for (const o of offers) {
      const pref = o.tierPreference;
      if (pref.type !== "any") expect(ctx.tierOrder).toContain(pref.tier);
      const minFloor = Math.min(...Object.values(ctx.floorsCents));
      expect(o.pricePerTicketCents).toBeGreaterThanOrEqual(minFloor);
      expect((o.pricePerTicketCents - minFloor) % 500).toBe(0); // all floors and the ladder are multiples of $5
      expect(o.rankKey).toBe(o.pricePerTicketCents * 1000 + o.groupSize);
    }
    const ids = new Set(offers.map((o) => o.id));
    expect(ids.size).toBe(offers.length);
    const times = new Set(offers.map((o) => o.submittedAt.getTime()));
    expect(times.size).toBe(offers.length);
  });

  it("drops sizes above the group cap and errors when nothing is left", () => {
    const { offers } = generatePool(model, { ...ctx, maxGroupSize: 3 });
    expect(Math.max(...offers.map((o) => o.groupSize))).toBeLessThanOrEqual(3);
    expect(() => generatePool({ ...model, groupSizeMix: { 8: 100 } }, { ...ctx, maxGroupSize: 4 })).toThrow(/exceeds maxGroupSize/);
  });

  it("needs a floor for every active tier", () => {
    expect(() => generatePool(model, { ...ctx, floorsCents: { premium: 1 } })).toThrow(/no floor price for tier "mid"/);
  });

  it("lognormal model also snaps to the ladder", () => {
    const { offers } = generatePool({ ...model, priceModel: { kind: "lognormal", ladderCents: 500 } }, ctx);
    for (const o of offers) expect(o.pricePerTicketCents % 500).toBe(0);
  });
});

describe("group mix helpers", () => {
  it("parses the CLI form and validates the sum", () => {
    expect(parseGroupMixArg("1:10, 2:45,3=10,4:25,5:5,6:5")).toEqual({ 1: 10, 2: 45, 3: 10, 4: 25, 5: 5, 6: 5 });
    expect(() => parseGroupMixArg("1:50,2:40")).toThrow(/sum to 90/);
    expect(() => parseGroupMixArg("two:50")).toThrow(/cannot read/);
  });

  it("every preset sums to 100", () => {
    for (const [name, mix] of Object.entries(GROUP_MIX_PRESETS)) {
      const total = Object.values(mix).reduce((s, v) => s + v, 0);
      expect(total, name).toBeCloseTo(100, 6);
    }
    expect(resolveGroupMix("couples")).toBe(GROUP_MIX_PRESETS.couples);
  });
});
