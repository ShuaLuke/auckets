import { describe, expect, it } from "vitest";

import type { Hold, VenueArchitecture } from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import { formatSeatNumbers, presentHolds } from "./holds";

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

  it("formats 'Row X · seats ...' with consecutive runs compacted", () => {
    const view = presentHolds(
      [hold({ venueRowId: "row_f", seatNumbers: ["1", "2", "27", "28"] })],
      arch([{ id: "row_f", rowName: "F" }]),
    );
    expect(view.rows[0]?.seatDescription).toBe("Row F · seats 1-2, 27-28");
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
      "Row BB · seats 1-4 (sound desk)",
    );
  });

  it("falls back to the raw row id when architecture is null", () => {
    const view = presentHolds([hold({ venueRowId: "row_z" })], null);
    expect(view.rows[0]?.seatDescription).toContain("Row row_z");
  });

  it("marks artist-kind holds as mutable by default", () => {
    const view = presentHolds(
      [hold({ kind: "artist" }), hold({ kind: "venue" })],
      null,
    );
    expect(view.rows[0]?.mutable).toBe(true);
    expect(view.rows[1]?.mutable).toBe(false);
  });

  it("marks every hold as mutable when viewerIsAdmin=true", () => {
    const view = presentHolds(
      [hold({ kind: "artist" }), hold({ kind: "venue" })],
      null,
      true,
    );
    expect(view.rows[0]?.mutable).toBe(true);
    expect(view.rows[1]?.mutable).toBe(true);
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

describe("formatSeatNumbers", () => {
  it("returns an empty string for no seats", () => {
    expect(formatSeatNumbers([])).toBe("");
  });

  it("returns a single seat verbatim", () => {
    expect(formatSeatNumbers(["7"])).toBe("7");
  });

  it("folds consecutive runs into ranges", () => {
    expect(formatSeatNumbers(["1", "2", "3", "4"])).toBe("1-4");
  });

  it("interleaves runs and singletons", () => {
    expect(formatSeatNumbers(["1", "2", "3", "5", "9", "10"])).toBe(
      "1-3, 5, 9-10",
    );
  });

  it("sorts numerically (not lexically) before compacting", () => {
    expect(formatSeatNumbers(["10", "2", "1", "9"])).toBe("1-2, 9-10");
  });

  it("falls back to a sorted comma list when any seat label is non-numeric", () => {
    expect(formatSeatNumbers(["1A", "1B", "2"])).toBe("1A, 1B, 2");
  });
});
