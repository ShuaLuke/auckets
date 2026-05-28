import { describe, expect, it } from "vitest";

import type {
  SeatAssignment,
  ShowSummary,
  ShowWithRelations,
  TicketSummary,
} from "@/lib/db/repositories";

import type { offers } from "../../../drizzle/schema";

import {
  presentShowDetail,
  presentShowSummary,
  type ShowDetailView,
  type ShowSummaryView,
} from "./shows";

type Offer = typeof offers.$inferSelect;

function makeAssignment(
  overrides: Partial<SeatAssignment> = {},
): SeatAssignment {
  return {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    offerId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    showId: "44444444-4444-4444-4444-444444444444",
    venueRowId: "row_a",
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
    stripePaymentIntentId: null,
    status: "pool",
    submittedAt: new Date("2026-05-26T12:00:00Z"),
    revisedAt: null,
    ...overrides,
  };
}

// All fixtures pin America/New_York. Real production callers will pin it
// at the route boundary; tests do the same to keep formatting assertions
// deterministic regardless of CI host TZ.

function makeSummary(overrides: Partial<ShowSummary> = {}): ShowSummary {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    artistId: "11111111-1111-1111-1111-111111111111",
    venueId: "22222222-2222-2222-2222-222222222222",
    venueArchitectureId: "33333333-3333-3333-3333-333333333333",
    status: "open",
    // Saturday June 13, 2026 9pm EDT.
    doorsAt: new Date("2026-06-13T21:00:00-04:00"),
    offerWindowOpensAt: new Date("2026-05-25T16:00:00-04:00"),
    bindingAllocationAt: new Date("2026-06-12T21:00:00-04:00"),
    pausedAt: null,
    activeRowIds: ["row_a", "row_b"],
    artistName: "Citizen Cope",
    venueName: "Cope's place",
    venueCity: "Brooklyn, NY",
    ...overrides,
  };
}

function makeShowWithRelations(
  overrides: Partial<ShowWithRelations> = {},
): ShowWithRelations {
  const summary = makeSummary();
  return {
    id: summary.id,
    artistId: summary.artistId,
    venueId: summary.venueId,
    venueArchitectureId: summary.venueArchitectureId,
    doorsAt: summary.doorsAt,
    offerWindowOpensAt: summary.offerWindowOpensAt,
    bindingAllocationAt: summary.bindingAllocationAt,
    pausedAt: null,
    status: "open",
    tierFloorsCents: { premium: 6000, mid: 4000, rear: 2500 },
    maxGroupSize: 10,
    activeRowIds: ["row_a", "row_aa", "row_b"],
    bleacherEnabled: false,
    bleacherCapacity: 0,
    bleacherPriceCents: null,
    showHolds: [],
    emailCustomization: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    artist: {
      id: summary.artistId,
      name: "Citizen Cope",
      slug: "citizen-cope",
      stripeConnectId: null,
      createdAt: new Date("2026-05-01T00:00:00Z"),
    },
    venue: {
      id: summary.venueId,
      name: "Cope's place",
      city: "Brooklyn, NY",
      geoLat: null,
      geoLon: null,
      geoRadiusM: 500,
      createdAt: new Date("2026-05-01T00:00:00Z"),
    },
    venueArchitecture: {
      id: summary.venueArchitectureId,
      venueId: summary.venueId,
      version: 1,
      rows: [
        {
          id: "row_a",
          area: "orchestra",
          section: "MAIN",
          rowName: "A",
          rowRank: 1,
          capacity: 14,
          parity: "ODD",
          lean: "CENTER",
          seatNumbers: ["1", "3", "5", "7"],
          holds: [],
          tier: "premium",
        },
      ],
      createdAt: new Date("2026-05-01T00:00:00Z"),
    },
    ...overrides,
  };
}

