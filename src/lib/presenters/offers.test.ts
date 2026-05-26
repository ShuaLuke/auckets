import { describe, expect, it } from "vitest";

import type {
  SeatAssignment,
  TicketStatus,
  TicketSummary,
} from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import type { offers } from "../../../drizzle/schema";

import {
  formatSeatAssignmentPreview,
  presentOffer,
  type OfferStatus,
  type OfferView,
} from "./offers";

type Offer = typeof offers.$inferSelect;

function makeAssignment(
  overrides: Partial<SeatAssignment> = {},
): SeatAssignment {
  return {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    offerId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    showId: "44444444-4444-4444-4444-444444444444",
    venueRowId: "row_aa",
    seatNumbers: ["7", "8", "9", "10"],
    tier: "premium",
    isBinding: false,
    stripePaymentIntentId: null,
    chargedAmountCents: null,
    cardFailureAt: null,
    createdAt: new Date("2026-05-26T12:00:00Z"),
    ...overrides,
  };
}

function makeRow(overrides: Partial<VenueRow> = {}): VenueRow {
  return {
    id: "row_aa",
    area: "orchestra",
    section: "main",
    rowName: "AA",
    rowRank: 2,
    capacity: 14,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
    holds: [],
    tier: "premium",
    ...overrides,
  };
}

function makeTicket(overrides: Partial<TicketSummary> = {}): TicketSummary {
  return {
    id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    seatAssignmentId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    userId: "user_2abc",
    status: "issued",
    scannedAt: null,
    scannedByStaffId: null,
    issuedAt: new Date("2026-05-23T20:00:00Z"),
    createdAt: new Date("2026-05-23T20:00:00Z"),
    ...overrides,
  };
}

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
      ticketReady: false,
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

  it("omits preview when no assignment is passed", () => {
    const view = presentOffer(makeOffer({ status: "placed" }));
    expect(view).not.toHaveProperty("preview");
  });

  it("omits preview when the architecture row isn't passed (treat as 'cannot resolve' rather than crash)", () => {
    const view = presentOffer(makeOffer(), makeAssignment(), null);
    expect(view).not.toHaveProperty("preview");
  });

  it("formats the preview matching the Dashboard.jsx mock literal", () => {
    // Matches `'Orchestra · Row AA · seats 7–10'` from Dashboard.jsx
    // line 17. En-dash (U+2013), not hyphen-minus.
    const view = presentOffer(makeOffer(), makeAssignment(), makeRow());
    expect(view.preview).toBe("Orchestra · Row AA · seats 7–10");
  });

  it("renders a single-seat assignment as 'seat N' (no range)", () => {
    const view = presentOffer(
      makeOffer({ groupSize: 1 }),
      makeAssignment({ seatNumbers: ["5"] }),
      makeRow(),
    );
    expect(view.preview).toBe("Orchestra · Row AA · seat 5");
  });

  it("maps each known area enum to its display label", () => {
    expect(
      formatSeatAssignmentPreview(makeAssignment(), makeRow({ area: "orchestra" })),
    ).toContain("Orchestra");
    expect(
      formatSeatAssignmentPreview(
        makeAssignment(),
        makeRow({ area: "front_balcony" }),
      ),
    ).toContain("Front Balcony");
    expect(
      formatSeatAssignmentPreview(
        makeAssignment(),
        makeRow({ area: "upper_balcony" }),
      ),
    ).toContain("Upper Balcony");
    expect(
      formatSeatAssignmentPreview(
        makeAssignment(),
        makeRow({ area: "ga", rowName: "GA" }),
      ),
    ).toContain("General Admission");
  });

  it("title-cases an unknown area as a fallback (snake_case → Title Case)", () => {
    // Defensive: AreaLabel is `(string & {})` so any string is valid.
    // The catch-all should produce something human-legible rather
    // than dumping the raw enum.
    expect(
      formatSeatAssignmentPreview(makeAssignment(), makeRow({ area: "mezzanine" })),
    ).toMatch(/^Mezzanine/);
    expect(
      formatSeatAssignmentPreview(
        makeAssignment(),
        makeRow({ area: "side_box" }),
      ),
    ).toMatch(/^Side Box/);
  });

  it("defaults ticketReady to false when no ticket is passed", () => {
    // The most common state pre-T-48h: assignment exists, ticket
    // row doesn't yet. False, not undefined — the UI branches on
    // this and undefined-as-falsy would be ambiguous with "didn't
    // load the data."
    const view = presentOffer(makeOffer({ status: "placed" }));
    expect(view.ticketReady).toBe(false);
  });

  it("marks ticketReady=true when the ticket exists and is issued (matches Dashboard.jsx row 1)", () => {
    // Dashboard.jsx Lincoln May 25 row: yourOffer.ticketReady = true.
    const view = presentOffer(
      makeOffer({ status: "placed" }),
      makeAssignment(),
      makeRow(),
      makeTicket({ status: "issued" }),
    );
    expect(view.ticketReady).toBe(true);
  });

  it("treats 'scanned' as ready (viewer can still show 'you're in' state)", () => {
    // A scanned ticket still has UI value — the viewer renders an
    // "Already scanned at HH:MM" confirmation instead of a fresh QR.
    // Marking it as ready keeps the same click target (ticket
    // viewer, not show page).
    const view = presentOffer(
      makeOffer({ status: "charged" }),
      makeAssignment(),
      makeRow(),
      makeTicket({ status: "scanned", scannedAt: new Date() }),
    );
    expect(view.ticketReady).toBe(true);
  });

  it("does NOT mark resold/gifted/expired tickets as ready", () => {
    // Seat no longer belongs to this fan, or the QR is no longer
    // scannable. Click target should be the show page, not the
    // ticket viewer.
    const notReady: TicketStatus[] = ["resold", "gifted", "expired"];
    for (const status of notReady) {
      const view = presentOffer(
        makeOffer({ status: "charged" }),
        makeAssignment(),
        makeRow(),
        makeTicket({ status }),
      );
      expect(view.ticketReady, `status=${status}`).toBe(false);
    }
  });

  it("includes ticketReady even when no assignment/row is passed (always present)", () => {
    // Just an offer, no placement, no ticket — ticketReady is still
    // an explicit `false`, not omitted. The UI's `s.yourOffer?.ticketReady`
    // branch keys on the boolean and we don't want to depend on
    // undefined coercion.
    const view = presentOffer(makeOffer({ status: "pool" }));
    expect(view).toHaveProperty("ticketReady", false);
  });
});
