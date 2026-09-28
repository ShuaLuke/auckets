/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { allocateFirstCome } from "./baseline";
import { checkInvariants } from "./invariants";
import { countFitInversions } from "./metrics";
import { parsePolicy } from "./policy";
import { runScenario } from "./run";
import { offer, row, venue } from "./test-helpers";
import { toArchitecture } from "./venue";

// premium: row a (4 seats, rank 1) · mid: row b (4, rank 2) · rear: row c (3, rank 3)
const v = venue([row({ id: "a", rank: 1, cap: 4, tier: "premium", lean: "CENTER" }), row({ id: "b", rank: 2, cap: 4, tier: "mid" }), row({ id: "c", rank: 3, cap: 3, tier: "rear" })]);
const floors = { premium: 10000, mid: 6000, rear: 4000 };

describe("allocateFirstCome — the old way", () => {
  it("sells in arrival order at face, best available first, and ignores what was offered", () => {
    // Arrivals: p (2 @ $70, any) first, then q (2 @ $150, any), then r (2 @ $95, any).
    const pool = [offer("q", 2, 15000, { type: "any" }, 1), offer("p", 2, 7000, { type: "any" }, 0), offer("r", 2, 9500, { type: "any" }, 2)];
    const { result, paidCents } = allocateFirstCome(toArchitecture(v), pool, floors, "as-submitted");
    const rowOf = (id: string): string => result.assignments.find((a) => a.offerId === id)!.venueRowId;
    // p can't afford premium ($100) → buys mid at $60 even though it arrived first.
    expect(rowOf("p")).toBe("b");
    expect(paidCents.p).toBe(6000);
    // q arrives second, can afford premium → best row, pays face $100 not $150.
    expect(rowOf("q")).toBe("a");
    expect(paidCents.q).toBe(10000);
    // r can't afford premium; mid has 2 seats left → mid.
    expect(rowOf("r")).toBe("b");
    expect(result.stats.placedSeats).toBe(6);
    expect(result.unplaced).toEqual([]);
    expect(checkInvariants(v, pool, result)).toEqual([]);
  });

  it("prices out an offer under face everywhere it would sit, and sells out a fan who arrives too late", () => {
    const pool = [
      offer("cheap", 1, 3000, { type: "any" }, 0), // under every face
      offer("picky", 2, 20000, { type: "specific", tier: "premium" }, 1),
      offer("late", 4, 20000, { type: "specific", tier: "premium" }, 2), // premium has 2 left after picky
      offer("worse", 3, 6500, { type: "this_or_worse", tier: "premium" }, 3), // can't afford premium, takes mid
    ];
    const out = allocateFirstCome(toArchitecture(v), pool, floors, "as-submitted");
    expect(out.pricedOut).toEqual(["cheap"]);
    expect(out.soldOut).toEqual(["late"]);
    expect(out.result.unplaced).toEqual([
      { offerId: "cheap", reason: "no_compatible_tier" },
      { offerId: "late", reason: "no_fit_anywhere" },
    ]);
    expect(out.result.assignments.filter((a) => a.offerId === "worse").map((a) => a.venueRowId)).toEqual(["b", "b", "b"]);
    expect(out.paidCents.worse).toBe(6000);
  });

  it("never seats a group across a hold, sits one party by the row's lean, and needs a face price for every tier", () => {
    const held = venue([row({ id: "a", rank: 1, cap: 6, tier: "premium", lean: "CENTER", holds: ["3", "4"] })], { tierFloorsCents: { premium: 5000 } });
    const out = allocateFirstCome(toArchitecture(held), [offer("g3", 3, 5000, { type: "any" }, 0), offer("g2", 2, 5000, { type: "any" }, 1)], { premium: 5000 }, "as-submitted");
    expect(out.soldOut).toEqual(["g3"]); // runs are 2 + 2; a 3 never fits
    expect(out.result.assignments.map((a) => a.positionIndex).sort()).toEqual([0, 1]);
    expect(() => allocateFirstCome(toArchitecture(v), [], { premium: 10000 }, "as-submitted")).toThrow(/no face price for tier "mid"/);
  });
});

