/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { libraryPool, libraryPoolSummaries, libraryVenue, libraryVenueSummaries } from "./library";

describe("static library", () => {
  it("loads every committed venue and Cope's pool", () => {
    const names = libraryVenueSummaries().map((v) => v.name);
    expect(names).toEqual(["lincoln-v4", "lincoln-manifest", "copes-place", "supper-club", "lincoln-synthetic", "austin-partial", "lean-demo"]);
    const lincoln = libraryVenueSummaries().find((v) => v.name === "lincoln-v4")!;
    expect(lincoln).toMatchObject({ capacity: 1152, rows: 144, tiers: ["orchestra", "front_balcony", "upper_balcony"], singleRows: 7 });
    expect(libraryVenue("lincoln-v4")?.rows).toHaveLength(144);
    expect(libraryVenue("nope")).toBeUndefined();
    expect(libraryPoolSummaries()).toEqual([expect.objectContaining({ name: "lincoln-pool-v4", offers: 512, tickets: 1451 })]);
    const pool = libraryPool("lincoln-pool-v4")!;
    expect(pool.offers).toHaveLength(512);
    expect(pool.offers[0]!.rankKey).toBe(pool.offers[0]!.pricePerTicketCents * 1000 + pool.offers[0]!.groupSize);
  });
});
