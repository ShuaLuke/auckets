/** @vitest-environment node */
// Opt-in fill policies (types.ts AllocationConfig.fitPolicy / parityTiebreak /
// singlesReserve). Each test pins the mechanism on a hand-worked room and
// checks the default path is untouched.
import { describe, expect, it } from "vitest";

import { allocate } from "./index";
import { computeRankKey } from "./rankkey";
import type { AllocationConfig, RankedOffer, TierPreference, VenueRow } from "./types";

const base: AllocationConfig = { mode: "preview", allowOrphans: true, maxGroupSize: 10, orphanPolicy: "leave" };

function row(id: string, rank: number, cap: number, tier = "main"): VenueRow {
  return { id, area: "orchestra", section: "c", rowName: id, rowRank: rank, capacity: cap, parity: cap % 2 ? "ODD" : "EVEN", lean: "LEFT", seatNumbers: Array.from({ length: cap }, (_, i) => `${id}${i + 1}`), holds: [], tier };
}
function offer(id: string, size: number, price: number, pref: TierPreference = { type: "any" }, order = 0): RankedOffer {
  return { id, userId: id, showId: "s", groupSize: size, pricePerTicketCents: price, rankKey: computeRankKey(price, size), submittedAt: new Date(Date.UTC(2026, 0, 1) + order * 1000), tierPreference: pref };
}
const venue = (rows: VenueRow[]) => ({ venueId: "v", rows, activeRowIds: rows.map((r) => r.id) });
const rowOf = (r: ReturnType<typeof allocate>, id: string) => r.assignments.find((a) => a.offerId === id)?.venueRowId;

describe("fitPolicy: clean_fit", () => {
  // Row of 6 then row of 8. Pool: A4, B3, C3 (no 2s or 1s).
  // Greedy: A takes row 1 (remainder 2, nothing fits) → 2 seats stranded; B, C go to row 2.
  // Clean-fit: A would strand 2, so defer A and take B (remainder 3, fillable by C) → row 1 = B+C, A → row 2.
  const v = venue([row("r1", 1, 6), row("r2", 2, 8)]);
  const pool = [offer("A", 4, 10000), offer("B", 3, 9000), offer("C", 3, 8000)];

  it("greedy strands; clean-fit defers the fitting group and closes the row", () => {
    const inRow1 = (r: ReturnType<typeof allocate>) => r.assignments.filter((a) => a.venueRowId === "r1").length;
    const g = allocate(v, pool, base);
    expect(rowOf(g, "A")).toBe("r1");
    expect(inRow1(g)).toBe(4); // 2 stranded in the best row
    expect(g.stats.holesBySize).toEqual({ 2: 2 });

    const c = allocate(v, pool, { ...base, fitPolicy: "clean_fit" });
    expect(rowOf(c, "B")).toBe("r1");
    expect(rowOf(c, "C")).toBe("r1");
    expect(rowOf(c, "A")).toBe("r2");
    expect(inRow1(c)).toBe(6); // best row closes; the 4 empty seats sit together at the back
    expect(c.stats.holesBySize).toEqual({ 4: 1 });
    expect(c.stats.emptySeats).toBe(g.stats.emptySeats); // same tickets, same total empty — the shape moved
    const deferral = c.decisions.find((d) => d.action === "FIT_RESOLVED" && d.snapshot.policy === "clean_fit");
    expect(deferral).toMatchObject({ offerId: "B", venueRowId: "r1", snapshot: { skippedOfferIds: ["A"], strandedSeatsAvoided: 2 } });
  });

  it("falls back to greedy when stranding is unavoidable", () => {
    const c = allocate(venue([row("r1", 1, 6)]), [offer("A", 4, 10000), offer("B", 4, 9000)], { ...base, fitPolicy: "clean_fit" });
    expect(rowOf(c, "A")).toBe("r1");
    expect(c.stats.orphanSeats).toBe(2);
    expect(c.decisions.some((d) => d.snapshot.policy === "clean_fit")).toBe(false);
  });

  it("only counts offers compatible with the row when judging fillability", () => {
    // Row 1 is premium; the only 2 in the pool wants mid only, so A (4 of 6) still strands 2 → clean-fit defers A for B+C.
    const v2 = venue([row("p", 1, 6, "premium"), row("m", 2, 8, "mid")]);
    const pool2 = [offer("A", 4, 10000), offer("B", 3, 9000), offer("C", 3, 8000), offer("D", 2, 7000, { type: "specific", tier: "mid" })];
    const c = allocate(v2, pool2, { ...base, fitPolicy: "clean_fit" });
    expect(rowOf(c, "B")).toBe("p");
    expect(rowOf(c, "A")).toBe("m");
    expect(rowOf(c, "D")).toBe("m");
  });

  it("never touches GA rows and leaves the default path identical", () => {
    const ga = { ...row("ga", 1, 6), isGa: true };
    const a = allocate(venue([ga]), pool, base);
    const b = allocate(venue([ga]), pool, { ...base, fitPolicy: "clean_fit" });
    expect(b.assignments).toEqual(a.assignments);
  });
});

