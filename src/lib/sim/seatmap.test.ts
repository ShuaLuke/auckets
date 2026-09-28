/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { runScenario } from "./run";
import { libraryPool, libraryVenue } from "./library";
import { binIndexFor, buildRoomView, buildSeatMapView, fillOrder, filterSeatMapView, priceBins, quantileBins, roomRules, seatingChart, summariseSections, SEAT_EMPTY, SEAT_HELD, type SeatMapView } from "./seatmap";
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

  it("names why a row's held seats are held, when the venue says", () => {
    const labelled = { ...applyShowOverlay(v, scenario.show).venue, holdLabels: { a: "Tech / mix position" } };
    const out = runScenario({ scenario, venue: v, poolOffers: pool, now: "2026-09-20T00:00:00Z" });
    const view = buildSeatMapView(out.runs[0]!, labelled)!;
    expect(view.rows[0]!.holdLabel).toBe("Tech / mix position");
    expect(view.rows[1]!.holdLabel).toBeUndefined();
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

describe("buildRoomView", () => {
  it("is the venue with nobody seated: every seat on sale empty, holds held, ranks and parity carried", () => {
    const room = buildRoomView(applyShowOverlay(v, scenario.show).venue);
    expect(room.policy).toBe("room");
    expect(room.offers).toEqual([]);
    expect(room.totalOffers).toBe(0);
    expect(room.rows.map((r) => r.rowRank)).toEqual([1, 2, 3]);
    expect(room.rows[0]!.seats).toEqual([SEAT_HELD, SEAT_EMPTY, SEAT_EMPTY, SEAT_EMPTY]);
    expect(room.rows.map((r) => r.parity)).toEqual(["ODD", "EVEN", "ODD"]); // a's hold makes it 3 on sale
    expect(room).toMatchObject({ placedSeats: 0, emptySeats: 10, heldSeats: 1 });
  });

  it("leaves parity off GA pens and names a labelled hold", () => {
    const ga = venue([row({ id: "pit", rank: 1, cap: 50, tier: "premium", isGa: true }), row({ id: "b", rank: 2, cap: 6, tier: "mid", holds: ["3", "4"] })], { holdLabels: { b: "Tech / mix position" } });
    const room = buildRoomView(ga);
    expect(room.rows[0]!.parity).toBeUndefined();
    expect(room.rows[1]!.parity).toBe("EVEN");
    expect(room.rows[1]!.holdLabel).toBe("Tech / mix position");
  });
});

describe("fillOrder", () => {
  const open = (n: number): number[] => Array.from({ length: n }, () => SEAT_EMPTY);

  it("follows the row's lean: front to back, back to front, middle out, both aisles in", () => {
    expect(fillOrder("LEFT", open(5))).toEqual([1, 2, 3, 4, 5]);
    expect(fillOrder("RIGHT", open(5))).toEqual([5, 4, 3, 2, 1]);
    // CENTER: Placement puts rank 0 in the middle, 1 to its left, 2 to its right…
    expect(fillOrder("CENTER", open(5))).toEqual([4, 2, 1, 3, 5]);
    expect(fillOrder("CENTER", open(8))).toEqual([8, 6, 4, 2, 1, 3, 5, 7]);
    expect(fillOrder("DUAL_AISLE", open(5))).toEqual([1, 3, 5, 4, 2]);
  });

  it("restarts at each run around a hold, left run first, and skips held seats", () => {
    const seats = [SEAT_EMPTY, SEAT_EMPTY, SEAT_EMPTY, SEAT_HELD, SEAT_HELD, SEAT_EMPTY, SEAT_EMPTY, SEAT_EMPTY];
    expect(fillOrder("CENTER", seats)).toEqual([2, 1, 3, -1, -1, 5, 4, 6]);
    expect(fillOrder("RIGHT", seats)).toEqual([3, 2, 1, -1, -1, 6, 5, 4]);
  });

  it("ignores lean on a GA pen and leaves an occupied seat's order alone", () => {
    expect(fillOrder("CENTER", open(4), true)).toEqual([1, 2, 3, 4]);
    // Occupied seats still count as positions in the row's order.
    expect(fillOrder("LEFT", [0, 0, SEAT_EMPTY, SEAT_EMPTY])).toEqual([1, 2, 3, 4]);
  });
});

describe("roomRules", () => {
  it("counts what a venue needs to know: ranks, leans, parity, holds by reason, tiers with floors", () => {
    const vv = venue(
      [
        row({ id: "a", rank: 1, cap: 4, tier: "premium", lean: "CENTER" }),
        row({ id: "b", rank: 2, cap: 5, tier: "mid", lean: "RIGHT", holds: ["1"] }),
        row({ id: "c", rank: 3, cap: 3, tier: "mid", lean: "LEFT" }),
        row({ id: "d", rank: 4, cap: 1, tier: "rear", lean: "DUAL_AISLE" }),
        row({ id: "pit", rank: 5, cap: 20, tier: "rear", isGa: true }),
      ],
      { holdLabels: { b: "Tech / mix position" } },
    );
    expect(roomRules(vv)).toEqual({
      rows: 5,
      seatsOnSale: 32,
      heldSeats: 1,
      gaSeats: 20,
      unitRows: 0,
      bestRank: 1,
      worstRank: 5,
      leans: { CENTER: 1, LEFT: 1, RIGHT: 1, DUAL_AISLE: 1 },
      evenRows: 2,
      oddRows: 2,
      singleRows: 1,
      tiers: [
        { name: "premium", rows: 1, seats: 4, floorCents: 10000 },
        { name: "mid", rows: 2, seats: 7, floorCents: 6000 },
        { name: "rear", rows: 2, seats: 21, floorCents: 4000 },
      ],
      holds: [{ label: "Tech / mix position", seats: 1 }],
    });
  });

  it("calls an unlabelled hold what it is, and counts tables and boxes apart from leaned rows", () => {
    const vv = venue([row({ id: "t1", rank: 1, cap: 8, tier: "premium", area: "tables", section: "Table 1", holds: ["8"] })]);
    const rules = roomRules(vv);
    expect(rules.unitRows).toBe(1);
    expect(rules.leans).toEqual({ CENTER: 0, LEFT: 0, RIGHT: 0, DUAL_AISLE: 0 });
    expect(rules.holds).toEqual([{ label: "Held", seats: 1 }]);
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

describe("seatingChart", () => {
  const chartFor = (venueName: string, scenarioExtra: Partial<Scenario> = {}) => {
    const lib = libraryVenue(venueName)!;
    const sc: Scenario = { name: "chart", venue: venueName, pool: { generate: { seed: 1, oversubscription: 1.1, groupSizeMix: "couples", priceModel: { kind: "ladder" } } }, policies: ["greedy"], ...scenarioExtra };
    const out = runScenario({ scenario: sc, venue: lib, now: "2026-09-20T00:00:00Z" });
    const view = buildSeatMapView(out.runs[0]!, applyShowOverlay(lib, sc.show).venue)!;
    return { view, chart: seatingChart(view) };
  };

  it("draws the Lincoln as levels, with sections house-left to house-right around the centre", () => {
    const pool = libraryPool("lincoln-pool-v4")!;
    const lib = libraryVenue("lincoln-v4")!;
    const sc: Scenario = { name: "chart", venue: "lincoln-v4", pool: { file: "library:lincoln-pool-v4" }, policies: ["greedy"] };
    const out = runScenario({ scenario: sc, venue: lib, poolOffers: pool.offers, poolAutoBids: pool.autoBids, now: "2026-09-20T00:00:00Z" });
    const view = buildSeatMapView(out.runs[0]!, lib)!;
    const chart = seatingChart(view);

    expect(chart.map((l) => l.area)).toEqual(["orchestra", "front_balcony", "upper_balcony"]);
    expect(chart[0]!.sections.map((s) => [s.name, s.side])).toEqual([["ORCH L", "left"], ["ORCH C", "centre"], ["ORCH R", "right"]]);
    // The far-side balcony blocks sit outside the centre pair.
    expect(chart[2]!.sections.map((s) => s.name)).toEqual(["L BALC", "CL BAL", "CR BAL", "R BALC"]);

    // Row A of all three orchestra blocks shares a line; AA and BB (centre only) come first.
    const orch = chart[0]!;
    expect(orch.lines.slice(0, 3).map((l) => l.rowName)).toEqual(["AA", "BB", "A"]);
    expect(orch.lines[0]!.rows.map((r) => r !== null)).toEqual([false, true, false]);
    const lineA = orch.lines[2]!;
    expect(lineA.rows.map((i) => (i === null ? null : `${view.rows[i]!.section} ${view.rows[i]!.rowName}`))).toEqual(["ORCH L A", "ORCH C A", "ORCH R A"]);
    expect(orch.widthSeats).toBe(8 + 20 + 8);

    // Every row is drawn exactly once.
    const drawn = chart.flatMap((l) => [...l.lines.flatMap((ln) => ln.rows.filter((i): i is number => i !== null)), ...l.units.map((u) => u.row)]);
    expect([...drawn].sort((a, b) => a - b)).toEqual(view.rows.map((_, i) => i));
  });

  it("pulls tables, boxes and GA pens out as labelled units", () => {
    const { view, chart } = chartFor("supper-club");
    const tables = chart.find((l) => l.area === "tables")!;
    expect(tables.lines).toEqual([]);
    expect(tables.units.slice(0, 2).map((u) => u.label)).toEqual(["Table 1", "Table 2"]);
    expect(tables.units).toHaveLength(view.rows.filter((r) => r.unit).length);
    expect(chart.find((l) => l.area === "ga")!.units.map((u) => u.label)).toEqual(["GA"]);

  });

  it("lines the Lincoln's boxes along the side walls of the orchestra, as the theatre's own map does", () => {
    const { view, chart } = chartFor("lincoln-manifest");
    const orch = chart[0]!;
    expect(orch.area).toBe("orchestra");
    // House left and house right, each from the stage back (tech specs p.10).
    expect(orch.leftWall.map((u) => u.label)).toEqual(["BOX A", "BOX C", "BOX D", "BOX E", "BOX F"]);
    expect(orch.rightWall.map((u) => u.label)).toEqual(["BOX B", "BOX K", "BOX J", "BOX H", "BOX G"]);
    // They moved — they weren't copied: no separate boxes strip, and every row is still drawn once.
    expect(chart.find((l) => l.area === "boxes")).toBeUndefined();
    const drawn = chart.flatMap((l) => [...l.lines.flatMap((ln) => ln.rows.filter((i): i is number => i !== null)), ...l.units.map((u) => u.row), ...l.leftWall.map((u) => u.row), ...l.rightWall.map((u) => u.row)]);
    expect([...drawn].sort((a, b) => a - b)).toEqual(view.rows.map((_, i) => i));
    // The four nearest the stage are box-office holds; D–J are on sale.
    const held = (label: string): boolean => view.rows[[...orch.leftWall, ...orch.rightWall].find((u) => u.label === label)!.row]!.seats.every((c) => c === SEAT_HELD);
    expect(["BOX A", "BOX B", "BOX C", "BOX K"].every(held)).toBe(true);
    expect(held("BOX D")).toBe(false);

    // Opened on its own (no floor to flank), a box is an ordinary unit again.
    const alone = seatingChart(filterSeatMapView(view, (r) => r.section === "BOX D"));
    expect(alone).toHaveLength(1);
    expect(alone[0]!.units.map((u) => u.label)).toEqual(["BOX D"]);
    expect(alone[0]!.leftWall).toEqual([]);
  });

  it("leaves a venue with no wall sections exactly as it was", () => {
    const { view, chart } = chartFor("lincoln-v4");
    expect(view.wallRows).toBeUndefined();
    expect(chart.every((l) => l.leftWall.length === 0 && l.rightWall.length === 0)).toBe(true);
  });

  it("centres a room with a single block instead of leaning it to one side", () => {
    const { chart } = chartFor("copes-place");
    expect(chart[0]!.sections.map((s) => s.side)).toEqual(["centre"]);
  });
});

describe("summariseSections / filterSeatMapView", () => {
  const lincoln = (): SeatMapView => {
    const pool = libraryPool("lincoln-pool-v4")!;
    const lib = libraryVenue("lincoln-v4")!;
    const sc: Scenario = { name: "sec", venue: "lincoln-v4", pool: { file: "library:lincoln-pool-v4" }, policies: ["greedy"] };
    const out = runScenario({ scenario: sc, venue: lib, poolOffers: pool.offers, poolAutoBids: pool.autoBids, now: "2026-09-20T00:00:00Z" });
    return buildSeatMapView(out.runs[0]!, lib)!;
  };

  it("rolls the room up one block per section, and the blocks add back up to the room", () => {
    const view = lincoln();
    const map = summariseSections(view);
    expect(map.sections.map((s) => s.section).slice(0, 3)).toEqual(["ORCH C", "ORCH R", "ORCH L"]); // best row rank first
    expect(map.sections).toHaveLength(10);
    const sum = (f: (s: (typeof map.sections)[number]) => number): number => map.sections.reduce((t, s) => t + f(s), 0);
    expect(sum((s) => s.placedSeats)).toBe(view.placedSeats);
    expect(sum((s) => s.emptySeats)).toBe(view.emptySeats);
    expect(sum((s) => s.offers)).toBe(view.offers.length);
    expect(sum((s) => s.grossCents)).toBe(view.offers.reduce((t, o) => t + o.priceCents * o.groupSize, 0));
    const orchC = map.sections[0]!;
    expect(orchC.avgPriceCents).toBe(Math.round(orchC.grossCents / orchC.placedSeats));
    expect(orchC.minPriceCents!).toBeLessThanOrEqual(orchC.avgPriceCents!);
    expect(orchC.maxPriceCents!).toBeGreaterThanOrEqual(orchC.avgPriceCents!);
    // Dearest block is the centre orchestra; the far balcony is the cheapest.
    expect(orchC.avgPriceCents!).toBeGreaterThan(map.sections.at(-1)!.avgPriceCents!);
  });

  it("reports a section nobody sat in as empty, not as a $0 average", () => {
    const v2 = venue([row({ id: "a", rank: 1, cap: 2, tier: "premium" }), row({ id: "z", rank: 2, cap: 6, tier: "rear", section: "far" })]);
    const sc: Scenario = { name: "e", venue: "test-venue", pool: { file: "inline" }, policies: ["greedy"] };
    const out = runScenario({ scenario: sc, venue: v2, poolOffers: [offer("o1", 2, 9000, { type: "specific", tier: "premium" })], now: "2026-09-20T00:00:00Z" });
    const far = summariseSections(buildSeatMapView(out.runs[0]!, v2)!).sections.find((s) => s.section === "far")!;
    expect(far).toMatchObject({ placedSeats: 0, emptySeats: 6, seats: 6, offers: 0, avgPriceCents: null, minPriceCents: null });
  });

  it("cuts one level out of the room with its offers re-indexed", () => {
    const view = lincoln();
    const balcony = filterSeatMapView(view, (r) => r.area === "front_balcony");
    expect(new Set(balcony.rows.map((r) => r.area))).toEqual(new Set(["front_balcony"]));
    expect(balcony.offers.length).toBeLessThan(view.offers.length);
    expect(balcony.totalOffers).toBe(view.totalOffers);
    // Every seat still resolves to the same offer it did in the full room.
    const fullRow = view.rows.find((r) => r.id === balcony.rows[0]!.id)!;
    balcony.rows[0]!.seats.forEach((code, i) => {
      const before = fullRow.seats[i]!;
      if (before < 0) expect(code).toBe(before);
      else expect(balcony.offers[code]).toBe(view.offers[before]);
    });
    expect(balcony.placedSeats).toBe(balcony.rows.flatMap((r) => r.seats).filter((c) => c >= 0).length);
    expect(summariseSections(balcony).sections).toEqual(summariseSections(view).sections.filter((s) => s.area === "front_balcony"));
  });

  it("bins section averages with the same seat-weighted scale", () => {
    expect(quantileBins([[4000, 100], [9000, 100], [20000, 0]], 5).map((b) => b.maxCents)).toEqual([4000, 9000]);
  });
});
