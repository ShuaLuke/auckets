import { describe, expect, it } from "vitest";

import { presentTicketView, type PresentTicketInput } from "./ticket";

function baseInput(overrides: Partial<PresentTicketInput> = {}): PresentTicketInput {
  return {
    artistName: "Citizen Cope",
    venueName: "Lincoln Theatre",
    venueCity: "Washington, DC",
    doorsAt: new Date("2026-06-25T00:00:00Z"),
    geoLat: "38.916700",
    geoLon: "-77.032300",
    geoRadiusM: 500,
    rows: [
      { id: "row_aa", rowName: "AA" },
      { id: "row_b", rowName: "B" },
    ],
    seatAssignment: {
      venueRowId: "row_aa",
      seatNumbers: ["7", "9", "11", "13"],
      tier: "premium",
      chargedAmountCents: 16_800,
    },
    ticket: { id: "tk_1", status: "issued" },
    ...overrides,
  };
}

describe("presentTicketView", () => {
  it("maps venueRowId to the human row name and formats the seat block", () => {
    const view = presentTicketView(baseInput());
    expect(view.seat.row).toBe("AA");
    expect(view.seat.seats).toBe("7 · 9 · 11 · 13");
    expect(view.seat.section).toBe("Premium");
    expect(view.seat.paid).toBe("$168.00");
    expect(view.dateLong).toEqual(expect.any(String));
    expect(view.dateLong.length).toBeGreaterThan(0);
    expect(view.ticketId).toBe("tk_1");
    expect(view.ticketStatus).toBe("issued");
  });

  it("keeps GA uppercased as the section label", () => {
    const view = presentTicketView(
      baseInput({
        seatAssignment: {
          venueRowId: "row_b",
          seatNumbers: ["1"],
          tier: "ga",
          chargedAmountCents: 5_000,
        },
      }),
    );
    expect(view.seat.section).toBe("GA");
  });

  it("parses NUMERIC-as-string coordinates into finite numbers", () => {
    const view = presentTicketView(baseInput());
    expect(view.geo.lat).toBeCloseTo(38.9167, 4);
    expect(view.geo.lon).toBeCloseTo(-77.0323, 4);
    expect(view.geo.radiusM).toBe(500);
  });

  it("returns null coordinates when the venue has none configured", () => {
    const view = presentTicketView(baseInput({ geoLat: null, geoLon: null }));
    expect(view.geo.lat).toBeNull();
    expect(view.geo.lon).toBeNull();
  });

  it("falls back to the raw row id when the architecture doesn't list it", () => {
    const view = presentTicketView(
      baseInput({
        seatAssignment: {
          venueRowId: "row_unknown",
          seatNumbers: ["3"],
          tier: "premium",
          chargedAmountCents: 4_200,
        },
      }),
    );
    expect(view.seat.row).toBe("row_unknown");
  });

  it("renders $0.00 and empty city when those are missing rather than crashing", () => {
    const view = presentTicketView(
      baseInput({
        venueCity: null,
        seatAssignment: {
          venueRowId: "row_aa",
          seatNumbers: ["7"],
          tier: "premium",
          chargedAmountCents: null,
        },
      }),
    );
    expect(view.city).toBe("");
    expect(view.seat.paid).toBe("$0.00");
  });
});
