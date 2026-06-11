import { describe, expect, it } from "vitest";

import {
  buildTierMinRowRank,
  presentAllocationFinal,
  type AllocationFinalShow,
  type AllocationResultContext,
} from "./allocation-final";

import type { CardFailureRecoveryView } from "./card-failure";
import type { Offer, SeatAssignment } from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

const NOW = new Date("2026-05-20T12:00:00Z");
const TZ = "America/New_York";

const SHOW: AllocationFinalShow = {
  id: "show-1",
  artist: { name: "Citizen Cope" },
  venue: { name: "Brooklyn Bowl", city: "Brooklyn" },
  // 2026-05-25 20:00 ET (00:00Z next day). May 25 2026 is a Monday.
  doorsAt: new Date("2026-05-26T00:00:00Z"),
};

// Minimal offer/seat builders — only the fields the presenter reads. Cast
// through unknown so we don't have to satisfy every column of the row types.
function offer(overrides: Partial<Offer>): Offer {
  return {
    id: "offer-1",
    pricePerTicketCents: 4200,
    groupSize: 4,
    status: "charged",
    autoBidEnabled: false,
    autoBidCapCents: null,
    preferredTier: null,
    ...overrides,
  } as unknown as Offer;
}

function seat(overrides: Partial<SeatAssignment>): SeatAssignment {
  return {
    id: "seat-1",
    offerId: "offer-1",
    tier: "premium",
    seatNumbers: ["9", "11", "13", "15"],
    isBinding: true,
    chargedAmountCents: 16800,
    ...overrides,
  } as unknown as SeatAssignment;
}

const ROW = { area: "orchestra", rowName: "AA" } as const;

// Three-tier house: premium closest (rank 0), mid (10), rear (20).
const TIERS = { premium: 0, mid: 10, rear: 20 } as const;

function ctx(
  overrides: Partial<AllocationResultContext> = {},
): AllocationResultContext {
  return {
    poolCount: 412,
    capacity: 1200,
    tierMinRowRank: { ...TIERS },
    marginalPlacedCents: null,
    cardFailure: null,
    ...overrides,
  };
}

describe("presentAllocationFinal — placed", () => {
  it("renders a flat charged offer honestly: you offered $X, you pay $X, no under-cap", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "charged", preferredTier: "premium" }),
      seat({}),
      ROW,
      false,
      ctx(),
      NOW,
      TZ,
    );
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.artist).toBe("Citizen Cope");
    expect(v.dateLong).toBe("Mon · May 25 · 8pm");
    expect(v.seatLine).toBe("Orchestra · Row AA · seats 9–15");
    expect(v.size).toBe(4);
    // pay-as-bid: cap == paid == offer for a flat offer.
    expect(v.capDisplay).toBe("$42.00");
    expect(v.paidPerTicketDisplay).toBe("$42.00");
    expect(v.chargedTotalDisplay).toBe("$168.00"); // from chargedAmountCents
    expect(v.isAutoUnderCap).toBe(false);
    expect(v.underCapDisplay).toBeNull();
    expect(v.poolCount).toBe(412);
    expect(v.capacity).toBe(1200);
    expect(v.moveUpPosition).toBeNull();
    expect(v.ticketReady).toBe(false);
  });

  it("uses the REAL charged amount, never re-derived from the cap", () => {
    // chargedAmountCents diverges from price×size — the presenter must trust
    // the captured total, not recompute it.
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "charged", pricePerTicketCents: 4200, groupSize: 4 }),
      seat({ chargedAmountCents: 15600 }),
      ROW,
      false,
      ctx(),
      NOW,
      TZ,
    );
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.chargedTotalDisplay).toBe("$156.00");
    expect(v.paidPerTicketDisplay).toBe("$39.00");
  });

  it("falls back to price × size when a charged seat lacks chargedAmountCents", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "charged", pricePerTicketCents: 4200, groupSize: 4 }),
      seat({ chargedAmountCents: null }),
      ROW,
      true,
      ctx(),
      NOW,
      TZ,
    );
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.chargedTotalDisplay).toBe("$168.00");
    expect(v.paidPerTicketDisplay).toBe("$42.00");
    expect(v.ticketReady).toBe(true);
  });

  it("shows the auto-offer under-cap case: offered up to cap, settled below it", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({
        status: "charged",
        autoBidEnabled: true,
        autoBidCapCents: 5000, // offered up to $50
        pricePerTicketCents: 3900, // settled at $39
        groupSize: 4,
        preferredTier: "premium",
      }),
      seat({ tier: "premium", chargedAmountCents: 15600 }),
      ROW,
      false,
      ctx(),
      NOW,
      TZ,
    );
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.capDisplay).toBe("$50.00");
    expect(v.paidPerTicketDisplay).toBe("$39.00");
    expect(v.chargedTotalDisplay).toBe("$156.00");
    expect(v.isAutoUnderCap).toBe(true);
    expect(v.underCapDisplay).toBe("$11.00");
  });

  it("does not claim under-cap when an auto-offer settled exactly at its cap", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({
        status: "charged",
        autoBidEnabled: true,
        autoBidCapCents: 5000,
        pricePerTicketCents: 5000,
        groupSize: 4,
        preferredTier: "premium",
      }),
      seat({ tier: "premium", chargedAmountCents: 20000 }),
      ROW,
      false,
      ctx(),
      NOW,
      TZ,
    );
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.capDisplay).toBe("$50.00");
    expect(v.paidPerTicketDisplay).toBe("$50.00");
    expect(v.isAutoUnderCap).toBe(false);
    expect(v.underCapDisplay).toBeNull();
  });
});

