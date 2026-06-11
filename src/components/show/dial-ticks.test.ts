// Tests for the dial's tier-floor tick positions (pure math, UI-4).

import { describe, expect, it } from "vitest";

import { dialTickFractions } from "./dial-ticks";

describe("dialTickFractions", () => {
  // Matches the composer's dialBounds() for these floors:
  // min = floor(2500/100) = 25, max = ceil(6000*2/100) = 120.
  const FLOORS = { premium: 6000, mid: 4000, rear: 2500 };

  it("positions each tier floor proportionally within the dollar bounds", () => {
    const ticks = dialTickFractions(FLOORS, 25, 120);
    expect(ticks).toHaveLength(3);
    expect(ticks[0]).toEqual({ tier: "rear", floorCents: 2500, fraction: 0 });
    expect(ticks[1]?.tier).toBe("mid");
    expect(ticks[1]?.fraction).toBeCloseTo((40 - 25) / 95, 10);
    expect(ticks[2]?.tier).toBe("premium");
    expect(ticks[2]?.fraction).toBeCloseTo((60 - 25) / 95, 10);
  });

  it("sorts ticks by position regardless of key order", () => {
    const ticks = dialTickFractions({ a: 9000, b: 1000, c: 5000 }, 10, 100);
    expect(ticks.map((t) => t.tier)).toEqual(["b", "c", "a"]);
  });

  it("drops floors outside the dial's travel", () => {
    // A floor below min (sub-$25) or above max (>$120) never renders a tick.
    const ticks = dialTickFractions(
      { tooLow: 1000, fine: 4000, tooHigh: 50000 },
      25,
      120,
    );
    expect(ticks.map((t) => t.tier)).toEqual(["fine"]);
  });

  it("keeps endpoint floors (fraction 0 and 1 inclusive)", () => {
    const ticks = dialTickFractions({ lo: 2500, hi: 12000 }, 25, 120);
    expect(ticks[0]?.fraction).toBe(0);
    expect(ticks[1]?.fraction).toBe(1);
  });

  it("returns no ticks for empty floors or a degenerate range", () => {
    expect(dialTickFractions({}, 25, 120)).toEqual([]);
    expect(dialTickFractions({ a: 2500 }, 50, 50)).toEqual([]);
    expect(dialTickFractions({ a: 2500 }, 60, 50)).toEqual([]);
  });

  it("handles non-whole-dollar floors", () => {
    const ticks = dialTickFractions({ odd: 2550 }, 25, 120);
    expect(ticks[0]?.fraction).toBeCloseTo(0.5 / 95, 10);
  });
});
