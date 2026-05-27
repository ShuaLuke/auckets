import { describe, expect, it } from "vitest";

import { presentRankBoard } from "./rank-board";

const ZERO_STATS = {
  count: 0,
  ticketsCount: 0,
  medianCents: null,
  topCents: null,
} as const;

describe("presentRankBoard", () => {
  it("renders all cells in their empty-pool form when there are no offers", () => {
    const view = presentRankBoard(null, ZERO_STATS, 0, 0);
    expect(view.yourRankLabel).toBe("—");
    expect(view.yourRankSub).toBe("pool is empty");
    expect(view.medianOfferLabel).toBe("—");
    expect(view.medianOfferSub).toBe("no offers yet");
    expect(view.capacityLabel).toBe("—");
    expect(view.capacitySub).toBe("provisionally placed");
  });

  it("formats the user's rank with a # prefix and the pool count as the denominator", () => {
    const view = presentRankBoard(
      6,
      { count: 142, ticketsCount: 380, medianCents: 2800, topCents: 12000 },
      487,
      624,
    );
    expect(view.yourRankLabel).toBe("#6");
    expect(view.yourRankSub).toBe("of 142 offers");
  });

  it("singularizes 'offer' when the pool has exactly one offer", () => {
    const view = presentRankBoard(
      1,
      { count: 1, ticketsCount: 4, medianCents: 4200, topCents: 4200 },
      0,
      50,
    );
    expect(view.yourRankSub).toBe("of 1 offer");
  });

  it("shows '—' for the user's rank when they have no offer, but still surfaces the pool count for context", () => {
    const view = presentRankBoard(
      null,
      { count: 12, ticketsCount: 38, medianCents: 3000, topCents: 8000 },
      24,
      50,
    );
    expect(view.yourRankLabel).toBe("—");
    expect(view.yourRankSub).toBe("12 offers in pool");
  });

  it("formats median cents through formatCents (no floats, dollars-and-cents string)", () => {
    const view = presentRankBoard(
      1,
      { count: 1, ticketsCount: 4, medianCents: 2800, topCents: 2800 },
      0,
      50,
    );
    expect(view.medianOfferLabel).toBe("$28.00");
    expect(view.medianOfferSub).toBe("across the pool");
  });

  it("rounds capacity to a whole percentage and shows the filled/total fraction in the sub", () => {
    // 487 / 624 = 0.7804... → 78%
    const view = presentRankBoard(
      6,
      { count: 142, ticketsCount: 380, medianCents: 2800, topCents: 12000 },
      487,
      624,
    );
    expect(view.capacityLabel).toBe("78%");
    expect(view.capacitySub).toBe("487 / 624 provisionally placed");
  });

  it("degrades capacity to '—' when capacity is 0 (no architecture / no active rows)", () => {
    // Same pool data, but zero capacity — we'd divide by zero. Render '—'
    // rather than NaN% or Infinity%.
    const view = presentRankBoard(
      6,
      { count: 142, ticketsCount: 380, medianCents: 2800, topCents: 12000 },
      0,
      0,
    );
    expect(view.capacityLabel).toBe("—");
    expect(view.capacitySub).toBe("provisionally placed");
  });
});
