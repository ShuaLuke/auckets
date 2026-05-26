import { describe, expect, it } from "vitest";

import type { offers } from "../../../drizzle/schema";

import {
  presentOffer,
  type OfferStatus,
  type OfferView,
} from "./offers";

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
    preferredTier: null,
    rankKey: BigInt(4200 * 1000 + 4),
    autoBidEnabled: false,
    autoBidCapCents: null,
    autoBidIncrementCents: 500,
    privateThresholdCents: null,
    stripePaymentMethodId: "pm_test",
    stripeSetupIntentId: "seti_test",
    status: "pool",
    submittedAt: new Date("2026-05-26T12:00:00Z"),
    revisedAt: null,
    ...overrides,
  };
}

describe("presentOffer", () => {
  it("maps the Dashboard.jsx yourOffer fields", () => {
    const view = presentOffer(makeOffer());
    expect(view).toEqual<OfferView>({
      priceCents: 4200,
      price: "$42.00",
      size: 4,
      status: "pool",
      placed: false,
    });
  });

  it("treats both 'placed' (provisional) and 'charged' (post-binding) as placed", () => {
    // 'placed' is the preview/provisional state; 'charged' is the
    // post-binding state. Both mean the fan has a seat in the row UI.
    expect(presentOffer(makeOffer({ status: "placed" })).placed).toBe(true);
    expect(presentOffer(makeOffer({ status: "charged" })).placed).toBe(true);
  });

  it("does not mark pool / unplaced / failure / resale / gift statuses as placed", () => {
    const notPlaced: OfferStatus[] = [
      "pool",
      "unplaced",
      "card_failure",
      "refunded",
      "resold",
      "gifted",
    ];
    for (const status of notPlaced) {
      expect(
        presentOffer(makeOffer({ status })).placed,
        `status=${status}`,
      ).toBe(false);
    }
  });

  it("does NOT include private_threshold_cents in the view (server-only per ADR-0017)", () => {
    // The privacy guarantee: even when the underlying row has a
    // threshold set, the view shape never carries it. Catches a
    // future refactor that adds the field by accident.
    const offer = makeOffer({ privateThresholdCents: 5500 });
    const view = presentOffer(offer);
    expect(view).not.toHaveProperty("privateThresholdCents");
    expect(view).not.toHaveProperty("private_threshold_cents");
  });

  it("formats the price with two decimals + thousands separator", () => {
    expect(presentOffer(makeOffer({ pricePerTicketCents: 0 })).price).toBe("$0.00");
    expect(presentOffer(makeOffer({ pricePerTicketCents: 50 })).price).toBe("$0.50");
    expect(presentOffer(makeOffer({ pricePerTicketCents: 100_000 })).price).toBe(
      "$1,000.00",
    );
  });

  it("keeps priceCents alongside the formatted price so downstream math is exact", () => {
    const view = presentOffer(makeOffer({ pricePerTicketCents: 4250 }));
    expect(view.priceCents).toBe(4250);
    expect(view.price).toBe("$42.50");
  });

  it("preserves the raw enum status (the UI branches on it; statusLabel-equivalents come later)", () => {
    const view = presentOffer(makeOffer({ status: "card_failure" }));
    expect(view.status).toBe("card_failure");
  });
});
