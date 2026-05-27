import { describe, expect, it } from "vitest";

import type { SeatAssignment, VenueArchitecture } from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import { presentProvisionalPlacement } from "./placement";

function row(overrides: Partial<VenueRow>): VenueRow {
  return {
    id: "row_a",
    area: "Orchestra",
    section: "Main",
    rowName: "A",
    rowRank: 1,
    capacity: 8,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: ["1", "2", "3", "4", "5", "6", "7", "8"],
    holds: [],
    tier: "premium",
    ...overrides,
  } as VenueRow;
}

function arch(rows: VenueRow[]): Pick<VenueArchitecture, "rows"> {
  return { rows: rows as unknown as VenueArchitecture["rows"] };
}

function assignment(
  venueRowId: string,
  seatNumbers: string[],
): Pick<SeatAssignment, "venueRowId" | "seatNumbers"> {
  return { venueRowId, seatNumbers };
}

describe("presentProvisionalPlacement", () => {
  it("renders every row as unfilled when there are no assignments", () => {
    const view = presentProvisionalPlacement(
      arch([row({ id: "row_a", rowName: "A", capacity: 4, seatNumbers: ["1", "2", "3", "4"] })]),
      null,
      [],
    );
    expect(view.summary).toEqual({
      placedSeats: 0,
      unfilledSeats: 4,
      totalSeats: 4,
      fillRate: 0,
    });
    expect(view.sections).toHaveLength(1);
    expect(view.sections[0]?.rows[0]?.seats.every((s) => s.status === "unfilled")).toBe(true);
  });

  it("marks placed seats from assignment seatNumbers", () => {
    const view = presentProvisionalPlacement(
      arch([row({ id: "row_a", rowName: "A", capacity: 4, seatNumbers: ["1", "2", "3", "4"] })]),
      null,
      [assignment("row_a", ["2", "3"])],
    );
    const seats = view.sections[0]?.rows[0]?.seats ?? [];
    expect(seats.map((s) => s.status)).toEqual(["unfilled", "placed", "placed", "unfilled"]);
    expect(view.summary.placedSeats).toBe(2);
    expect(view.summary.unfilledSeats).toBe(2);
    expect(view.summary.fillRate).toBe(0.5);
  });

  it("groups rows by tier and orders sections by closest-to-stage row", () => {
    const view = presentProvisionalPlacement(
      arch([
        row({ id: "row_n", rowName: "N", rowRank: 11, tier: "rear", seatNumbers: ["1"], capacity: 1 }),
        row({ id: "row_f", rowName: "F", rowRank: 5, tier: "mid", seatNumbers: ["1"], capacity: 1 }),
        row({ id: "row_a", rowName: "A", rowRank: 1, tier: "premium", seatNumbers: ["1"], capacity: 1 }),
      ]),
      null,
      [],
    );
    expect(view.sections.map((s) => s.tier)).toEqual(["Premium", "Mid", "Rear"]);
  });

  it("filters by activeRowIds when provided (NEW-4 partial-venue activation)", () => {
    const view = presentProvisionalPlacement(
      arch([
        row({ id: "row_a", rowRank: 1, seatNumbers: ["1"], capacity: 1 }),
        row({ id: "row_b", rowRank: 2, seatNumbers: ["1"], capacity: 1 }),
      ]),
      ["row_a"],
      [],
    );
    expect(view.summary.totalSeats).toBe(1);
    expect(view.sections[0]?.rows).toHaveLength(1);
    expect(view.sections[0]?.rows[0]?.rowId).toBe("row_a");
  });

  it("falls back to 'General admission' label when a row has no tier", () => {
    // Build a tier-less row directly. The `tier?` field is intentionally
    // optional on VenueRow (GA shows skip tiering entirely).
    const tierless: VenueRow = {
      id: "row_a",
      area: "Orchestra",
      section: "Main",
      rowName: "A",
      rowRank: 1,
      capacity: 1,
      parity: "ODD",
      lean: "CENTER",
      seatNumbers: ["1"],
      holds: [],
    };
    const view = presentProvisionalPlacement(arch([tierless]), null, []);
    expect(view.sections[0]?.tier).toBe("General admission");
  });

  it("sorts rows within a section by rowRank ASC", () => {
    const view = presentProvisionalPlacement(
      arch([
        row({ id: "row_aa", rowName: "AA", rowRank: 2, seatNumbers: ["1"], capacity: 1 }),
        row({ id: "row_a", rowName: "A", rowRank: 1, seatNumbers: ["1"], capacity: 1 }),
      ]),
      null,
      [],
    );
    expect(view.sections[0]?.rows.map((r) => r.rowName)).toEqual(["A", "AA"]);
  });

  it("handles multiple assignments on the same row without double-counting", () => {
    // Pathological: two assignments report the same seat numbers. Set
    // semantics dedupe — placedSeats stays at the unique count.
    const view = presentProvisionalPlacement(
      arch([row({ id: "row_a", capacity: 4, seatNumbers: ["1", "2", "3", "4"] })]),
      null,
      [assignment("row_a", ["1", "2"]), assignment("row_a", ["2", "3"])],
    );
    expect(view.summary.placedSeats).toBe(3);
  });
});