describe("presentShowSummary", () => {
  it("maps the prototype's open-show fields field-for-field", () => {
    // Now: May 28 2026, between offer window open (May 25) and binding
    // allocation (Jun 12). Binding is ~15 days out.
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentShowSummary(makeSummary(), now);

    expect(view).toEqual<ShowSummaryView>({
      id: "44444444-4444-4444-4444-444444444444",
      artist: "Citizen Cope",
      venue: "Cope's place",
      city: "Brooklyn, NY",
      dateLong: "Sat · Jun 13 · 9pm",
      dateShort: "Jun 13",
      status: "open",
      statusLabel: "Offers open",
      closes: "15d until binding",
    });
  });

  it("keeps status as the raw enum string (not a label) so the UI can branch on it", () => {
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentShowSummary(
      makeSummary({ status: "paused" }),
      now,
    );
    expect(view.status).toBe("paused");
    expect(view.statusLabel).toBe("Paused");
  });

  it("renders 'Offers open <date>' + bare day countdown when offer window hasn't opened yet", () => {
    // Pre-window: now is BEFORE offerWindowOpensAt.
    const summary = makeSummary({
      offerWindowOpensAt: new Date("2026-06-18T16:00:00-04:00"),
    });
    const now = new Date("2026-05-26T12:00:00-04:00");
    const view = presentShowSummary(summary, now);

    // Matches Dashboard.jsx row 3: statusLabel "Offers open Jun 18", closes "23d"
    expect(view.statusLabel).toBe("Offers open Jun 18");
    expect(view.closes).toBe("23d");
  });

  it("uses 'until binding' suffix when the window is open and binding is hours away", () => {
    // Now: 23h before binding allocation.
    const summary = makeSummary();
    const now = new Date(
      summary.bindingAllocationAt.getTime() - 23 * 3_600_000,
    );
    const view = presentShowSummary(summary, now);
    expect(view.closes).toBe("23h until binding");
  });

  it("blanks 'closes' for post-binding statuses (closed/allocated/etc) — those need per-user data in slice 4", () => {
    const summary = makeSummary({ status: "allocated" });
    const now = new Date("2026-06-12T22:00:00-04:00");
    const view = presentShowSummary(summary, now);
    expect(view.closes).toBe("");
    expect(view.statusLabel).toBe("Allocated");
  });

  it("maps every documented status enum to a non-empty label", () => {
    const now = new Date("2026-05-28T16:00:00-04:00");
    const expectations: Array<[ShowSummary["status"], string]> = [
      ["draft", "Draft"],
      ["open", "Offers open"],
      ["paused", "Paused"],
      ["closed", "Closed"],
      ["allocating", "Allocating"],
      ["allocated", "Allocated"],
      ["complete", "Complete"],
    ];
    for (const [status, label] of expectations) {
      const view = presentShowSummary(makeSummary({ status }), now);
      expect(view.statusLabel, `status=${status}`).toBe(label);
    }
  });

  it("preserves null city (some venues may lack city in the seed)", () => {
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentShowSummary(
      makeSummary({ venueCity: null }),
      now,
    );
    expect(view.city).toBeNull();
  });

  it("omits yourOffer when no userOffer is passed (matches Dashboard.jsx null case)", () => {
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentShowSummary(makeSummary(), now);
    expect(view).not.toHaveProperty("yourOffer");
  });

  it("omits yourOffer when userOffer is explicitly null", () => {
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentShowSummary(
      makeSummary(),
      now,
      undefined,
      null,
    );
    expect(view).not.toHaveProperty("yourOffer");
  });

  it("attaches yourOffer when the caller has an offer on this show", () => {
    // Matches Dashboard.jsx row 1: status open + a yourOffer payload.
    const now = new Date("2026-05-28T16:00:00-04:00");
    const offer = makeOffer({
      pricePerTicketCents: 4200,
      groupSize: 4,
      status: "placed",
    });
    const view = presentShowSummary(makeSummary(), now, undefined, offer);
    expect(view.yourOffer).toEqual({
      priceCents: 4200,
      price: "$42.00",
      size: 4,
      status: "placed",
      placed: true,
      ticketReady: false,
    });
  });

  it("attaches yourOffer.preview when assignment + row are passed (matches Dashboard.jsx row 1)", () => {
    const now = new Date("2026-05-28T16:00:00-04:00");
    const offer = makeOffer({ status: "placed" });
    const assignment = makeAssignment();
    const view = presentShowSummary(
      makeSummary(),
      now,
      undefined,
      offer,
      assignment,
      { area: "orchestra", rowName: "AA" },
    );
    expect(view.yourOffer?.preview).toBe("Orchestra · Row AA · seats 7–10");
  });

  it("omits yourOffer.preview when only the assignment (no row) is passed", () => {
    const now = new Date("2026-05-28T16:00:00-04:00");
    const offer = makeOffer({ status: "placed" });
    const view = presentShowSummary(
      makeSummary(),
      now,
      undefined,
      offer,
      makeAssignment(),
      null,
    );
    expect(view.yourOffer).toBeDefined();
    expect(view.yourOffer).not.toHaveProperty("preview");
  });

  it("threads ticketReady through to yourOffer when a ticket is passed", () => {
    const now = new Date("2026-05-28T16:00:00-04:00");
    const offer = makeOffer({ status: "placed" });
    const view = presentShowSummary(
      makeSummary(),
      now,
      undefined,
      offer,
      makeAssignment(),
      { area: "orchestra", rowName: "AA" },
      makeTicket({ status: "issued" }),
    );
    expect(view.yourOffer?.ticketReady).toBe(true);
  });

  it("defaults ticketReady=false when only the offer is passed (no ticket loaded yet)", () => {
    const now = new Date("2026-05-28T16:00:00-04:00");
    const offer = makeOffer({ status: "placed" });
    const view = presentShowSummary(makeSummary(), now, undefined, offer);
    expect(view.yourOffer?.ticketReady).toBe(false);
  });
});

