/** @vitest-environment node */
// Slice 4 inputs: the Bleacher carve-out (NEW-8) and private offers (ADR-0017).
import { describe, expect, it } from "vitest";

import { generatePool } from "./demand";
import { loadPoolCsv, poolToCsv } from "./pool";
import { renderFillReport } from "./report";
import { runScenario } from "./run";
import { row, venue } from "./test-helpers";
import type { DemandModel, Scenario } from "./types";
import { applyShowOverlay } from "./venue";

const v = venue([
  row({ id: "a", rank: 1, cap: 10, tier: "premium" }),
  row({ id: "b", rank: 2, cap: 10, tier: "mid", area: "front_balcony" }),
  row({ id: "c", rank: 3, cap: 6, tier: "rear", area: "upper_balcony" }),
  row({ id: "d", rank: 4, cap: 4, tier: "rear", area: "upper_balcony" }),
]);

describe("Bleacher carve-out", () => {
  it("holds whole rows from the worst rank up until the share is met, tagged bleacher", () => {
    const r = applyShowOverlay(v, { bleacher: { sharePct: 20, priceCents: 2500 } });
    // 30 seats on sale → target 6 → row d (4) then row c (6) = 10 seats, 2 rows
    expect(r.bleacher).toMatchObject({ seats: 10, rows: 2, priceCents: 2500, rowIds: ["d", "c"] });
    expect(r.heldBySource.bleacher).toBe(10);
    expect(r.venue.rows.find((x) => x.id === "d")!.holds).toHaveLength(4);
    expect(r.venue.rows.find((x) => x.id === "a")!.holds).toHaveLength(0);
    expect(v.rows.find((x) => x.id === "d")!.holds).toHaveLength(0); // library venue untouched
  });

  it("reports the carve-out as an estimate next to the engine's gross", () => {
    const pool = loadPoolCsv("id,size,price\nA,4,100\nB,4,90\nC,2,80\nD,4,70\nE,4,60\nF,2,50\nG,4,40\nH,2,30\n"); // 26 tickets
    const scenario: Scenario = { name: "bl", venue: "test-venue", show: { bleacher: { sharePct: 20, priceCents: 2500 } }, pool: { file: "p.csv" } };
    const out = runScenario({ scenario, venue: v, poolOffers: pool.offers });
    const m = out.runs[0]!.metrics;
    expect(m.capacity.availableSeats).toBe(20);
    expect(m.bleacher).toMatchObject({ seats: 10, rows: 2, priceCents: 2500, grossIfSoldOutCents: 25000 });
    expect(m.bleacher!.overflowTickets).toBe(26 - m.fill.placedSeats);
    expect(m.bleacher!.estSoldSeats).toBe(Math.min(10, m.bleacher!.overflowTickets));
    expect(m.bleacher!.combinedGrossCents).toBe(m.revenue.grossPlacedCents + m.bleacher!.estGrossCents);
    expect(renderFillReport(out)).toContain("### Bleacher carve-out (NEW-8 — not confirmed by Cope)");
    expect(out.aggregates[0]!.scalars["bleacher.combinedGrossCents"]).toBeDefined();
  });

  it("refuses a carve-out with nothing to carve", () => {
    const ga = venue([{ ...row({ id: "g", rank: 1, cap: 10, tier: "ga" }), isGa: true }]);
    expect(() => applyShowOverlay(ga, { bleacher: { sharePct: 10, priceCents: 1000 } })).toThrow(/no seated rows/);
  });
});

describe("private offers", () => {
  const model: DemandModel = {
    seed: 4,
    oversubscription: 1.5,
    groupSizeMix: "couples",
    priceModel: { kind: "ladder", ladderCents: 500 },
    autoBid: { sharePct: 20, capMultiplier: [1.2, 1.4] },
    privateOffers: { sharePct: 30, thresholdMultiplier: [1.5, 2.0] },
  };
  const ctx = { tierOrder: ["premium", "mid", "rear"], floorsCents: { premium: 10000, mid: 6000, rear: 4000 }, availableSeats: 30, maxGroupSize: 10 };

  it("draws a private share that never overlaps auto-bid, with thresholds above the visible price on the ladder", () => {
    const { offers, autoBids } = generatePool(model, ctx);
    const kinds = Object.values(autoBids).map((s) => s.kind);
    expect(kinds).toContain("private");
    expect(kinds).toContain("auto");
    for (const [id, spec] of Object.entries(autoBids)) {
      const o = offers.find((x) => x.id === id)!;
      expect(spec.capCents).toBeGreaterThan(o.pricePerTicketCents);
      expect(spec.capCents % 500).toBe(0);
    }
    // Same crowd with and without the private share.
    const withoutPrivate: DemandModel = { ...model };
    delete withoutPrivate.privateOffers;
    const plain = generatePool(withoutPrivate, ctx).offers;
    expect(plain.map((o) => o.id + o.pricePerTicketCents)).toEqual(offers.map((o) => o.id + o.pricePerTicketCents));
  });

  it("round-trips through the pool CSV as a threshold column and converts in a run", () => {
    const pool = loadPoolCsv("id,size,price,tier\nrich,4,120,premium-\npriv,2,100,premium-\n");
    const csv = poolToCsv(pool.offers, { priv: { capCents: 15000, kind: "private" } });
    expect(csv.split("\n")[0]).toBe("id,size,price,tier,order,cap,threshold");
    expect(csv).toContain("priv,2,100.00,premium-,2,,150.00");
    const back = loadPoolCsv(csv);
    expect(back.autoBids).toEqual({ priv: { capCents: 15000, kind: "private" } });
    expect(() => loadPoolCsv("id,size,price,cap,threshold\nx,2,10,20,30\n")).toThrow(/both/);
    expect(() => loadPoolCsv("id,size,price,threshold\nx,2,10,5\n")).toThrow(/below the visible price/);

    const v2 = venue([row({ id: "p", rank: 1, cap: 4, tier: "premium" }), row({ id: "m", rank: 2, cap: 4, tier: "mid" })]);
    const out = runScenario({ scenario: { name: "pv", venue: "test-venue", pool: { file: "p.csv" } }, venue: v2, poolOffers: back.offers, poolAutoBids: back.autoBids });
    const ab = out.runs[0]!.metrics.autoBid;
    expect(ab).toMatchObject({ bidders: 1, privateOffers: 1, privateConverted: 1, raised: 1 });
    expect(ab.privateAddedCents).toBe(ab.totalRaiseCents);
    expect(out.runs[0]!.raises![0]).toMatchObject({ kind: "private", toCents: 12500, heldSection: true });
    expect(renderFillReport(out)).toContain("Private offers are modelled as an auto-bid");
  });
});
