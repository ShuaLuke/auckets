import { describe, expect, it } from "vitest";

import {
  presentAllocationFinal,
  type AllocationFinalShow,
} from "./allocation-final";

import type { Offer, SeatAssignment } from "@/lib/db/repositories";

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

describe("presentAllocationFinal", () => {
  it("renders the placed/charged outcome with split seat fields and captured total", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "charged" }),
      seat({}),
      ROW,
      false,
      NOW,
      TZ,
    );
    expect(v?.kind).toBe("placed");
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.artist).toBe("Citizen Cope");
    expect(v.venue).toBe("Brooklyn Bowl");
    expect(v.city).toBe("Brooklyn");
    expect(v.dateLong).toBe("Mon · May 25 · 8pm");
    expect(v.tierLabel).toBe("Premium");
    expect(v.rowName).toBe("AA");
    expect(v.seats).toBe("9 · 11 · 13 · 15");
    expect(v.size).toBe(4);
    expect(v.pricePerTicket).toBe("$42.00");
    expect(v.chargedTotal).toBe("$168.00"); // from chargedAmountCents, not price×size
    expect(v.ticketReady).toBe(false);
  });

  it("falls back to price × size when a charged seat lacks chargedAmountCents", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "charged", pricePerTicketCents: 4200, groupSize: 4 }),
      seat({ chargedAmountCents: null }),
      ROW,
      true,
      NOW,
      TZ,
    );
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.chargedTotal).toBe("$168.00");
    expect(v.ticketReady).toBe(true);
  });

  it("title-cases an unmapped tier and tolerates a missing architecture row", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "charged" }),
      seat({ tier: "front_balcony" }),
      null,
      false,
      NOW,
      TZ,
    );
    if (v?.kind !== "placed") throw new Error("expected placed");
    expect(v.tierLabel).toBe("Front Balcony");
    expect(v.rowName).toBe("");
  });

  it("renders the card_failure outcome with the amount due", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "card_failure", pricePerTicketCents: 3000, groupSize: 2 }),
      seat({ isBinding: true }),
      ROW,
      false,
      NOW,
      TZ,
    );
    expect(v?.kind).toBe("card_failure");
    if (v?.kind !== "card_failure") throw new Error("expected card_failure");
    expect(v.size).toBe(2);
    expect(v.amountDue).toBe("$60.00");
  });

  it("renders the unplaced outcome with offer price and no charge", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "unplaced", pricePerTicketCents: 2200, groupSize: 4 }),
      null,
      null,
      false,
      NOW,
      TZ,
    );
    expect(v?.kind).toBe("unplaced");
    if (v?.kind !== "unplaced") throw new Error("expected unplaced");
    expect(v.offerPrice).toBe("$22.00");
    expect(v.size).toBe(4);
  });

  it("returns null for a pre-binding pool offer (no final result yet)", () => {
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "pool" }),
      null,
      null,
      false,
      NOW,
      TZ,
    );
    expect(v).toBeNull();
  });

  it("returns null for a non-binding preview placement", () => {
    // A preview run can mark an offer 'placed' with a non-binding seat; that
    // is not a final outcome — the result page must 404.
    const v = presentAllocationFinal(
      SHOW,
      offer({ status: "placed" }),
      seat({ isBinding: false }),
      ROW,
      false,
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
        NOW,
        TZ,
      );
      expect(v).toBeNull();
    }
  });
});
