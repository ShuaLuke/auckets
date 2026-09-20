/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { libraryPool, libraryPoolSummaries, libraryVenue, libraryVenueSummaries } from "./library";

describe("static library", () => {
  it("loads every committed venue and Cope's pool", () => {
    const names = libraryVenueSummaries().map((v) => v.name);
    expect(names).toEqual(["lincoln-v4", "lincoln-manifest", "daikin-park", "copes-place", "supper-club", "lincoln-synthetic", "austin-partial", "lean-demo"]);
    const lincoln = libraryVenueSummaries().find((v) => v.name === "lincoln-v4")!;
    expect(lincoln).toMatchObject({ capacity: 1152, rows: 144, tiers: ["orchestra", "front_balcony", "upper_balcony"], singleRows: 7 });
    expect(libraryVenue("lincoln-v4")?.rows).toHaveLength(144);
    expect(libraryVenue("nope")).toBeUndefined();
    expect(libraryPoolSummaries()).toEqual([expect.objectContaining({ name: "lincoln-pool-v4", offers: 512, tickets: 1451 })]);
    const pool = libraryPool("lincoln-pool-v4")!;
    expect(pool.offers).toHaveLength(512);
    expect(pool.offers[0]!.rankKey).toBe(pool.offers[0]!.pricePerTicketCents * 1000 + pool.offers[0]!.groupSize);
  });

  it("offers a theatre's sections and a stadium's areas for sections on sale", () => {
    const lincoln = libraryVenueSummaries().find((v) => v.name === "lincoln-v4")!;
    expect(lincoln.sections).toEqual([...new Set(libraryVenue("lincoln-v4")!.rows.map((r) => r.section))]);
    expect(Object.values(lincoln.sectionSeats).reduce((s, n) => s + n, 0)).toBe(1152);

    const daikin = libraryVenueSummaries().find((v) => v.name === "daikin-park")!;
    // 43,445 seats in the building; the 2,294 suite and hospitality seats are off sale by default.
    expect(daikin).toMatchObject({ capacity: 41_151, rows: 2186 });
    expect(daikin.tiers).toEqual(["diamond_club", "dugout", "field_box", "club", "outfield_lower", "mezzanine_terrace", "view_deck", "view_deck_value", "sro"]);
    expect(new Set(libraryVenue("daikin-park")!.rows.map((r) => r.section)).size).toBe(213);
    expect(daikin.sections).toHaveLength(10);
    expect(daikin.sectionSeats).toMatchObject({ diamond_club: 521, hospitality: 2294, sro: 2000 });
    expect(Object.values(daikin.sectionSeats).reduce((s, n) => s + n, 0)).toBe(43_445);
    expect(Object.keys(daikin.floorsCents).sort()).toEqual([...daikin.tiers, "hospitality"].sort());
  });
});
