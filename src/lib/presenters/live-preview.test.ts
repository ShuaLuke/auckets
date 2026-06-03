import { describe, expect, it } from "vitest";

import { presentLiveProjection } from "./live-preview";

const TIER_FLOORS = { premium: 5000, mid: 3000, rear: 1500 };

describe("presentLiveProjection", () => {
  it("returns a calm not-placed view when the candidate didn't fit", () => {
    const view = presentLiveProjection({
      pricePerTicketCents: 2000,
      groupSize: 2,
      tierPreference: "specific",
      preferredTier: "premium",
      projection: { placed: false, tier: null, venueRowId: null, seatNumbers: [] },
      rowName: null,
      tierFloorsCents: TIER_FLOORS,
    });
    expect(view.available).toBe(true);
    expect(view.placed).toBe(false);
    expect(view.payPerTicket).toBe("$20.00");
    expect(view.standing).toBeNull();
    expect(view.yourSeats).toBeNull();
  });

  it("formats a placed mid-tier projection with the reach-to-next-tier line", () => {
    const view = presentLiveProjection({
      pricePerTicketCents: 3500,
      groupSize: 4,
      tierPreference: "this_or_worse",
      preferredTier: "premium",
      projection: {
        placed: true,
        tier: "mid",
        venueRowId: "row_mid",
        seatNumbers: ["7", "8", "9", "10"],
      },
      rowName: "F",
      tierFloorsCents: TIER_FLOORS,
    });
    expect(view.placed).toBe(true);
    expect(view.tierLabel).toBe("Mid");
    expect(view.rowName).toBe("F");
    expect(view.seatRange).toBe("7–10");
    expect(view.payPerTicket).toBe("$35.00");
    expect(view.yourSeats).toEqual({
      rowId: "row_mid",
      numbers: ["7", "8", "9", "10"],
    });
    expect(view.standing?.projectedTier).toBe("Mid");
    // Reach premium: 5000 − 3500 = $15.00.
    expect(view.standing?.nextTier).toEqual({
      label: "Premium",
      deltaDisplay: "$15.00",
    });
  });

  it("marks the top tier with no further reach", () => {
    const view = presentLiveProjection({
      pricePerTicketCents: 6000,
      groupSize: 2,
      tierPreference: "specific",
      preferredTier: "premium",
      projection: {
        placed: true,
        tier: "premium",
        venueRowId: "row_prem",
        seatNumbers: ["1", "2"],
      },
      rowName: "A",
      tierFloorsCents: TIER_FLOORS,
    });
    expect(view.standing?.inTopTier).toBe(true);
    expect(view.standing?.nextTier).toBeNull();
    expect(view.seatRange).toBe("1–2");
  });
});