describe("countFitInversions", () => {
  const at = (rowRank: number, size = 2): { rowRank: number; size: number } => ({ rowRank, size });
  it("counts pairs where an earlier (better) offer sits in a worse row it could have had", () => {
    expect(countFitInversions([at(1), at(2), at(3)])).toBe(0);
    expect(countFitInversions([at(3), at(2), at(1)])).toBe(3);
    expect(countFitInversions([at(2), at(1), at(2), at(1)])).toBe(3); // equal rows aren't inversions
    expect(countFitInversions([])).toBe(0);
  });
  it("is subject to fit: a four behind a pair that took the last two seats is not an inversion", () => {
    expect(countFitInversions([at(5, 4), at(3, 2)])).toBe(0);
    expect(countFitInversions([at(5, 2), at(3, 4)])).toBe(1); // a pair behind a four could have had two of those seats
  });
});

describe("first-come as a policy in a run", () => {
  it("parses as the baseline, runs beside the engine, and reports face gross and what was left on the table", () => {
    expect(parsePolicy("first-come", v)).toMatchObject({ baseline: "first-come", rankFirst: false });
    expect(() => parsePolicy("first-come+clean-fit", v)).toThrow(/unknown policy/);
    const pool = [offer("q", 2, 15000, { type: "any" }, 1), offer("p", 2, 7000, { type: "any" }, 0), offer("r", 2, 9500, { type: "any" }, 2), offer("cheap", 1, 3000, { type: "any" }, 3)];
    const out = runScenario({ scenario: { name: "x", venue: "test-venue", pool: { file: "inline" }, policies: ["first-come", "greedy"], firstComeArrival: "as-submitted" }, venue: v, poolOffers: pool, now: "2026-09-28T00:00:00Z" });
    const old = out.runs.find((r) => r.policy === "first-come")!;
    const ours = out.runs.find((r) => r.policy === "greedy")!;
    expect(old.violations).toEqual([]);
    // Old way: q pays $100×2, p and r pay $60×2 each → $440. Offered above face: (150-100)×2 + (70-60)×2 + (95-60)×2 = $190.
    expect(old.metrics.revenue.grossPlacedCents).toBe(44000);
    expect(old.metrics.firstCome).toMatchObject({ offeredAboveFaceCents: 19000, pricedOutOffers: 1, pricedOutTickets: 1, pricedOutValueCents: 3000, soldOutOffers: 0 });
    expect(old.paidCents).toEqual({ q: 10000, p: 6000, r: 6000 });
    // r offered more than p but sits beside it in the same row (same tier): no inversion.
    expect(old.metrics.rankRespect.inversions).toBe(0);
    expect(ours.metrics.rankRespect.inversions).toBe(0);
    // Ours: everyone pays their offer; q premium, r mid, p mid, cheap rear.
    expect(ours.metrics.revenue.grossPlacedCents).toBe(15000 * 2 + 9500 * 2 + 7000 * 2 + 3000);
    expect(ours.metrics.firstCome).toBeUndefined();
    expect(out.aggregates.find((a) => a.policy === "first-come")!.scalars["firstCome.offeredAboveFaceCents"]!.p50).toBe(19000);
  });

  it("shuffles arrivals by default, the same way for the same seed, whatever order the pool came in", () => {
    // A pool that arrives in exact price order, like Cope's sheet: as-submitted would make the old way look like rank order.
    const pool = Array.from({ length: 12 }, (_, i) => offer(`o${String(i).padStart(2, "0")}`, 1, 20000 - i * 1000, { type: "any" }, i));
    const big = venue([row({ id: "a", rank: 1, cap: 6, tier: "premium" }), row({ id: "b", rank: 2, cap: 6, tier: "mid" })]);
    const arch = toArchitecture(big);
    const faces = { premium: 5000, mid: 4000, rear: 3000 };
    const first = allocateFirstCome(arch, pool, faces, "random", 7);
    const again = allocateFirstCome(arch, [...pool].reverse(), faces, "random", 7);
    expect(again.result.assignments).toEqual(first.result.assignments);
    const other = allocateFirstCome(arch, pool, faces, "random", 8);
    expect(other.result.assignments).not.toEqual(first.result.assignments);
    const inOrder = allocateFirstCome(arch, pool, faces, "as-submitted");
    expect(inOrder.result.assignments.filter((a) => a.venueRowId === "a").map((a) => a.offerId).sort()).toEqual(["o00", "o01", "o02", "o03", "o04", "o05"]);
    expect(first.result.assignments.filter((a) => a.venueRowId === "a").map((a) => a.offerId).sort()).not.toEqual(["o00", "o01", "o02", "o03", "o04", "o05"]);
  });
});
