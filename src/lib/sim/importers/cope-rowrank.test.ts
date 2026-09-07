/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { canonicalArea, venueFromCopeRowRank, type SheetRow } from "./cope-rowrank";

const sheet: SheetRow[] = [
  { GlobalRowRank: 1, Area: "Lower Orchestra", DisplaySection: "Center Pit", ManifestSection: "ORCH C", Row: "AA", ManifestCapacity: 4, WorkingL: 4, Parity: "Even", Lean: "Center", PrintedSeatList: "101, 102, 103, 104", HoldSeats: 0, SingleInventoryFlag: "No", GapReliefEligible: "No", ActiveStatus: "Active", Notes: "Standard row" },
  { GlobalRowRank: 2, Area: "Upper Balcony", DisplaySection: "Far Left", ManifestSection: "L BALC", Row: "E", ManifestCapacity: 3, WorkingL: 1, Parity: "Odd", Lean: "Right", PrintedSeatList: "25", HoldSeats: 2, SingleInventoryFlag: "Yes", GapReliefEligible: "Yes", ActiveStatus: "Active", Notes: "Single relief" },
  { GlobalRowRank: 3, Area: "Upper Balcony", DisplaySection: "Far Left", ManifestSection: "L BALC", Row: "F", ManifestCapacity: 2, WorkingL: 2, Parity: "Even", Lean: "Left", PrintedSeatList: "25, 26", HoldSeats: 0, SingleInventoryFlag: "No", GapReliefEligible: "Yes", ActiveStatus: "Inactive", Notes: "" },
  { GlobalRowRank: null, Area: null, DisplaySection: null, ManifestSection: null, Row: null, ManifestCapacity: null, WorkingL: null, Parity: null, Lean: null, PrintedSeatList: null, HoldSeats: null, SingleInventoryFlag: null, GapReliefEligible: null, ActiveStatus: null, Notes: null },
];

describe("venueFromCopeRowRank", () => {
  it("maps his columns onto VenueRow, tiers by canonical area, relief flags, active status", () => {
    const v = venueFromCopeRowRank(sheet, { name: "t", floorsCents: { orchestra: 8500, upper_balcony: 5000 } });
    expect(v.rows.map((r) => r.id)).toEqual(["orch_c-aa", "l_balc-e", "l_balc-f"]);
    expect(v.rows[0]).toMatchObject({ area: "orchestra", tier: "orchestra", section: "ORCH C", rowName: "AA", rowRank: 1, capacity: 4, parity: "EVEN", lean: "CENTER", seatNumbers: ["101", "102", "103", "104"], holds: [] });
    expect(v.rows[1]).toMatchObject({ area: "upper_balcony", tier: "upper_balcony", capacity: 1, parity: "ODD", lean: "RIGHT", seatNumbers: ["25"] });
    expect(v.rows[2]!.lean).toBe("LEFT");
    expect(v.activeRowIds).toEqual(["orch_c-aa", "l_balc-e"]);
    expect(v.relief).toEqual({ "l_balc-e": { single: true, gapRelief: true }, "l_balc-f": { gapRelief: true } });
    expect(v.tierFloorsCents).toEqual({ orchestra: 8500, upper_balcony: 5000 });
    expect(v.source?.kind).toBe("cope-rowrank-xlsx");
  });

  it("tiers by section when asked, and matches header names loosely", () => {
    const loose = sheet.slice(0, 1).map((r) => ({ "Global Row Rank": r.GlobalRowRank, area: r.Area, "Manifest Section": r.ManifestSection, ROW: r.Row, "Working L": r.WorkingL, LEAN: r.Lean, "Printed Seat List": r.PrintedSeatList }));
    const v = venueFromCopeRowRank(loose, { name: "t", tierBy: "section" });
    expect(v.rows[0]!.tier).toBe("orch_c");
    expect(v.activeRowIds).toEqual(["orch_c-aa"]); // no ActiveStatus column → active
  });

  it("explains a seat list that does not match WorkingL, and a missing floor", () => {
    const bad = [{ ...sheet[0]!, WorkingL: 3 }];
    expect(() => venueFromCopeRowRank(bad, { name: "t" })).toThrow(/PrintedSeatList has 4 seats but WorkingL is 3.*list only the 3 working seats/);
    expect(() => venueFromCopeRowRank(sheet, { name: "t", floorsCents: { orchestra: 1 } })).toThrow(/--floors is missing tier "upper_balcony"/);
    expect(() => venueFromCopeRowRank([{ Foo: 1 }], { name: "t" })).toThrow(/missing a "rank" column/);
  });

  it("canonicalArea", () => {
    expect(canonicalArea("Lower Orchestra")).toBe("orchestra");
    expect(canonicalArea("Front Balcony")).toBe("front_balcony");
    expect(canonicalArea("Upper Balcony")).toBe("upper_balcony");
    expect(canonicalArea("Boxes")).toBe("boxes");
    expect(canonicalArea("GA Pit")).toBe("ga");
    expect(canonicalArea("Mezzanine Terrace")).toBe("mezzanine_terrace");
  });
});