describe("presentAllocationFinal — A/B state", () => {
  it("celebrates (in-room) when a named preference landed in its tier", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "charged", preferredTier: "premium" }),
      seat({ tier: "premium" }),
      ROW,
      false,
      ctx(),
      NOW,
      TZ,
    );
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.state).toBe("in-room");
  });

  it("celebrates (in-room) when landed closer than the named preference", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "charged", preferredTier: "mid" }),
      seat({ tier: "premium" }), // premium is closer than mid
      ROW,
      false,
      ctx(),
      NOW,
      TZ,
    );
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.state).toBe("in-room");
  });

  it("falls back when landed below the named preference", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "charged", preferredTier: "premium" }),
      seat({ tier: "rear" }),
      ROW,
      false,
      ctx(),
      NOW,
      TZ,
    );
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.state).toBe("fallback");
  });

  it("for an 'any' preference, celebrates only in the closest tier", () => {
    const inClosest = presentAllocationFinal(
      SHOW,
      offer({ status: "charged", preferredTier: null }),
      seat({ tier: "premium" }),
      ROW,
      false,
      ctx(),
      NOW,
      TZ,
    );
    const inLower = presentAllocationFinal(
      SHOW,
      offer({ status: "charged", preferredTier: null }),
      seat({ tier: "mid" }),
      ROW,
      false,
      ctx(),
      NOW,
      TZ,
    );
    if (inClosest?.kind !== "placed" || inLower?.kind !== "placed") {
      throw new Error("expected placed");
    }
    expect(inClosest.state).toBe("in-room");
    expect(inLower.state).toBe("fallback");
  });

  it("defaults to the gracious fallback when the tier rank is unknown", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "charged", preferredTier: "premium" }),
      seat({ tier: "balcony" }), // not in the rank map
      ROW,
      false,
      ctx(),
      NOW,
      TZ,
    );
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.state).toBe("fallback");
  });
});

