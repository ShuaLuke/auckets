import { describe, expect, it } from "vitest";

import { presentFanVenuePreview } from "./venue-preview";
import type { VenueRow } from "@/lib/gae/types";

function makeRow(overrides: Partial<VenueRow> & Pick<VenueRow, "id" | "rowName" | "rowRank">): VenueRow {
  return {
    area: "orchestra",
    section: "main",
    capacity: 4,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: ["1", "2", "3", "4"],
    holds: [],
    ...overrides,
  };
}

const A = makeRow({ id: "row_a", rowName: "A", rowRank: 1, tier: "premium" });
const B = makeRow({ id: "row_b", rowName: "B", rowRank: 2, tier: "premium" });
const M = makeRow({ id: "row_m", rowName: "M", rowRank: 5, tier: "mid" });

describe("presentFanVenuePreview", () => {
  it("returns sections in rowRank order, grouped by tier", () => {
    const view = presentFanVenuePreview({ rows: [M, A, B] }, null, [], null);
    expect(view.sections.map((s) => s.tier)).toEqual(["Premium", "Mid"]);
    expect(view.sections[0]?.rows.map((r) => r.rowName)).toEqual(["A", "B"]);
    expect(view.sections[1]?.rows.map((r) => r.rowName)).toEqual(["M"]);
  });

  it("filters to activeRowIds when provided (NEW-4 partial-venue activation)", () => {
    const view = presentFanVenuePreview(
      { rows: [A, B, M] },
      ["row_a", "row_m"],
      [],
      null,
    );
    const rowNames = view.sections.flatMap((s) => s.rows.map((r) => r.rowName));
    expect(rowNames).toEqual(["A", "M"]);
  });

  it("marks every seat 'unfilled' when there are no assignments and no user placement", () => {
    const view = presentFanVenuePreview({ rows: [A] }, null, [], null);
    const seats = view.sections[0]!.rows[0]!.seats;
    expect(seats.every((s) => s.status === "unfilled")).toBe(true);
    expect(view.hasYourPlacement).toBe(false);
  });

  it("marks other-user assignments as 'placed' (no identity leak — just position)", () => {
    const view = presentFanVenuePreview(
      { rows: [A] },
      null,
      [{ venueRowId: "row_a", seatNumbers: ["1", "2"] }],
      null,
    );
    const seats = view.sections[0]!.rows[0]!.seats;
    expect(seats.map((s) => `${s.number}:${s.status}`)).toEqual([
      "1:placed",
      "2:placed",
      "3:unfilled",
      "4:unfilled",
    ]);
  });

  it("marks the user's own seats as 'yours' even when they appear in the assignments list (the 'yours' overlay wins)", () => {
    // The user's assignment is also present in the global assignments
    // list — the page passes both. Without the overlay logic the seats
    // would render as plain 'placed' and the fan couldn't tell which
    // are theirs.
    const view = presentFanVenuePreview(
      { rows: [A] },
      null,
      [
        { venueRowId: "row_a", seatNumbers: ["1", "2"] },
        { venueRowId: "row_a", seatNumbers: ["3", "4"] }, // someone else
      ],
      { venueRowId: "row_a", seatNumbers: ["1", "2"] },
    );
    const seats = view.sections[0]!.rows[0]!.seats;
    expect(seats.map((s) => `${s.number}:${s.status}`)).toEqual([
      "1:yours",
      "2:yours",
      "3:placed",
      "4:placed",
    ]);
    expect(view.sections[0]!.rows[0]!.isYourRow).toBe(true);
    expect(view.hasYourPlacement).toBe(true);
  });

  it("sets isYourRow=true only for the user's row, false for others", () => {
    const view = presentFanVenuePreview(
      { rows: [A, B] },
      null,
      [],
      { venueRowId: "row_b", seatNumbers: ["1"] },
    );
    expect(view.sections[0]?.rows.map((r) => `${r.rowName}:${r.isYourRow}`)).toEqual([
      "A:false",
      "B:true",
    ]);
  });

  it("falls back to 'General admission' tier label when a row has no tier", () => {
    const ga = makeRow({
      id: "row_ga",
      rowName: "GA",
      rowRank: 9,
      seatNumbers: ["GA-1", "GA-2"],
    });
    const view = presentFanVenuePreview({ rows: [ga] }, null, [], null);
    expect(view.sections[0]?.tier).toBe("General admission");
  });
});
