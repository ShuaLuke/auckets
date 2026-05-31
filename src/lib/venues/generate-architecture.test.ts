import { describe, expect, it } from "vitest";

import { alphaLabel, generateArchitectureRows } from "./generate-architecture";

describe("alphaLabel", () => {
  it("maps 0-indexed positions to spreadsheet-style labels", () => {
    expect(alphaLabel(0)).toBe("A");
    expect(alphaLabel(25)).toBe("Z");
    expect(alphaLabel(26)).toBe("AA");
    expect(alphaLabel(27)).toBe("AB");
    expect(alphaLabel(51)).toBe("AZ");
    expect(alphaLabel(52)).toBe("BA");
  });
});

describe("generateArchitectureRows", () => {
  const tiers = [
    { name: "premium", rowCount: 2, seatsPerRow: 8, isGa: false },
    { name: "mid", rowCount: 1, seatsPerRow: 6, isGa: false },
    { name: "ga", rowCount: 1, seatsPerRow: 20, isGa: true },
  ];

  it("assigns a globally ascending, unique rowRank from 1, in tier order", () => {
    const rows = generateArchitectureRows(tiers);
    expect(rows.map((r) => r.rowRank)).toEqual([1, 2, 3, 4]);
    // Best tier (listed first) gets the lowest ranks — waterfall.ts infers
    // tier ordering from each tier's min rowRank.
    expect(rows.filter((r) => r.tier === "premium").map((r) => r.rowRank)).toEqual([
      1, 2,
    ]);
    expect(rows.find((r) => r.tier === "ga")?.rowRank).toBe(4);
  });

  it("produces unique row ids", () => {
    const rows = generateArchitectureRows(tiers);
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("labels seated rows A, B, C… across tiers and names the GA bucket", () => {
    const rows = generateArchitectureRows(tiers);
    expect(rows.map((r) => r.rowName)).toEqual(["A", "B", "C", "GA"]);
  });

  it("sets capacity == seatNumbers.length for every row", () => {
    const rows = generateArchitectureRows(tiers);
    for (const row of rows) {
      expect(row.seatNumbers).toHaveLength(row.capacity);
    }
  });

  it("uses sequential numeric seats for seated rows and GA-prefixed for GA", () => {
    const rows = generateArchitectureRows(tiers);
    const premium = rows.find((r) => r.tier === "premium")!;
    expect(premium.seatNumbers.slice(0, 3)).toEqual(["1", "2", "3"]);
    const ga = rows.find((r) => r.isGa)!;
    expect(ga.seatNumbers[0]).toBe("GA-1-1");
  });

  it("applies safe GAE defaults: EVEN parity, CENTER lean (LEFT for GA), no holds", () => {
    const rows = generateArchitectureRows(tiers);
    const seated = rows.find((r) => !r.isGa)!;
    expect(seated.parity).toBe("EVEN");
    expect(seated.lean).toBe("CENTER");
    expect(seated.holds).toEqual([]);
    expect(rows.find((r) => r.isGa)!.lean).toBe("LEFT");
  });

  it("names multi-row GA buckets GA-1, GA-2", () => {
    const rows = generateArchitectureRows([
      { name: "ga", rowCount: 2, seatsPerRow: 10, isGa: true },
    ]);
    expect(rows.map((r) => r.rowName)).toEqual(["GA-1", "GA-2"]);
  });

  it("returns an empty array for no tiers", () => {
    expect(generateArchitectureRows([])).toEqual([]);
  });

  describe("unit types", () => {
    it("labels table units 'Table N' with a 'tables' area, seats 1..N", () => {
      const rows = generateArchitectureRows([
        { name: "floor", rowCount: 3, seatsPerRow: 4, isGa: false, unitType: "tables" },
      ]);
      expect(rows.map((r) => r.rowName)).toEqual(["Table 1", "Table 2", "Table 3"]);
      expect(rows.every((r) => r.area === "tables" && r.section === "tables")).toBe(true);
      expect(rows[0]!.seatNumbers).toEqual(["1", "2", "3", "4"]);
      // Labels-only for now: a table still fills seat-by-seat (CENTER, not GA).
      expect(rows.every((r) => r.lean === "CENTER" && r.isGa === false)).toBe(true);
    });

    it("labels box units 'Box N' with a 'boxes' area", () => {
      const rows = generateArchitectureRows([
        { name: "boxes", rowCount: 2, seatsPerRow: 6, isGa: false, unitType: "boxes" },
      ]);
      expect(rows.map((r) => r.rowName)).toEqual(["Box 1", "Box 2"]);
      expect(rows.every((r) => r.area === "boxes")).toBe(true);
    });

    it("labels custom units '<label> N' and slugifies the area", () => {
      const rows = generateArchitectureRows([
        {
          name: "lawn",
          rowCount: 2,
          seatsPerRow: 50,
          isGa: false,
          unitType: "custom",
          customLabel: "VIP Lawn",
        },
      ]);
      expect(rows.map((r) => r.rowName)).toEqual(["VIP Lawn 1", "VIP Lawn 2"]);
      expect(rows.every((r) => r.area === "vip_lawn")).toBe(true);
    });

    it("treats unitType 'ga' the same as the isGa flag", () => {
      const viaUnit = generateArchitectureRows([
        { name: "ga", rowCount: 1, seatsPerRow: 20, isGa: false, unitType: "ga" },
      ]);
      expect(viaUnit[0]!.isGa).toBe(true);
      expect(viaUnit[0]!.rowName).toBe("GA");
      expect(viaUnit[0]!.lean).toBe("LEFT");
      expect(viaUnit[0]!.seatNumbers[0]).toBe("GA-1-1");
    });

    it("only the 'rows' unit consumes the A/B/C sequence (tables don't shift it)", () => {
      const rows = generateArchitectureRows([
        { name: "tables", rowCount: 2, seatsPerRow: 4, isGa: false, unitType: "tables" },
        { name: "seated", rowCount: 2, seatsPerRow: 10, isGa: false, unitType: "rows" },
      ]);
      const seated = rows.filter((r) => r.area === "orchestra");
      expect(seated.map((r) => r.rowName)).toEqual(["A", "B"]);
    });
  });
});
