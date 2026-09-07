/** @vitest-environment node */
// Slice 6 engine policies: lookahead (fill-first, one deferral per row) and
// protect-units (one group per table/box).
import { describe, expect, it } from "vitest";

import { allocate } from "./index";
import { computeRankKey } from "./rankkey";
import type { AllocationConfig, RankedOffer, VenueRow } from "./types";

const base: AllocationConfig = { mode: "preview", allowOrphans: true, maxGroupSize: 10, orphanPolicy: "leave" };
function row(id: string, rank: number, cap: number, area = "orchestra"): VenueRow {
  return { id, area, section: "c", rowName: id, rowRank: rank, capacity: cap, parity: cap % 2 ? "ODD" : "EVEN", lean: "LEFT", seatNumbers: Array.from({ length: cap }, (_, i) => `${id}${i + 1}`), holds: [], tier: "main" };
}
function offer(id: string, size: number, price: number): RankedOffer {
  return { id, userId: id, showId: "s", groupSize: size, pricePerTicketCents: price, rankKey: computeRankKey(price, size), submittedAt: new Date(Date.UTC(2026, 0, 1)), tierPreference: { type: "any" } };
}
const venue = (rows: VenueRow[]) => ({ venueId: "v", rows, activeRowIds: rows.map((r) => r.id) });
const rowOf = (r: ReturnType<typeof allocate>, id: string) => r.assignments.find((a) => a.offerId === id)?.venueRowId;
const inRow = (r: ReturnType<typeof allocate>, id: string) => r.assignments.filter((a) => a.venueRowId === id).length;

describe("fitPolicy: lookahead", () => {
  // Row 1 has 5 seats, row 2 has 4. Pool: A3, B2, C4 (rank order).
  // Greedy: row 1 = A+B (full), row 2: C(4) fits → full too. No stranding → lookahead must not deviate.
  it("keeps the greedy selection when nothing is stranded", () => {
    const v = venue([row("r1", 1, 5), row("r2", 2, 4)]);
    const pool = [offer("A", 3, 10000), offer("B", 2, 9000), offer("C", 4, 8000)];
    const g = allocate(v, pool, base);
    const l = allocate(v, pool, { ...base, fitPolicy: "lookahead", lookaheadRows: 1 });
    expect(l.assignments).toEqual(g.assignments);
    expect(l.decisions.some((d) => d.snapshot.policy === "lookahead")).toBe(false);
  });

  // Row 1: 6 seats, row 2: 4 seats. Pool: A4, B2, C4, D2.
  // Greedy: row 1 = A+B (6, full); row 2 = C (4, full). D unplaced, nothing stranded. Fine.
  // Make it strand: row 1: 6, row 2: 5. Pool A4, B2, C3, D3.
  // Greedy: row 1 = A+B; row 2: C(3) then D(3) doesn't fit 2 → 2 stranded. Total stranded 2.
  // Defer B from row 1: row 1 = A + (C? no, 2 left → nothing fits... C3 no) → A only, 2 stranded; row 2: B? B(2) fits then C(3) fits → full. Total 2. No better.
  // Defer A: row 1 = B+C (5) + D? 1 left → no → 1 stranded; row 2: A(4) → 1 stranded. Total 2. No better.
  // So use rows 6 and 6 with A4, B2, C3, D3: greedy row1 A+B full; row2 C+D full. no strand.
  // Rows 7 and 6, pool A4, B3, C3, D3: greedy row1 A+B (7 full); row2 C+D (6 full). fine.
  // Rows 6 and 7, pool A4, B2, C3, D4: greedy row1 A+B full; row2 C(3)+D(4) =7 full. fine.
  // Rows 5 and 6: pool A3, B2, C4, D2: greedy row1 A+B full; row2 C+D full.
  // Need strand: rows 6 and 5, pool A4, B2, C3, D2: greedy row1 A+B (6); row2 C(3)+D(2)=5 full. fine.
  // rows 6 and 5, pool A4, B2, C4, D1? greedy row1 A+B; row2 C(4)+D(1) full.
  // rows 5 and 6, pool A4, B3, C3, D2: greedy row1 A(4) rem1 → nothing → 1 stranded; row2 B+C=6 full; D unplaced. stranded 1.
  //   Defer A: row1 B(3)+D(2)=5 full; row2 A(4)+? C(3) no → 2 stranded. worse (2).
  //   So no change. Hmm. rows 5 and 7, pool A4, B3, C3, D1... greedy row1 A+D full; row2 B+C=6 → 1 stranded. Defer A: row1 B+D? B3 then C? no (2 left) D1 → 4 → 1 stranded; row2 A4+C3 = 7 full → total 1. tie → keep greedy.
  // rows 5 and 7, pool A4, B3, C3, D2: greedy row1 A(4) rem 1 → nothing → 1; row2 B+C=6 rem 1 → D(2) no → 1. total 2.
  //   Defer A: row1 B(3)+D(2)=5 full; row2 A(4)+C(3)=7 full. total 0. Lookahead should defer A.
  it("defers one fitting offer when that leaves fewer stranded seats across the window", () => {
    const v = venue([row("r1", 1, 5), row("r2", 2, 7)]);
    const pool = [offer("A", 4, 10000), offer("B", 3, 9000), offer("C", 3, 8000), offer("D", 2, 7000)];
    const g = allocate(v, pool, base);
    expect(g.stats.emptySeats).toBe(2);
    const l = allocate(v, pool, { ...base, fitPolicy: "lookahead", lookaheadRows: 1 });
    expect(l.stats.emptySeats).toBe(0);
    expect(rowOf(l, "A")).toBe("r2");
    expect(inRow(l, "r1")).toBe(5);
    const d = l.decisions.find((x) => x.snapshot.policy === "lookahead");
    expect(d).toMatchObject({ action: "FIT_RESOLVED", venueRowId: "r1", snapshot: { skippedOfferIds: ["A"], strandedSeatsAvoided: 2 } });
    // Without a next row in view a deferral would drop A entirely, so greedy stands (defer, never drop).
    const l0 = allocate(venue([row("r1", 1, 5)]), pool, { ...base, fitPolicy: "lookahead", lookaheadRows: 1 });
    expect(rowOf(l0, "A")).toBe("r1");
  });
});

describe("unitPolicy: protect", () => {
  const tables = venue([row("t1", 1, 4, "tables"), row("t2", 2, 4, "tables"), row("r", 3, 6)]);
  const pool = [offer("A", 2, 10000), offer("B", 2, 9000), offer("C", 3, 8000)];

  it("co-seat (default) shares a table; protect gives each group its own and closes the rest", () => {
    const co = allocate(tables, pool, base);
    expect(rowOf(co, "A")).toBe("t1");
    expect(rowOf(co, "B")).toBe("t1"); // strangers at one 4-top
    const pr = allocate(tables, pool, { ...base, unitPolicy: "protect" });
    expect(rowOf(pr, "A")).toBe("t1");
    expect(rowOf(pr, "B")).toBe("t2");
    expect(rowOf(pr, "C")).toBe("r");
    expect(inRow(pr, "t1")).toBe(2);
    expect(inRow(pr, "t2")).toBe(2);
    expect(pr.stats.orphanSeats).toBe(7); // two protected 4-tops keep 2 seats empty each, plus 3 in the row
    // Ordinary rows are unaffected by the unit policy.
    const rowsOnly = venue([row("r1", 1, 4)]);
    expect(allocate(rowsOnly, pool, { ...base, unitPolicy: "protect" }).assignments).toEqual(allocate(rowsOnly, pool, base).assignments);
  });
});
