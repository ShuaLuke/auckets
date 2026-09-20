/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { runScenario } from "./run";
import { binIndexFor, buildSeatMapView, priceBins, SEAT_EMPTY, SEAT_HELD, type SeatMapView } from "./seatmap";
import { offer, row, venue } from "./test-helpers";
import type { Scenario } from "./types";
import { applyShowOverlay } from "./venue";

const v = venue([
  row({ id: "a", rank: 1, cap: 4, tier: "premium" }),
  row({ id: "b", rank: 2, cap: 4, tier: "mid", area: "front_balcony" }),
  row({ id: "c", rank: 3, cap: 3, tier: "rear", area: "upper_balcony" }),
]);

const scenario: Scenario = {
  name: "map",
  venue: "test-venue",
  show: { holds: [{ source: "artist", tier: "premium", seats: 1 }] },
  pool: { file: "inline" },
  policies: ["greedy"],
};

// 3 seats left in row a after the hold. o1 takes them; o2 wanted premium-or-
// worse and waterfalls to mid; o3 fits beside it; o4 is priced out of nothing
// but has nowhere left that fits 4.
const pool = [
  offer("o1", 3, 12000, { type: "specific", tier: "premium" }, 0),
  offer("o2", 2, 9000, { type: "this_or_worse", tier: "premium" }, 1),
  offer("o3", 2, 7000, { type: "any" }, 2),
  offer("o4", 4, 5000, { type: "any" }, 3),
];

function build(): SeatMapView {
  const out = runScenario({ scenario, venue: v, poolOffers: pool, now: "2026-09-20T00:00:00Z" });
  const view = buildSeatMapView(out.runs[0]!, applyShowOverlay(v, scenario.show).venue);
  if (!view) throw new Error("expected a seat map for the first seed");
  return view;
}

describe("buildSeatMapView", () => {
  it("lays rows out in seat-rank order with one entry per physical seat", () => {
    const view = build();
    expect(view.rows.map((r) => r.rowRank)).toEqual([1, 2, 3]);
    expect(view.rows.map((r) => r.seats.length)).toEqual([4, 4, 3]);
    expect(view.rows[0]!.seats.filter((s) => s === SEAT_HELD)).toHaveLength(1);
    expect(view.heldSeats).toBe(1);
    expect(view.placedSeats + view.emptySeats + view.heldSeats).toBe(11);
  });

  it("points every occupied seat at the offer that paid for it", () => {
    const view = build();
    const priceAt = (rowIdx: number): number[] => view.rows[rowIdx]!.seats.filter((s) => s >= 0).map((s) => view.offers[s]!.priceCents);
    expect(priceAt(0)).toEqual([12000, 12000, 12000]);
    expect(priceAt(1).sort()).toEqual([7000, 7000, 9000, 9000]);
    expect(view.placedSeats).toBe(7);
    // Seat counts agree with the engine's own stats.
    const out = runScenario({ scenario, venue: v, poolOffers: pool, now: "2026-09-20T00:00:00Z" });
    expect(view.placedSeats).toBe(out.runs[0]!.stats.placedSeats);
  });

  it("carries offer rank, group size and tier outcome for the hover card", () => {
    const view = build();
    expect(view.totalOffers).toBe(4);
    expect(view.offers.map((o) => [o.id, o.offerRank, o.groupSize, o.outcome])).toEqual([
      ["o1", 1, 3, "preferred tier"],
      ["o2", 2, 2, "waterfalled down"],
      ["o3", 3, 2, "placed"],
    ]);
    expect(view.rows[2]!.seats).toEqual([SEAT_EMPTY, SEAT_EMPTY, SEAT_EMPTY]);
  });

  it("returns null for runs that dropped their engine output", () => {
    const out = runScenario({ scenario, venue: v, poolOffers: pool, now: "2026-09-20T00:00:00Z" });
    const slim = { ...out.runs[0]! };
    delete slim.result;
    expect(buildSeatMapView(slim, v)).toBeNull();
  });

  it("shows the price after an auto-bid raise, and what it was raised from", () => {
    const raised = runScenario({
      scenario,
      venue: v,
      // x2 loses the only 4-wide mid row to x1 unless auto-bid lifts it past $90.
      poolOffers: [offer("x1", 4, 9000, { type: "specific", tier: "mid" }, 0), offer("x2", 4, 8000, { type: "specific", tier: "mid" }, 1)],
      poolAutoBids: { x2: { capCents: 12000 } },
      now: "2026-09-20T00:00:00Z",
    });
    const view = buildSeatMapView(raised.runs[0]!, applyShowOverlay(v, scenario.show).venue)!;
    const x2 = view.offers.find((o) => o.id === "x2");
    expect(x2?.priceCents).toBeGreaterThan(9000);
    expect(x2?.raisedFromCents).toBe(8000);
  });
});

describe("priceBins", () => {
  const viewOf = (prices: [number, number][]): SeatMapView => ({
    policy: "greedy",
    seed: 1,
    rows: [],
    offers: prices.map(([priceCents, groupSize], i) => ({ id: `o${i}`, offerRank: i + 1, groupSize, priceCents, preference: "any", outcome: "placed" })),
    totalOffers: prices.length,
    placedSeats: 0,
    emptySeats: 0,
    heldSeats: 0,
  });

  it("splits by seats, not by dollars, so a long price tail doesn't flatten the scale", () => {
    // 90 seats at the floor-ish prices, one $500 whale.
    const bins = priceBins(viewOf([[4000, 32], [4500, 30], [5000, 28], [50000, 2]]), 3);
    expect(bins.map((b) => [b.minCents, b.maxCents])).toEqual([[4000, 4000], [4500, 4500], [5000, 50000]]);
    expect(bins.reduce((s, b) => s + b.seats, 0)).toBe(92);
  });

  it("never makes more bins than there are distinct prices, and none are empty", () => {
    const bins = priceBins(viewOf([[4000, 2], [6000, 2]]), 5);
    expect(bins).toHaveLength(2);
    expect(priceBins(viewOf([]), 5)).toEqual([]);
    const many = priceBins(viewOf(Array.from({ length: 40 }, (_, i) => [4000 + i * 500, 1 + (i % 4)] as [number, number])), 5);
    expect(many).toHaveLength(5);
    expect(many.every((b) => b.seats > 0)).toBe(true);
    for (let i = 1; i < many.length; i++) expect(many[i]!.minCents).toBeGreaterThan(many[i - 1]!.maxCents);
  });

  it("maps a price to its bin", () => {
    const bins = priceBins(viewOf([[4000, 10], [6000, 10], [9000, 10]]), 3);
    expect([4000, 6000, 9000].map((p) => binIndexFor(bins, p))).toEqual([0, 1, 2]);
  });
});
