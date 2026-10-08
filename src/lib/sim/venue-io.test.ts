import { describe, expect, it } from "vitest";

import type { VenueRow } from "@/lib/gae/types";

import { libraryVenues } from "./library";
import type { SimVenue } from "./types";
import { parseVenueFile, SimInputError } from "./venue";
import { checkVenueSize, decodeText, importVenueFile, venueFromBuilder, venueSummary, venueToCsv, venueToJson, withFloors } from "./venue-io";

// What the engine reads from a row, keyed so row ids (which a CSV can't
// carry) don't matter.
function engineView(v: SimVenue): Record<string, unknown> {
  const active = new Set(v.activeRowIds);
  const rows = [...v.rows]
    .sort((a, b) => a.rowRank - b.rowRank)
    .map((r: VenueRow) => ({ rowRank: r.rowRank, rowName: r.rowName, area: r.area, capacity: r.capacity, lean: r.lean, seatNumbers: r.seatNumbers, holds: [...r.holds].sort(), tier: r.tier, isGa: r.isGa === true, active: active.has(r.id) }));
  return { rows, floors: v.tierFloorsCents ?? {} };
}

describe("venue export → import", () => {
  it.each(libraryVenues().map((v) => [v.name, v] as const))("%s comes back from JSON unchanged", (_name, v) => {
    const back = importVenueFile({ filename: `${v.name}.json`, text: venueToJson(v) }, { name: v.name, displayName: v.displayName });
    expect(back.format).toBe("venue file");
    expect({ ...back.venue, source: undefined }).toEqual({ ...v, source: undefined });
  });

  it.each(libraryVenues().map((v) => [v.name, v] as const))("%s comes back from CSV as the same room", (_name, v) => {
    const back = importVenueFile({ filename: `${v.name}.csv`, text: venueToCsv(v) }, { name: v.name });
    expect(back.format).toBe("seat manifest (CSV)");
    // Rows with no seats can't be written as seat lines.
    const seated = { ...v, rows: v.rows.filter((r) => r.capacity > 0), activeRowIds: v.activeRowIds };
    const want = engineView(seated) as { rows: { rowRank: number }[] };
    // Ranks renumber 1..n once empty rows are gone; order is what counts.
    want.rows.forEach((r, i) => (r.rowRank = i + 1));
    const got = engineView(back.venue) as { rows: unknown[]; floors: Record<string, number> };
    expect(got.rows).toEqual(want.rows);
    // Floors survive for every tier the room uses.
    const tiers = new Set(seated.rows.map((r) => r.tier));
    expect(got.floors).toEqual(Object.fromEntries(Object.entries(v.tierFloorsCents ?? {}).filter(([t]) => tiers.has(t))));
  });

  it("a CSV keeps rows apart that share a section and row name", () => {
    const v = venueFromBuilder({ displayName: "Two rooms", tiers: [{ name: "front", unitType: "tables", count: 3, seatsPerUnit: 4, floorCents: 9000 }, { name: "back", unitType: "tables", count: 3, seatsPerUnit: 6, floorCents: 6000 }] });
    const back = importVenueFile({ filename: "two-rooms.csv", text: venueToCsv(v) });
    expect(back.venue.rows).toHaveLength(6);
    expect(back.venue.rows.map((r) => r.capacity)).toEqual([4, 4, 4, 6, 6, 6]);
    expect(back.venue.tierFloorsCents).toEqual({ front: 9000, back: 6000 });
  });
});

