/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { areaFor, detectDelimiter, holdSourceFor, leanFor, venueFromManifest } from "./manifest";

const header = ["Section Name", "Row Name", "SeatName", "Price Value", "Capacity", "Price Level Name", "Price Level", "Hold Group Name", "Hold Name / Offer Name"].map((h) => `"${h}"`).join("\t");
const line = (sec: string, row: string, seat: number, price: number, level: string, hold = "", status = "Open"): string =>
  [`"${sec}"`, `"${row}"`, `"${seat}"`, price, 1, `"${level}"`, level.slice(1), `"${hold}"`, `"${status}"`].join("\t");

const tsv = [
  header,
  line("ORCH L", "A", 2, 85, "P2"),
  line("ORCH L", "A", 1, 85, "P2"),
  line("ORCH C", "A", 101, 85, "P2"),
  line("ORCH C", "A", 102, 85, "P2", "2-HOUS"),
  line("ORCH C", "AA", 101, 125, "P1"),
  line("ORCH C", "AA", 102, 125, "P1", "", "Sold"),
  line("R BALC", "V", 26, 25, "P5", "1-TECH"),
  line("FR BAL", "D", 1, 70, "P3", "3-ARTI"),
  line("FR BAL", "D", 2, 70, "P3", "4-MKTG"),
].join("\r\n");

describe("venueFromManifest", () => {
  it("groups seats into rows, ranks by price level then row letter, derives tiers/floors/holds", () => {
    const { venue, heldBySource, holdGroups, soldSeats } = venueFromManifest(tsv, { name: "m" });
    const byRank = [...venue.rows].sort((a, b) => a.rowRank - b.rowRank).map((r) => `${r.section} ${r.rowName}`);
    expect(byRank).toEqual(["ORCH C AA", "ORCH L A", "ORCH C A", "FR BAL D", "R BALC V"]);
    const orchL = venue.rows.find((r) => r.id === "orch_l-a")!;
    expect(orchL).toMatchObject({ seatNumbers: ["1", "2"], capacity: 2, tier: "p2", lean: "RIGHT", area: "orchestra", holds: [] });
    expect(venue.rows.find((r) => r.id === "orch_c-a")!.holds).toEqual(["102"]);
    expect(venue.tierFloorsCents).toEqual({ p1: 12500, p2: 8500, p3: 7000, p5: 2500 });
    expect(heldBySource).toEqual({ venue: 1, artist: 1, comp: 1, production: 1 });
    expect(holdGroups).toEqual({ "2-HOUS": 1, "1-TECH": 1, "3-ARTI": 1, "4-MKTG": 1 });
    expect(soldSeats).toBe(1);
    expect(venue.rows.find((r) => r.id === "orch_c-aa")!.holds).toEqual([]); // sold ≠ held by default
  });

  it("honours --sold-as-held, --ignore-holds and a rank file", () => {
    const sold = venueFromManifest(tsv, { name: "m", soldAsHeld: true });
    expect(sold.venue.rows.find((r) => r.id === "orch_c-aa")!.holds).toEqual(["102"]);
    const none = venueFromManifest(tsv, { name: "m", ignoreHolds: true });
    expect(none.venue.rows.every((r) => r.holds.length === 0)).toBe(true);
    const ranked = venueFromManifest(tsv, {
      name: "m",
      rankFileText: "section,row,rowRank\nORCH C,A,1\nORCH C,AA,2\nORCH L,A,3\nFR BAL,D,4\nR BALC,V,5\n",
    });
    expect(ranked.venue.rows.find((r) => r.id === "orch_c-a")!.rowRank).toBe(1);
    expect(() => venueFromManifest(tsv, { name: "m", rankFileText: "section,row,rowRank\nORCH C,A,1\n" })).toThrow(/rank file has no entry for/);
  });

  it("rejects a file without the seat columns", () => {
    expect(() => venueFromManifest("a,b\n1,2\n", { name: "m" })).toThrow(/missing a section column/);
  });

  it("helpers", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(holdSourceFor("1-TECH")).toBe("production");
    expect(holdSourceFor("3-ARTI")).toBe("artist");
    expect(holdSourceFor("4-MKTG")).toBe("comp");
    expect(holdSourceFor("5-ADA")).toBe("venue");
    expect(areaFor("BOX A")).toBe("boxes");
    expect(areaFor("FC BAL")).toBe("front_balcony");
    expect(areaFor("CL BAL")).toBe("upper_balcony");
    expect(leanFor("FL BAL")).toBe("RIGHT");
    expect(leanFor("CR BAL")).toBe("LEFT");
    expect(leanFor("ORCH C")).toBe("CENTER");
    expect(leanFor("BOX A")).toBe("CENTER");
  });
});
