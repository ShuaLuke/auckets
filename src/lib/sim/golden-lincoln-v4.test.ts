/** @vitest-environment node */
// Golden fixture: Cope's 512-offer pool on his 144-row Lincoln architecture
// (docs/GAE_SIMULATOR.md §4.9). These numbers are the ones the team has seen
// and discussed. If an engine change moves them, that is a decision, not a
// test to update quietly — acknowledge it in the PR and, if it stands,
// update the pins here with the reason.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { offersFromCsv } from "./pool";
import { runScenario } from "./run";
import { parseVenueFile } from "./venue";

const ROOT = process.cwd();
const venue = parseVenueFile(JSON.parse(readFileSync(join(ROOT, "sim/venues/lincoln-v4.json"), "utf8")), "lincoln-v4.json");
const offers = offersFromCsv(readFileSync(join(ROOT, "sim/pools/lincoln-pool-v4.csv"), "utf8"));

describe("golden — Cope's pool v4 on Lincoln v4 (greedy)", () => {
  const out = runScenario({ scenario: { name: "golden", venue: "lincoln-v4", pool: { file: "sim/pools/lincoln-pool-v4.csv" } }, venue, poolOffers: offers });
  const run = out.runs[0]!;

  it("inputs are what the team reviewed", () => {
    expect(venue.rows).toHaveLength(144);
    expect(out.venueSummary[0]).toMatchObject({ capacity: 1152, evenRows: 128, oddRows: 16, singleRows: 7, pairRows: 22, reliefFlaggedRows: 29 });
    expect(out.offerSummary).toMatchObject({ offers: 512, ticketsRequested: 1451 });
  });

  it("pins the fill report", () => {
    expect(run.violations).toEqual([]);
    expect(run.metrics.fill).toMatchObject({ placedSeats: 1133, emptySeats: 19, orphanSeats: 12, unfilledSeats: 7, holesBySize: { 1: 19 }, emptySeatsOddRows: 8, emptySeatsEvenRows: 11, rowsFull: 125, rowsPartial: 12, rowsEmpty: 7 });
    expect(run.metrics.fill.fillRate).toBeCloseTo(1133 / 1152, 6);
    expect(run.metrics.revenue).toMatchObject({ grossPlacedCents: 42555000, unplacedValueCents: 7352500 });
    expect(run.metrics.offers).toMatchObject({ placed: 404, unplaced: 108 });
    expect(run.metrics.byGroupSize[1]).toMatchObject({ placed: 12, medianRowRank: 21 });
    expect(run.metrics.byGroupSize[2]).toMatchObject({ offers: 258, placed: 208 });
    expect(run.metrics.rankRespect).toMatchObject({ passedOver: 0, fitResolvedDeferrals: 55, waterfalled: 0 });
  });

  it("pins the exact seat map by hash", () => {
    expect(run.resultHash).toBe("e0de3ce9dc0139d81797cbc3db5d6933c00df0c86e6d9e8ba22812a6166b4723");
  });
});