describe("parityTiebreak", () => {
  // Row of 5. Same price $100: A4, B3, C2 (rankKey order A, B, C).
  // Greedy: A (remainder 1, nothing fits) → 1 stranded. Parity: A is even into an odd run → look through the
  // same-price block: B is odd → take B (remainder 2), then A no longer fits, C fills → row closes.
  const v = venue([row("r1", 1, 5), row("r2", 2, 8)]);
  const same = [offer("A", 4, 10000), offer("B", 3, 10000), offer("C", 2, 10000)];

  it("prefers the parity-matching group at equal price, never across prices", () => {
    const inRow1 = (r: ReturnType<typeof allocate>) => r.assignments.filter((a) => a.venueRowId === "r1").length;
    const g = allocate(v, same, base);
    expect(inRow1(g)).toBe(4); // A, 1 stranded
    const p = allocate(v, same, { ...base, parityTiebreak: true });
    expect(rowOf(p, "B")).toBe("r1");
    expect(rowOf(p, "C")).toBe("r1");
    expect(rowOf(p, "A")).toBe("r2");
    expect(inRow1(p)).toBe(5);
    const pick = p.decisions.find((d) => d.snapshot.parityTiebreak === true);
    expect(pick).toMatchObject({ action: "PLACED", offerId: "B", snapshot: { tiedOverOfferIds: ["A"] } });

    // Different prices: no tie, so no reordering — identical to greedy.
    const diff = [offer("A", 4, 10000), offer("B", 3, 9900), offer("C", 2, 9800)];
    expect(allocate(v, diff, { ...base, parityTiebreak: true }).assignments).toEqual(allocate(v, diff, base).assignments);
  });
});

describe("singlesReserve", () => {
  // Row 1 (5 seats), row 2 (1 seat). A4 then S1 is the only single.
  // Greedy spends S on row 1's gap; row 2 stays empty. Reserve 1 holds S back; it goes to the 1-seat row.
  const v = venue([row("r1", 1, 5), row("r2", 2, 1)]);
  const pool = [offer("A", 4, 10000), offer("S", 1, 5000), offer("B", 4, 4000)];

  it("holds back the lowest-ranked compatible single and seats it in a 1-seat row after everyone else", () => {
    const g = allocate(v, pool, base);
    expect(rowOf(g, "S")).toBe("r1");
    expect(g.stats.unfilledSeats).toBe(1);

    const r = allocate(v, pool, { ...base, singlesReserve: 1 });
    expect(rowOf(r, "S")).toBe("r2");
    expect(r.stats.orphanSeats).toBe(1); // row 1's gap stays — the reserve alone doesn't fix fill, clean-fit does
    expect(r.stats.placedSeats).toBe(5);
    expect(r.decisions.find((d) => d.offerId === "S")?.snapshot.singlesReserve).toBe(true);
    expect(r.unplaced.map((u) => u.offerId)).toEqual(["B"]);
    // Total accounting still holds with the late passes folded in.
    expect(r.stats.placedSeats + r.stats.orphanSeats + r.stats.unfilledSeats).toBe(6);
  });

  it("reserves at most as many singles as there are 1-seat rows, lowest-ranked first, and only compatible ones", () => {
    const v2 = venue([row("p", 1, 3, "premium"), row("s", 2, 1, "rear")]);
    const pool2 = [offer("X", 1, 9000, { type: "specific", tier: "premium" }), offer("Y", 1, 8000), offer("Z", 1, 7000)];
    const r = allocate(v2, pool2, { ...base, singlesReserve: 5 });
    // Only Z (lowest, compatible with the rear 1-seat row) is reserved; X is premium-only so it is never a candidate.
    expect(rowOf(r, "Z")).toBe("s");
    expect(rowOf(r, "X")).toBe("p");
    expect(rowOf(r, "Y")).toBe("p");
  });

  it("with clean-fit, the reserve fills the 1-seat row and the main pass avoids the gap", () => {
    const v3 = venue([row("r1", 1, 6), row("r2", 2, 1), row("r3", 3, 8)]);
    const pool3 = [offer("A", 4, 10000), offer("B", 3, 9000), offer("C", 3, 8000), offer("S", 1, 2000)];
    const both = allocate(v3, pool3, { ...base, fitPolicy: "clean_fit", singlesReserve: 1 });
    expect(rowOf(both, "B")).toBe("r1");
    expect(rowOf(both, "C")).toBe("r1");
    expect(rowOf(both, "S")).toBe("r2");
    expect(rowOf(both, "A")).toBe("r3");
    expect(both.assignments.filter((a) => a.venueRowId === "r1" || a.venueRowId === "r2")).toHaveLength(7); // both front rows full
    expect(both.stats.holesBySize).toEqual({ 4: 1 }); // only the back row is open
    expect(both.stats.unfilledSeats).toBe(0);
  });
});
