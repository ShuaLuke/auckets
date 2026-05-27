import { describe, expect, it } from "vitest";

import type { UserBidRow } from "@/lib/db/repositories";

import { presentBidView, type BidView } from "./bids";

function makeRow(overrides: {
  offer?: Partial<UserBidRow["offer"]>;
  show?: Partial<UserBidRow["show"]>;
} = {}): UserBidRow {
  return {
    offer: {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      showId: "44444444-4444-4444-4444-444444444444",
      userId: "user_2abc",
      channel: "market",
      groupSize: 4,
      pricePerTicketCents: 4200,
      tierPreference: "this_or_worse",
      preferredTier: "premium",
      rankKey: BigInt(4200 * 1000 + 4),
      autoBidEnabled: false,
      autoBidCapCents: null,
      autoBidIncrementCents: 500,
      privateThresholdCents: null,
      stripePaymentMethodId: "pm_test",
      stripeSetupIntentId: "seti_test",
      status: "pool",
      submittedAt: new Date("2026-05-26T19:00:00Z"),
      revisedAt: null,
      ...overrides.offer,
    } as UserBidRow["offer"],
    show: {
      id: "44444444-4444-4444-4444-444444444444",
      status: "open",
      doorsAt: new Date("2026-06-25T13:27:42Z"),
      bindingAllocationAt: new Date("2026-06-24T13:27:42Z"),
      pausedAt: null,
      artistName: "Citizen Cope",
      venueName: "Cope's place",
      venueCity: "Brooklyn, NY",
      ...overrides.show,
    },
  };
}

describe("presentBidView", () => {
  it("formats price, total, and dates correctly", () => {
    const view = presentBidView(makeRow());
    expect(view.pricePerTicket).toBe("$42.00");
    expect(view.totalIfPlaced).toBe("$168.00"); // 4 × $42
    expect(view.groupSize).toBe(4);
    // The doorsAt is 2026-06-25 13:27 UTC = 9:27 AM ET (DST in effect).
    // Just check the string contains the expected parts; full format
    // is covered by format.test.ts.
    expect(view.dateLong).toContain("Jun 25");
    expect(view.dateShort).toBe("Jun 25");
  });

  it("maps tier preferences to the composer's labels", () => {
    expect(
      presentBidView(
        makeRow({
          offer: { tierPreference: "specific", preferredTier: "premium" },
        }),
      ).tierLabel,
    ).toBe("Premium only");
    expect(
      presentBidView(
        makeRow({
          offer: { tierPreference: "this_or_worse", preferredTier: "premium" },
        }),
      ).tierLabel,
    ).toBe("Premium or below");
    expect(
      presentBidView(
        makeRow({
          offer: { tierPreference: "any", preferredTier: null },
        }),
      ).tierLabel,
    ).toBe("Anywhere I fit");
  });

  it("renders 'Premium or above' for the deferred this_or_better option if it ever surfaces", () => {
    const view = presentBidView(
      makeRow({
        offer: { tierPreference: "this_or_better", preferredTier: "premium" },
      }),
    );
    expect(view.tierLabel).toBe("Premium or above");
  });

  it("uses fan-friendly labels for offer status", () => {
    expect(
      presentBidView(makeRow({ offer: { status: "pool" } })).offerStatusLabel,
    ).toBe("In pool");
    expect(
      presentBidView(makeRow({ offer: { status: "placed" } })).offerStatusLabel,
    ).toBe("Placed");
    expect(
      presentBidView(makeRow({ offer: { status: "unplaced" } })).offerStatusLabel,
    ).toBe("Not placed");
    expect(
      presentBidView(makeRow({ offer: { status: "charged" } })).offerStatusLabel,
    ).toBe("Ticket purchased");
  });

  it("surfaces a show-status hint when the show is no longer open", () => {
    expect(presentBidView(makeRow()).showStatusHint).toBeNull();
    expect(
      presentBidView(makeRow({ show: { status: "paused" } })).showStatusHint,
    ).toBe("Offers paused");
    expect(
      presentBidView(makeRow({ show: { status: "complete" } })).showStatusHint,
    ).toBe("Show complete");
  });

  it("marks isRevised + carries a revisedDisplay when revisedAt is set", () => {
    const revisedAt = new Date("2026-05-26T20:30:00Z");
    const view = presentBidView(
      makeRow({ offer: { revisedAt } }),
    );
    expect(view.isRevised).toBe(true);
    expect(view.revisedDisplay).toBeTruthy();
  });

  it("leaves revisedDisplay null when the offer hasn't been revised", () => {
    const view = presentBidView(makeRow());
    expect(view.isRevised).toBe(false);
    expect(view.revisedDisplay).toBeNull();
  });

  it("matches the declared BidView type", () => {
    const view: BidView = presentBidView(makeRow());
    expect(view.offerId).toBeTruthy();
    expect(view.showId).toBeTruthy();
  });
});
