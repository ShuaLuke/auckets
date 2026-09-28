/** @vitest-environment node */
// Golden fixture: Cope's 512-offer pool on his 144-row Lincoln architecture
// (docs/GAE_SIMULATOR.md §4.9). These numbers are the ones the team has seen
// and discussed. If an engine change moves them, that is a decision, not a
// test to update quietly — acknowledge it in the PR and, if it stands,
// update the pins here with the reason.
//
// 2026-09-21: pins moved (1,133 → 1,129 placed, 98.35% → 98.00%) with no
// engine change. The venue file was wrong: ORCH C rows V–Y were one unbroken
// run each, but the tech/mix position sits in the middle of them (box-office
// manifest, 1-TECH), so they are 4+4, 4+4, 3+3, 3+3. The old numbers seated
// groups straight through the mix position.
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
    expect(run.metrics.fill).toMatchObject({ placedSeats: 1129, emptySeats: 23, orphanSeats: 16, unfilledSeats: 7, holesBySize: { 1: 23 }, emptySeatsOddRows: 8, emptySeatsEvenRows: 15, rowsFull: 122, rowsPartial: 15, rowsEmpty: 7 });
    expect(run.metrics.fill.fillRate).toBeCloseTo(1129 / 1152, 6);
    expect(run.metrics.revenue).toMatchObject({ grossPlacedCents: 42445000, unplacedValueCents: 7462500 });
    expect(run.metrics.offers).toMatchObject({ placed: 402, unplaced: 110 });
    expect(run.metrics.byGroupSize[1]).toMatchObject({ placed: 12, medianRowRank: 21 });
    expect(run.metrics.byGroupSize[2]).toMatchObject({ offers: 258, placed: 206 });
    expect(run.metrics.rankRespect).toMatchObject({ passedOver: 0, fitResolvedDeferrals: 54, waterfalled: 0 });
  });

  // The tech/mix position sits mid-row in ORCH C V–Y. A re-import from Cope's
  // workbook would flatten those rows back into one run; this catches it.
  it("never seats a group across the tech block", () => {
    const tech = venue.rows.filter((r) => venue.holdLabels?.[r.id] !== undefined);
    expect(tech.map((r) => r.id)).toEqual(["orch_c-v", "orch_c-w", "orch_c-x", "orch_c-y"]);
    for (const r of tech) {
      const held = r.seatNumbers.map((s, i) => (r.holds.includes(s) ? i : -1)).filter((i) => i >= 0);
      const [first, last] = [Math.min(...held), Math.max(...held)];
      expect(first).toBeGreaterThan(0);
      expect(last).toBeLessThan(r.capacity - 1);
      const sides = new Map<string, Set<"L" | "R">>();
      for (const a of run.result!.assignments.filter((x) => x.venueRowId === r.id)) {
        const side = a.positionIndex < first ? "L" : "R";
        sides.set(a.offerId, (sides.get(a.offerId) ?? new Set()).add(side));
      }
      for (const [id, s] of sides) expect(s.size, `${id} straddles the tech block in ${r.id}`).toBe(1);
    }
  });

  it("pins the exact seat map by hash", () => {
    expect(run.resultHash).toBe("5986f31b19a93e6f96b4492a63197231ce0fcb61d177611c0b2b40e9de365a0c");
  });
});
