import { describe, expect, it } from "vitest";

import { presentPreviewBanner } from "./preview-banner";
import type { offers } from "../../../drizzle/schema";

type Offer = typeof offers.$inferSelect;

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    showId: "44444444-4444-4444-4444-444444444444",
    userId: "user_2abc",
    channel: "market",
    groupSize: 4,
    pricePerTicketCents: 4200,
    tierPreference: "this_or_worse",
    preferredTier: "premium",
    rankKey: BigInt(4200000 + 4),
    autoBidEnabled: false,
    autoBidCapCents: null,
    autoBidIncrementCents: 500,
    privateThresholdCents: null,
    stripePaymentMethodId: "pm_dev_stub",
    stripeSetupIntentId: "seti_dev_stub",
    status: "placed",
    submittedAt: new Date("2026-05-25T10:00:00Z"),
    revisedAt: null,
    ...overrides,
  };
}

describe("presentPreviewBanner", () => {
  it("returns no-offer state when the user hasn't submitted an offer", () => {
    const view = presentPreviewBanner(null, null, null);
    expect(view.state).toBe("no-offer");
  });

  it("returns no-placement state when there's an offer but no assignment", () => {
    const view = presentPreviewBanner(makeOffer(), null, null);
    expect(view.state).toBe("no-placement");
  });

  it("returns no-placement state when there's an offer + assignment but no row was resolved (defensive)", () => {
    // Programming-error case: the route handler forgot to look up the
    // architecture row. Better to render the warm placeholder than crash.
    const view = presentPreviewBanner(
      makeOffer(),
      { seatNumbers: ["7", "8", "9", "10"] },
      null,
    );
    expect(view.state).toBe("no-placement");
  });

  it("returns placed state with tier label + row name + seat range when all data is present", () => {
    const view = presentPreviewBanner(
      makeOffer(),
      { seatNumbers: ["7", "8", "9", "10"] },
      { tier: "premium", rowName: "A" },
    );
    expect(view).toEqual({
      state: "placed",
      tierLabel: "Premium",
      rowName: "A",
      seatRange: "7–10",
    });
  });

  it("renders a single-seat range as just the seat number, not an X–X range", () => {
    const view = presentPreviewBanner(
      makeOffer({ groupSize: 1 }),
      { seatNumbers: ["7"] },
      { tier: "mid", rowName: "F" },
    );
    expect(view.state).toBe("placed");
    if (view.state === "placed") {
      expect(view.seatRange).toBe("7");
      expect(view.tierLabel).toBe("Mid");
    }
  });

  it("falls back to 'General admission' when the row has no tier", () => {
    const view = presentPreviewBanner(
      makeOffer(),
      { seatNumbers: ["GA-1", "GA-2"] },
      { rowName: "GA" }, // no tier
    );
    expect(view.state).toBe("placed");
    if (view.state === "placed") {
      expect(view.tierLabel).toBe("General admission");
    }
  });
});
