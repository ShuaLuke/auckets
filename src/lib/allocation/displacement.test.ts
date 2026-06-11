import { describe, expect, it } from "vitest";

import type { offers } from "../../../drizzle/schema";

import type { AutoBidRaise } from "./auto-bid";
import {
  detectDisplacementEvents,
  type Placement,
} from "./displacement";

type Offer = typeof offers.$inferSelect;

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: "offer_1",
    showId: "44444444-4444-4444-4444-444444444444",
    userId: "user_1",
    channel: "market",
    groupSize: 4,
    pricePerTicketCents: 5000,
    tierPreference: "any",
    preferredTier: null,
    rankKey: BigInt(5000 * 1000 + 4),
    autoBidEnabled: false,
    autoBidCapCents: null,
    autoBidIncrementCents: 500,
    privateThresholdCents: null,
    stripePaymentMethodId: "pm_test",
    stripeSetupIntentId: "seti_test",
    stripePaymentIntentId: null,
    status: "pool",
    submittedAt: new Date("2026-05-26T12:00:00Z"),
    recoveringAt: null,
    revisedAt: null,
    ...overrides,
  };
}

// Tiers ranked by floor: premium (best) > mid > anything unknown/null.
const tierRank = (tier: string | null) =>
  ({ premium: 5000, mid: 3500 } as Record<string, number>)[tier ?? ""] ?? 0;

const placed = (tier: string, venueRowId = "row_a"): Placement => ({
  tier,
  venueRowId,
});

const noRaises: AutoBidRaise[] = [];
const noLastRaise = new Map<string, number>();

describe("detectDisplacementEvents", () => {
  it("emits outbid_out when a placed offer falls out of the event", () => {
    const offer = makeOffer({ id: "o1" });
    const events = detectDisplacementEvents({
      prevByOffer: new Map([["o1", placed("premium")]]),
      newByOffer: new Map(),
      autoBidRaises: noRaises,
      offers: [offer],
      lastRaiseToByOffer: noLastRaise,
      tierRank,
    });
    expect(events).toEqual([
      { offerId: "o1", userId: "user_1", kind: "outbid_out", detail: { fromTier: "premium" } },
    ]);
  });

  it("emits section_change marked 'worse' on a downward tier move", () => {
    const offer = makeOffer({ id: "o1" });
    const events = detectDisplacementEvents({
      prevByOffer: new Map([["o1", placed("premium")]]),
      newByOffer: new Map([["o1", placed("mid")]]),
      autoBidRaises: noRaises,
      offers: [offer],
      lastRaiseToByOffer: noLastRaise,
      tierRank,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "section_change",
      detail: { fromTier: "premium", toTier: "mid", direction: "worse" },
    });
  });

  it("emits section_change marked 'better' on an upward tier move", () => {
    const offer = makeOffer({ id: "o1" });
    const events = detectDisplacementEvents({
      prevByOffer: new Map([["o1", placed("mid")]]),
      newByOffer: new Map([["o1", placed("premium")]]),
      autoBidRaises: noRaises,
      offers: [offer],
      lastRaiseToByOffer: noLastRaise,
      tierRank,
    });
    expect(events[0]).toMatchObject({
      kind: "section_change",
      detail: { direction: "better" },
    });
  });

  it("emits no event when placement is unchanged and nothing was raised", () => {
    const offer = makeOffer({ id: "o1" });
    const events = detectDisplacementEvents({
      prevByOffer: new Map([["o1", placed("premium")]]),
      newByOffer: new Map([["o1", placed("premium")]]),
      autoBidRaises: noRaises,
      offers: [offer],
      lastRaiseToByOffer: noLastRaise,
      tierRank,
    });
    expect(events).toEqual([]);
  });

  it("emits auto_bid_raise for a placed auto-bidder whose target is new", () => {
    const offer = makeOffer({ id: "o1", autoBidEnabled: true, autoBidCapCents: 8000 });
    const events = detectDisplacementEvents({
      prevByOffer: new Map([["o1", placed("premium")]]),
      newByOffer: new Map([["o1", placed("premium")]]),
      autoBidRaises: [{ offerId: "o1", userId: "user_1", fromCents: 5000, toCents: 6500, steps: 3 }],
      offers: [offer],
      lastRaiseToByOffer: noLastRaise,
      tierRank,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "auto_bid_raise",
      detail: { fromCents: 5000, toCents: 6500, steps: 3, tier: "premium" },
    });
  });

  it("dedupes an auto_bid_raise whose target matches the last persisted raise", () => {
    const offer = makeOffer({ id: "o1", autoBidEnabled: true, autoBidCapCents: 8000 });
    const events = detectDisplacementEvents({
      prevByOffer: new Map([["o1", placed("premium")]]),
      newByOffer: new Map([["o1", placed("premium")]]),
      autoBidRaises: [{ offerId: "o1", userId: "user_1", fromCents: 5000, toCents: 6500, steps: 3 }],
      offers: [offer],
      lastRaiseToByOffer: new Map([["o1", 6500]]),
      tierRank,
    });
    expect(events).toEqual([]);
  });

  it("suppresses auto_bid_raise when the raise still left the fan unplaced (told as outbid_out instead)", () => {
    const offer = makeOffer({ id: "o1", autoBidEnabled: true, autoBidCapCents: 8000 });
    const events = detectDisplacementEvents({
      prevByOffer: new Map([["o1", placed("premium")]]),
      newByOffer: new Map(), // climbed to cap, still unplaced
      autoBidRaises: [{ offerId: "o1", userId: "user_1", fromCents: 5000, toCents: 8000, steps: 6 }],
      offers: [offer],
      lastRaiseToByOffer: noLastRaise,
      tierRank,
    });
    expect(events).toEqual([
      { offerId: "o1", userId: "user_1", kind: "outbid_out", detail: { fromTier: "premium" } },
    ]);
  });
});