describe("presentShowDetail", () => {
  it("maps the Show.jsx prototype fields, including the structural composer data", () => {
    // Now: ~24h before binding so countdown is days-scale.
    const show = makeShowWithRelations();
    const now = new Date(
      show.bindingAllocationAt.getTime() - 23 * 3_600_000 - 14 * 60_000,
    );
    const view = presentShowDetail(show, now);

    expect(view).toEqual<ShowDetailView>({
      id: show.id,
      artist: "Citizen Cope",
      venue: "Cope's place",
      city: "Brooklyn, NY",
      dateLong: "Sat · Jun 13 · 9pm",
      status: "open",
      statusLabel: "Offers open",
      // Matches Show.jsx "Binding allocation runs in 23h 14m" — the prefix
      // text lives in the JSX; the presenter just provides the bare unit.
      bindingCountdown: "23h 14m",
      tierFloorsCents: { premium: 6000, mid: 4000, rear: 2500 },
      maxGroupSize: 10,
      activeRowIds: ["row_a", "row_aa", "row_b"],
      bleacherEnabled: false,
      bleacherCapacity: 0,
      bleacherPriceCents: null,
      venueArchitecture: {
        id: show.venueArchitecture.id,
        version: 1,
        rows: show.venueArchitecture.rows,
      },
    });
  });

  it("rounds bindingCountdown to 'now' once the target passes", () => {
    const show = makeShowWithRelations();
    const now = new Date(show.bindingAllocationAt.getTime() + 60_000);
    const view = presentShowDetail(show, now);
    expect(view.bindingCountdown).toBe("now");
  });

  it("carries bleacher fields through unchanged when bleacher is enabled", () => {
    const show = makeShowWithRelations({
      bleacherEnabled: true,
      bleacherCapacity: 40,
      bleacherPriceCents: 1500,
    });
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentShowDetail(show, now);
    expect(view.bleacherEnabled).toBe(true);
    expect(view.bleacherCapacity).toBe(40);
    expect(view.bleacherPriceCents).toBe(1500);
  });

  it("does not return Date objects or ISO strings (everything is presenter-formatted)", () => {
    const show = makeShowWithRelations();
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentShowDetail(show, now);
    for (const key of Object.keys(view) as Array<keyof ShowDetailView>) {
      expect(view[key], `${key} should not be a Date`).not.toBeInstanceOf(
        Date,
      );
    }
  });

  it("omits yourOffer when no userOffer is passed", () => {
    const show = makeShowWithRelations();
    const now = new Date("2026-05-28T16:00:00-04:00");
    const view = presentShowDetail(show, now);
    expect(view).not.toHaveProperty("yourOffer");
  });

  it("attaches yourOffer for the offer composer to pre-populate", () => {
    const show = makeShowWithRelations();
    const now = new Date("2026-05-28T16:00:00-04:00");
    const offer = makeOffer({
      pricePerTicketCents: 6000,
      groupSize: 2,
      status: "pool",
    });
    const view = presentShowDetail(show, now, undefined, offer);
    expect(view.yourOffer).toEqual({
      priceCents: 6000,
      price: "$60.00",
      size: 2,
      status: "pool",
      placed: false,
      ticketReady: false,
    });
  });

  it("resolves yourOffer.preview from show.venueArchitecture.rows without an external row lookup", () => {
    // Detail path: architecture is in scope, so the presenter finds the
    // row itself. Caller passes only the assignment.
    const show = makeShowWithRelations();
    const now = new Date("2026-05-28T16:00:00-04:00");
    const offer = makeOffer({ status: "placed" });
    // Row "row_a" is the one defined in makeShowWithRelations.
    const assignment = makeAssignment({
      venueRowId: "row_a",
      seatNumbers: ["1", "3", "5", "7"],
    });
    const view = presentShowDetail(show, now, undefined, offer, assignment);
    expect(view.yourOffer?.preview).toBe("Orchestra · Row A · seats 1–7");
  });

  it("omits yourOffer.preview when the assignment references a row not in the architecture", () => {
    // Edge case: schema mismatch. Don't crash — just skip the preview.
    const show = makeShowWithRelations();
    const now = new Date("2026-05-28T16:00:00-04:00");
    const offer = makeOffer({ status: "placed" });
    const view = presentShowDetail(
      show,
      now,
      undefined,
      offer,
      makeAssignment({ venueRowId: "row_does_not_exist" }),
    );
    expect(view.yourOffer).toBeDefined();
    expect(view.yourOffer).not.toHaveProperty("preview");
  });

  it("threads ticketReady through to yourOffer when a ticket is passed", () => {
    const show = makeShowWithRelations();
    const now = new Date("2026-05-28T16:00:00-04:00");
    const offer = makeOffer({ status: "charged" });
    const view = presentShowDetail(
      show,
      now,
      undefined,
      offer,
      makeAssignment({ venueRowId: "row_a" }),
      makeTicket({ status: "issued" }),
    );
    expect(view.yourOffer?.ticketReady).toBe(true);
  });
});
