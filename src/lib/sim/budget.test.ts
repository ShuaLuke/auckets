/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { checkWork, estimateAllocationMs, policyWeight } from "./budget";

describe("checkWork", () => {
  it("keeps the flat 400-allocation cap for theatre-sized rooms, whatever the policies", () => {
    expect(checkWork({ onSaleSeats: 1265, oversubscription: 5, policies: ["lookahead:4", "lookahead", "clean-fit", "greedy"], seeds: 20, previews: 5 }).ok).toBe(true);
    const over = checkWork({ onSaleSeats: 1265, oversubscription: 5, policies: ["greedy"], seeds: 20, previews: 21 });
    expect(over.ok).toBe(false);
    expect(over.ok === false && over.message).toMatch(/420 allocations/);
  });

  it("limits a stadium by estimated time", () => {
    const daikin = 41_151;
    expect(checkWork({ onSaleSeats: daikin, oversubscription: 1.25, policies: ["greedy", "clean-fit", "clean-fit+singles-reserve"], seeds: 1, previews: 1 }).ok).toBe(true);
    expect(checkWork({ onSaleSeats: daikin, oversubscription: 1.25, policies: ["lookahead:4"], seeds: 1, previews: 1 }).ok).toBe(true);
    expect(checkWork({ onSaleSeats: daikin, oversubscription: 1.25, policies: ["greedy"], seeds: 5, previews: 1 }).ok).toBe(true);
    const all = checkWork({ onSaleSeats: daikin, oversubscription: 1.25, policies: ["greedy", "clean-fit", "clean-fit+singles-reserve", "lookahead"], seeds: 1, previews: 1 });
    expect(all.ok).toBe(false);
    expect(all.ok === false && all.message).toMatch(/about 27 s of work with 41,151 seats on sale/);
    expect(checkWork({ onSaleSeats: daikin, oversubscription: 1.25, policies: ["greedy"], seeds: 1, previews: 13 }).ok).toBe(false);
    // The crowd matters more than the room: 2.5× is one greedy run, 5× is none.
    expect(checkWork({ onSaleSeats: daikin, oversubscription: 2.5, policies: ["greedy"], seeds: 1, previews: 1 }).ok).toBe(true);
    expect(checkWork({ onSaleSeats: daikin, oversubscription: 2.5, policies: ["greedy", "clean-fit"], seeds: 1, previews: 1 }).ok).toBe(false);
    expect(checkWork({ onSaleSeats: daikin, oversubscription: 5, policies: ["greedy"], seeds: 1, previews: 1 }).ok).toBe(false);
  });

  it("lets a sectioned-off stadium do more", () => {
    const lowerBowl = 16_337;
    expect(checkWork({ onSaleSeats: lowerBowl, oversubscription: 1.25, policies: ["greedy", "clean-fit", "clean-fit+singles-reserve", "lookahead"], seeds: 1, previews: 1 }).ok).toBe(true);
  });

  it("weights and estimates", () => {
    expect(policyWeight("greedy")).toBe(1);
    expect(policyWeight("parity-tiebreak")).toBe(1);
    expect(policyWeight("clean-fit+singles-reserve")).toBe(1.5);
    expect(policyWeight("lookahead")).toBe(3.5);
    expect(policyWeight("lookahead:4+protect-units")).toBe(5.5);
    expect(Math.round(estimateAllocationMs(41_151, 1.25))).toBe(3600);
    expect(estimateAllocationMs(1265, 1.25)).toBeLessThan(40);
  });
});
