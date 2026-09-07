/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { row, venue } from "./test-helpers";
import { applyShowOverlay, maxRunLength, parseVenueFile, tierOrder, venueFromTierSpec, venueParitySummary } from "./venue";

const base = venue([
  row({ id: "a", rank: 1, cap: 8, tier: "premium", section: "ORCH C" }),
  row({ id: "b", rank: 2, cap: 7, tier: "premium", section: "ORCH L" }),
  row({ id: "c", rank: 3, cap: 6, tier: "mid", area: "front_balcony", section: "FC BAL" }),
  row({ id: "d", rank: 4, cap: 1, tier: "rear", area: "upper_balcony", section: "R BALC" }),
  row({ id: "ga", rank: 5, cap: 10, tier: "ga", area: "ga", section: "ga", isGa: true }),
]);

describe("parseVenueFile", () => {
  it("accepts a valid file and defaults activeRowIds to every row", () => {
    const raw = { ...base, activeRowIds: undefined };
    const v = parseVenueFile(raw);
    expect(v.activeRowIds).toEqual(["a", "b", "c", "d", "ga"]);
  });

  it("points at the broken row when seat numbers do not match capacity", () => {
    const bad = { ...base, rows: base.rows.map((r) => (r.id === "b" ? { ...r, capacity: 9 } : r)) };
    expect(() => parseVenueFile(bad, "x.json")).toThrow(/rows\[1\] "b" has capacity 9 but 7 seat numbers/);
  });

  it("rejects holds that are not seats, unknown active ids, and non-kebab names", () => {
    expect(() => parseVenueFile({ ...base, rows: base.rows.map((r) => (r.id === "a" ? { ...r, holds: ["99"] } : r)) })).toThrow(/holds seat "99"/);
    expect(() => parseVenueFile({ ...base, activeRowIds: ["zz"] })).toThrow(/unknown row "zz"/);
    expect(() => parseVenueFile({ ...base, name: "Bad Name" })).toThrow(/kebab-case/);
  });
});

describe("tierOrder", () => {
  it("orders tiers by best active row, ignoring inactive rows", () => {
    expect(tierOrder(base)).toEqual(["premium", "mid", "rear", "ga"]);
    expect(tierOrder({ ...base, activeRowIds: ["c", "d", "ga"] })).toEqual(["mid", "rear", "ga"]);
  });
});

describe("applyShowOverlay", () => {
  it("narrows active rows by section or area, case-insensitively", () => {
    const r = applyShowOverlay(base, { activeSections: ["orch c", "FRONT_BALCONY"] });
    expect(r.venue.activeRowIds).toEqual(["a", "c"]);
    expect(() => applyShowOverlay(base, { activeSections: ["nope"] })).toThrow(/Known sections\/areas/);
  });

  it("holds N seats in a tier best rows first and counts them by source", () => {
    const r = applyShowOverlay(base, { holds: [{ source: "artist", tier: "premium", seats: 10 }] });
    const a = r.venue.rows.find((x) => x.id === "a")!;
    const b = r.venue.rows.find((x) => x.id === "b")!;
    expect(a.holds).toHaveLength(8);
    expect(b.holds).toEqual(["1", "2"]);
    expect(r.heldBySource).toEqual({ venue: 0, artist: 10, comp: 0, production: 0, bleacher: 0 });
    expect(base.rows.find((x) => x.id === "a")!.holds).toEqual([]); // library venue untouched
  });

  it("holds explicit seat ids and refuses unknown ones", () => {
    const r = applyShowOverlay(base, { holds: [{ source: "comp", seatIds: ["c:3", "c:4"] }] });
    expect(r.venue.rows.find((x) => x.id === "c")!.holds).toEqual(["3", "4"]);
    expect(() => applyShowOverlay(base, { holds: [{ source: "comp", seatIds: ["c:99"] }] })).toThrow(/no seat "99"/);
    expect(() => applyShowOverlay(base, { holds: [{ source: "venue", tier: "premium", seats: 99 }] })).toThrow(/only 15 free seats/);
  });

  it("merges floors and applies the group cap", () => {
    const r = applyShowOverlay(base, { floorsCents: { premium: 12500 }, maxGroupSize: 6 });
    expect(r.floorsCents).toEqual({ premium: 12500, mid: 6000, rear: 4000 });
    expect(r.maxGroupSize).toBe(6);
    expect(applyShowOverlay(base, undefined).maxGroupSize).toBe(10);
  });
});

describe("venueParitySummary", () => {
  it("counts capacity, parity, singles and GA per scope", () => {
    const [full, orch] = venueParitySummary(base);
    expect(full).toMatchObject({ scope: "Full venue", capacity: 32, rows: 5, evenRows: 2, oddRows: 2, singleRows: 1, gaSeats: 10 });
    expect(orch).toMatchObject({ scope: "orchestra", capacity: 15, evenRows: 1, oddRows: 1 });
  });
});

describe("venueFromTierSpec + maxRunLength", () => {
  it("builds a uniform room from a tier spec with floors", () => {
    const v = venueFromTierSpec({
      name: "tiny",
      displayName: "Tiny",
      tiers: [
        { name: "premium", rowCount: 2, seatsPerRow: 4, floorCents: 5000 },
        { name: "ga", rowCount: 1, seatsPerRow: 10, unitType: "ga" },
      ],
    });
    expect(v.rows).toHaveLength(3);
    expect(tierOrder(v)).toEqual(["premium", "ga"]);
    expect(v.tierFloorsCents).toEqual({ premium: 5000 });
  });

  it("maxRunLength respects holds", () => {
    expect(maxRunLength(row({ id: "x", rank: 1, cap: 10, tier: "t", holds: ["5", "6"] }))).toBe(4);
    expect(maxRunLength(row({ id: "x", rank: 1, cap: 10, tier: "t" }))).toBe(10);
  });
});
