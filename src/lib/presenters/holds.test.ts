import { describe, expect, it } from "vitest";

import type { Hold, VenueArchitecture } from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import { presentHolds } from "./holds";

function hold(overrides: Partial<Hold> = {}): Hold {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    showId: "44444444-4444-4444-4444-444444444444",
    source: "ADA",
    kind: "venue",
    venueRowId: "row_a",
    seatNumbers: ["1", "2"],
    notes: null,
    createdAt: new Date("2026-05-27T12:00:00Z"),
    ...overrides,
  };
}

function arch(rows: Partial<VenueRow>[]): Pick<VenueArchitecture, "rows"> {
  return {
    rows: rows.map((r, i) => ({
      id: r.id ?? `row_${i}`,
      area: r.area ?? "Orchestra",
      section: r.section ?? "Main",
      rowName: r.rowName ?? "A",
      rowRank: r.rowRank ?? i + 1,
      capacity: r.capacity ?? 8,
      parity: r.parity ?? "EVEN",
      lean: r.lean ?? "CENTER",
      seatNumbers: r.seatNumbers ?? [],
      holds: r.holds ?? [],
    })) as unknown as VenueArchitecture["rows"],
  };
}

describe("presentHolds", () => {
  it("returns an empty view with total=0 for no rows", () => {
    expect(presentHolds([], null)).toEqual({ rows: [], total: 0 });
  });

  it("formats 'Row X · seats N, M, ...' from the architecture lookup", () => {
    const view = presentHolds(
      [hold({ venueRowId: "row_f", seatNumbers: ["1", "2", "27", "28"] })],
      arch([{ id: "row_f", rowName: "F" }]),
    );
    expect(view.rows[0]?.seatDescription).toBe("Row F · seats 1, 2, 27, 28");
  });

  it("appends notes in parentheses when present", () => {
    const view = presentHolds(
      [
        hold({
          venueRowId: "row_bb",
          seatNumbers: ["1", "2", "3", "4"],
          notes: "sound desk",
        }),
      ],
      arch([{ id: "row_bb", rowName: "BB" }]),
    );
    expect(view.rows[0]?.seatDescription).toBe(
      "Row BB · seats 1, 2, 3, 4 (sound desk)",
    );
  });

  it("falls back to the raw row id when architecture is null", () => {
    const view = presentHolds([hold({ venueRowId: "row_z" })], null);
    expect(view.rows[0]?.seatDescription).toContain("Row row_z");
  });

  it("marks artist-kind holds as mutable", () => {
    const view = presentHolds(
      [hold({ kind: "artist" }), hold({ kind: "venue" })],
      null,
    );
    expect(view.rows[0]?.mutable).toBe(true);
    expect(view.rows[1]?.mutable).toBe(false);
  });

  it("computes total as the sum of seatNumbers lengths across rows", () => {
    const view = presentHolds(
      [
        hold({ seatNumbers: ["1", "2"] }),
        hold({ seatNumbers: ["3", "4", "5"] }),
      ],
      null,
    );
    expect(view.total).toBe(5);
    expect(view.rows[0]?.seatCount).toBe(2);
    expect(view.rows[1]?.seatCount).toBe(3);
  });
});