describe("presentAllocationFinal — edges", () => {
  it("title-cases an unmapped tier in the seat line and tolerates a missing row", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "charged", preferredTier: "premium" }),
      seat({ tier: "front_balcony" }),
      null,
      false,
      ctx(),
      NOW,
      TZ,
    );
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.seatLine).toBe("Front Balcony · seats 9–15");
  });

  it("renders card_failure with the amount due, deadline label, and minutes left", () => {
    const recovery: CardFailureRecoveryView = {
      offerId: "offer-1",
      amountLabel: "$60.00",
      // 00:45Z on the 26th = 8:45pm ET on the 25th.
      deadlineIso: "2026-05-26T00:45:00.000Z",
      minutesLeft: 30,
    };
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "card_failure", pricePerTicketCents: 3000, groupSize: 2 }),
      seat({ isBinding: true }),
      ROW,
      false,
      ctx({ cardFailure: recovery }),
      NOW,
      TZ,
    );
    if (v?.kind !== "card_failure") throw new Error("expected card_failure");
    expect(v.size).toBe(2);
    expect(v.amountDueDisplay).toBe("$60.00");
    expect(v.deadlineLabel).toBe("8:45pm");
    expect(v.minutesLeft).toBe(30);
  });

  it("renders card_failure with a null deadline once the window has lapsed", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "card_failure", pricePerTicketCents: 3000, groupSize: 2 }),
      seat({ isBinding: true }),
      ROW,
      false,
      ctx({ cardFailure: null }),
      NOW,
      TZ,
    );
    if (v?.kind !== "card_failure") throw new Error("expected card_failure");
    expect(v.deadlineLabel).toBeNull();
    expect(v.minutesLeft).toBeNull();
  });

  it("renders a mid-recovery ('recovering') offer as the card_failure screen", () => {
    // The recovery claim lasts seconds; the result page must not flash to a
    // 404 while the replacement card is being charged.
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "recovering", pricePerTicketCents: 3000, groupSize: 2 }),
      seat({ isBinding: true }),
      ROW,
      false,
      ctx({ cardFailure: null }),
      NOW,
      TZ,
    );
    if (v?.kind !== "card_failure") throw new Error("expected card_failure");
    expect(v.amountDueDisplay).toBe("$60.00");
  });

  it("renders unplaced with the offer price, no charge, and the marginal price", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "unplaced", pricePerTicketCents: 2200, groupSize: 4 }),
      null,
      null,
      false,
      ctx({ marginalPlacedCents: 2400 }),
      NOW,
      TZ,
    );
    if (v?.kind !== "unplaced") throw new Error("expected unplaced");
    expect(v.offerPriceDisplay).toBe("$22.00");
    expect(v.size).toBe(4);
    expect(v.marginalDisplay).toBe("$24.00");
  });

  it("renders unplaced with a null marginal when nothing was placed", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "unplaced", pricePerTicketCents: 2200, groupSize: 4 }),
      null,
      null,
      false,
      ctx({ marginalPlacedCents: null }),
      NOW,
      TZ,
    );
    if (v?.kind !== "unplaced") throw new Error("expected unplaced");
    expect(v.marginalDisplay).toBeNull();
  });

  it("returns null for a pre-binding pool offer (no final result yet)", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "pool" }),
      null,
      null,
      false,
      ctx(),
      NOW,
      TZ,
    );
    expect(v).toBeNull();
  });

  it("returns null for a non-binding preview placement", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "placed" }),
      seat({ isBinding: false }),
      ROW,
      false,
      ctx(),
      NOW,
      TZ,
    );
    expect(v).toBeNull();
  });

  it("returns null once the offer has moved past the result (refunded/resold/gifted)", () => {
    for (const status of ["refunded", "resold", "gifted"] as const) {
      const v = presentAllocationFinal(
        SHOW,
        offer({ status }),
        seat({}),
        ROW,
        false,
        ctx(),
        NOW,
        TZ,
      );
      expect(v).toBeNull();
    }
  });
});

describe("buildTierMinRowRank", () => {
  function r(overrides: Partial<VenueRow>): VenueRow {
    return {
      id: "r",
      rowRank: 0,
      tier: "premium",
      ...overrides,
    } as unknown as VenueRow;
  }

  it("maps each tier to its closest (lowest) active row rank", () => {
    const map = buildTierMinRowRank(
      [
        r({ id: "a", tier: "premium", rowRank: 2 }),
        r({ id: "b", tier: "premium", rowRank: 0 }),
        r({ id: "c", tier: "mid", rowRank: 5 }),
        r({ id: "d", tier: "rear", rowRank: 9 }),
      ],
      ["a", "b", "c", "d"],
    );
    expect(map).toEqual({ premium: 0, mid: 5, rear: 9 });
  });

  it("ignores rows that aren't active for the show", () => {
    const map = buildTierMinRowRank(
      [
        r({ id: "a", tier: "premium", rowRank: 0 }),
        r({ id: "b", tier: "mid", rowRank: 5 }),
      ],
      ["b"], // premium row not active
    );
    expect(map).toEqual({ mid: 5 });
  });

  it("buckets untiered rows under an empty-string key", () => {
    // No `tier` property at all (untiered GA row).
    const untiered = { id: "a", rowRank: 3 } as unknown as VenueRow;
    const map = buildTierMinRowRank([untiered], ["a"]);
    expect(map).toEqual({ "": 3 });
  });
});
