import { describe, expect, it } from "vitest";

import type { VenueArchitecture as DbVenueArchitecture } from "@/lib/db/repositories";
import type { AllocationConfig, VenueRow } from "@/lib/gae/types";

import type { offers, shows } from "../../../drizzle/schema";

import { resolveAutoBids } from "./auto-bid";

type Offer = typeof offers.$inferSelect;
type Show = typeof shows.$inferSelect;

function makeRow(overrides: Partial<VenueRow> = {}): VenueRow {
  return {
    id: "prem",
    area: "orchestra",
    section: "main",
    rowName: "A",
    rowRank: 1,
    capacity: 1,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: ["1"],
    holds: [],
    tier: "premium",
    ...overrides,
  };
}

function makeArch(rows: VenueRow[]): DbVenueArchitecture {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    venueId: "22222222-2222-2222-2222-222222222222",
    version: 1,
    rows,
    createdAt: new Date("2026-05-01T00:00:00Z"),
  };
}

function makeShow(activeRowIds: string[]): Show {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    artistId: "11111111-1111-1111-1111-111111111111",
    venueId: "22222222-2222-2222-2222-222222222222",
    venueArchitectureId: "33333333-3333-3333-3333-333333333333",
    doorsAt: new Date("2026-06-25T00:00:00Z"),
    offerWindowOpensAt: new Date("2026-05-25T00:00:00Z"),
    bindingAllocationAt: new Date("2026-06-24T00:00:00Z"),
    pausedAt: null,
    status: "open",
    tierFloorsCents: { premium: 5000, mid: 3500 },
    maxGroupSize: 10,
    activeRowIds,
    bleacherEnabled: false,
    bleacherCapacity: 0,
    bleacherPriceCents: null,
    showHolds: [],
    emailCustomization: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
  };
}

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  const merged: Offer = {
    id: "offer_1",
    showId: "44444444-4444-4444-4444-444444444444",
    userId: "user_1",
    channel: "market",
    groupSize: 1,
    pricePerTicketCents: 6000,
    tierPreference: "specific",
    preferredTier: "premium",
    rankKey: BigInt(6000 * 1000 + 1),
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
  // Keep rankKey consistent with price/size unless explicitly overridden.
  if (overrides.rankKey === undefined) {
    merged.rankKey = BigInt(merged.pricePerTicketCents * 1000 + merged.groupSize);
  }
  return merged;
}

const config: AllocationConfig = {
  mode: "preview",
  allowOrphans: true,
  orphanPolicy: "leave",
  maxGroupSize: 10,
};

