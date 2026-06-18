import { describe, expect, it } from "vitest";

import { buildTierBands } from "./room-heat";
import type { FanSection } from "./venue-preview";

// Build a section of `rowCount` rows × `seatsPerRow`, with `placedPerRow` seats
// marked "placed" in each row and the rest "unfilled".
function section(
  tier: string,
  rowCount: number,
  seatsPerRow: number,
  placedPerRow: number,
): FanSection {
  return {
    tier,
    rows: Array.from({ length: rowCount }, (_, r) => ({
      rowId: `${tier}-row-${r}`,
      rowName: String.fromCharCode(65 + r),
      rowRank: r,
      isYourRow: false,
      seats: Array.from({ length: seatsPerRow }, (_, s) => ({
        number: String(s + 1),
        status: s < placedPerRow ? ("placed" as const) : ("unfilled" as const),
      })),
    })),
  };
}

describe("buildTierBands", () => {
  it("preserves section order and labels tiers + whole-dollar floors", () => {
    const sections = [section("premium", 2, 4, 0), section("ga", 1, 10, 0)];
    const bands = buildTierBands(sections, { premium: 14000, ga: 6000 });

    expect(bands.map((b) => b.tier)).toEqual(["premium", "ga"]);
    expect(bands[0]!.label).toBe("Premium");
    expect(bands[0]!.floorDisplay).toBe("$140+");
    // GA keeps its acronym casing.
    expect(bands[1]!.label).toBe("GA");
    expect(bands[1]!.floorDisplay).toBe("$60+");
  });

  it("derives fill ratio from placed vs total seats", () => {
    // 2 rows × 4 seats = 8 total; 2 placed per row = 4 placed → 0.5.
    const bands = buildTierBands([section("mid", 2, 4, 2)], { mid: 9500 });
    expect(bands[0]!.totalSeats).toBe(8);
    expect(bands[0]!.placedSeats).toBe(4);
    expect(bands[0]!.fillRatio).toBe(0.5);
  });

  it("reports a 0 fill ratio for an empty band (no divide-by-zero)", () => {
    const bands = buildTierBands([section("rear", 0, 0, 0)], { rear: 6000 });
    expect(bands[0]!.totalSeats).toBe(0);
    expect(bands[0]!.fillRatio).toBe(0);
  });

  it("counts 'yours' seats as filled defensively", () => {
    const sections: FanSection[] = [
      {
        tier: "premium",
        rows: [
          {
            rowId: "r1",
            rowName: "A",
            rowRank: 0,
            isYourRow: true,
            seats: [
              { number: "1", status: "yours" },
              { number: "2", status: "placed" },
              { number: "3", status: "unfilled" },
            ],
          },
        ],
      },
    ];
    const bands = buildTierBands(sections, { premium: 14000 });
    expect(bands[0]!.placedSeats).toBe(2);
    expect(bands[0]!.totalSeats).toBe(3);
  });

  it("leaves floorDisplay null when the tier has no recorded floor", () => {
    const bands = buildTierBands([section("lawn", 1, 5, 0)], {});
    expect(bands[0]!.floorDisplay).toBeNull();
    expect(bands[0]!.floorCents).toBeNull();
  });
});