describe("importVenueFile", () => {
  it("reads a tier spec", () => {
    const { venue, format } = importVenueFile({ filename: "club.json", text: JSON.stringify({ name: "x", displayName: "The Club", tiers: [{ name: "floor", rowCount: 1, seatsPerRow: 300, unitType: "ga", floorCents: 4000 }] }) });
    expect(format).toBe("tier spec");
    expect(venue.name).toBe("club");
    expect(venue.displayName).toBe("The Club");
    expect(venue.rows[0]?.isGa).toBe(true);
  });

  it("reads a box-office manifest without our extra columns", () => {
    const text = ["Section Name\tRow Name\tSeatName\tPrice Value\tPrice Level Name\tHold Group Name", "ORCH C\tA\t1\t$85.00\tP1\t", "ORCH C\tA\t2\t$85.00\tP1\t3-ARTI", "BALC\tA\t1\t$50.00\tP2\t"].join("\n");
    const { venue, notes } = importVenueFile({ filename: "My Venue Export.txt", text });
    expect(venue.name).toBe("my-venue-export");
    expect(venue.displayName).toBe("My Venue Export");
    expect(venue.rows.map((r) => [r.section, r.rowRank, r.tier])).toEqual([["ORCH C", 1, "p1"], ["BALC", 2, "p2"]]);
    expect(venue.rows[0]?.holds).toEqual(["2"]);
    expect(notes).toEqual([]);
  });

  it("finds the seat sheet in a spreadsheet, and says when floors are missing", () => {
    const table = [["Section", "Row", "Seat", "Price Level", "Row Rank"], ["Main", "A", 1, "front", 1], ["Main", "A", 2, "front", 1], ["Main", "B", 1, "back", 2]];
    const { venue, format, notes } = importVenueFile({ filename: "room.xlsx", sheets: [{ name: "Cover", table: [["hello"]] }, { name: "Seats", table }] });
    expect(format).toBe("seat manifest (spreadsheet)");
    expect(venue.rows.map((r) => [r.rowName, r.capacity, r.tier])).toEqual([["A", 2, "front"], ["B", 1, "back"]]);
    expect(notes[0]).toContain("No floor price for front, back");
  });

  it("explains bad input", () => {
    expect(() => importVenueFile({ filename: "x.json", text: "{nope" })).toThrow(SimInputError);
    expect(() => importVenueFile({ filename: "x.json", text: JSON.stringify({ rows: [] }) })).toThrow(/rows/);
    expect(() => importVenueFile({ filename: "x.csv", text: "a,b\n1,2\n" })).toThrow(/missing a section column/);
  });

  it("refuses a room too big to send", () => {
    const rows = Array.from({ length: 5001 }, () => ({ capacity: 1 })) as VenueRow[];
    expect(checkVenueSize({ rows })).toMatch(/5,001 rows/);
    expect(checkVenueSize({ rows: rows.slice(0, 10) })).toBeNull();
  });
});

describe("venueFromBuilder", () => {
  it("builds tiers best-first with floors", () => {
    const v = venueFromBuilder({ displayName: "The Fillmore", tiers: [{ name: "Pit", unitType: "ga", count: 99, seatsPerUnit: 400, floorCents: 6000 }, { name: "Balcony", unitType: "rows", count: 10, seatsPerUnit: 30 }] });
    expect(v.name).toBe("the-fillmore");
    expect(venueSummary(v)).toMatchObject({ capacity: 700, tiers: ["pit", "balcony"], floorsCents: { pit: 6000 } });
    expect(() => parseVenueFile(JSON.parse(venueToJson(v)))).not.toThrow();
  });

  it("refuses duplicate or empty tier names", () => {
    expect(() => venueFromBuilder({ displayName: "x", tiers: [{ name: "a", unitType: "rows", count: 1, seatsPerUnit: 1 }, { name: "A", unitType: "rows", count: 1, seatsPerUnit: 1 }] })).toThrow(/different/);
    expect(() => venueFromBuilder({ displayName: "x", tiers: [{ name: " ", unitType: "rows", count: 1, seatsPerUnit: 1 }] })).toThrow(/needs a name/);
    expect(() => venueFromBuilder({ displayName: " ", tiers: [] })).toThrow(/name/);
  });
});

it("withFloors sets floors for the venue's tiers only", () => {
  const v = venueFromBuilder({ displayName: "x", tiers: [{ name: "a", unitType: "rows", count: 1, seatsPerUnit: 2 }] });
  expect(withFloors(v, { a: 5000, ghost: 100 }).tierFloorsCents).toEqual({ a: 5000 });
  expect(withFloors(v, {}).tierFloorsCents).toBeUndefined();
});

it("decodeText reads UTF-16 box-office exports", () => {
  const utf16 = new Uint8Array([0xff, 0xfe, ...[..."Row\tSeat"].flatMap((c) => [c.charCodeAt(0), 0])]);
  expect(decodeText(utf16)).toBe("Row\tSeat");
  expect(decodeText(new TextEncoder().encode("﻿hi"))).toBe("hi");
});