describe("resolveAutoBids", () => {
  it("leaves the pool untouched when no offer has auto-bid", () => {
    const offers = [
      makeOffer({ id: "A", pricePerTicketCents: 6000 }),
      makeOffer({ id: "B", pricePerTicketCents: 5300 }),
    ];
    const { offers: resolved, raises } = resolveAutoBids(
      makeShow(["prem"]),
      makeArch([makeRow({ capacity: 1, seatNumbers: ["1"] })]),
      offers,
      config,
    );
    expect(raises).toEqual([]);
    expect(resolved.map((o) => o.pricePerTicketCents)).toEqual([6000, 5300]);
  });

  it("climbs a displaced auto-bidder in $5 steps until it reclaims its preferred section", () => {
    // One premium seat. A (no auto-bid) holds it at $60. B has auto-bid up
    // to $70: it should climb 53 → 58 → 63 to outrank A and take premium.
    const A = makeOffer({
      id: "A",
      pricePerTicketCents: 6000,
      submittedAt: new Date("2026-05-26T10:00:00Z"),
    });
    const B = makeOffer({
      id: "B",
      pricePerTicketCents: 5300,
      autoBidEnabled: true,
      autoBidCapCents: 7000,
      autoBidIncrementCents: 500,
      submittedAt: new Date("2026-05-26T11:00:00Z"),
    });
    const { offers: resolved, raises } = resolveAutoBids(
      makeShow(["prem"]),
      makeArch([makeRow({ capacity: 1, seatNumbers: ["1"] })]),
      [A, B],
      config,
    );

    const rb = resolved.find((o) => o.id === "B");
    const ra = resolved.find((o) => o.id === "A");
    expect(rb?.pricePerTicketCents).toBe(6300);
    expect(rb?.rankKey).toBe(BigInt(6300 * 1000 + 1));
    expect(ra?.pricePerTicketCents).toBe(6000); // non-auto-bidder untouched
    expect(raises).toEqual([
      { offerId: "B", userId: "user_1", fromCents: 5300, toCents: 6300, steps: 2 },
    ]);
  });

  it("stops at the cap when the section can't be reclaimed within it", () => {
    const A = makeOffer({
      id: "A",
      pricePerTicketCents: 6000,
      submittedAt: new Date("2026-05-26T10:00:00Z"),
    });
    const B = makeOffer({
      id: "B",
      pricePerTicketCents: 5300,
      autoBidEnabled: true,
      autoBidCapCents: 6000, // can't exceed A's 6000 → never reclaims premium
      autoBidIncrementCents: 500,
      submittedAt: new Date("2026-05-26T11:00:00Z"),
    });
    const { offers: resolved, raises } = resolveAutoBids(
      makeShow(["prem"]),
      makeArch([makeRow({ capacity: 1, seatNumbers: ["1"] })]),
      [A, B],
      config,
    );
    const rb = resolved.find((o) => o.id === "B");
    // 53 → 58 (one step); 63 would exceed the $60 cap, so it holds at 58.
    expect(rb?.pricePerTicketCents).toBe(5800);
    expect(raises).toEqual([
      { offerId: "B", userId: "user_1", fromCents: 5300, toCents: 5800, steps: 1 },
    ]);
  });

  it("does not raise an auto-bidder already seated in its preferred section", () => {
    // Two premium seats — both fit, so B is never displaced.
    const A = makeOffer({ id: "A", pricePerTicketCents: 6000 });
    const B = makeOffer({
      id: "B",
      pricePerTicketCents: 5300,
      autoBidEnabled: true,
      autoBidCapCents: 7000,
    });
    const { offers: resolved, raises } = resolveAutoBids(
      makeShow(["prem"]),
      makeArch([makeRow({ capacity: 2, seatNumbers: ["1", "2"] })]),
      [A, B],
      config,
    );
    expect(raises).toEqual([]);
    expect(resolved.find((o) => o.id === "B")?.pricePerTicketCents).toBe(5300);
  });

  it("does not raise an 'any'-preference auto-bidder that merely waterfalls to a worse tier", () => {
    // A takes the single premium seat; B ('any') waterfalls into mid and is
    // placed there. 'any' has no preferred section, so a worse-tier seat is
    // not a displacement — no spend.
    const A = makeOffer({
      id: "A",
      pricePerTicketCents: 6000,
      submittedAt: new Date("2026-05-26T10:00:00Z"),
    });
    const B = makeOffer({
      id: "B",
      pricePerTicketCents: 5300,
      tierPreference: "any",
      preferredTier: null,
      autoBidEnabled: true,
      autoBidCapCents: 7000,
      submittedAt: new Date("2026-05-26T11:00:00Z"),
    });
    const { offers: resolved, raises } = resolveAutoBids(
      makeShow(["prem", "mid"]),
      makeArch([
        makeRow({ id: "prem", capacity: 1, seatNumbers: ["1"], tier: "premium", rowRank: 1 }),
        makeRow({ id: "mid", capacity: 1, seatNumbers: ["m1"], tier: "mid", rowRank: 2 }),
      ]),
      [A, B],
      config,
    );
    expect(raises).toEqual([]);
    expect(resolved.find((o) => o.id === "B")?.pricePerTicketCents).toBe(5300);
  });
});
