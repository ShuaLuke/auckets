import { describe, expect, it } from "vitest";

import type {
  ChargedTotals,
  OfferStatusCounts,
  ShowSummary,
} from "@/lib/db/repositories";

import { presentAdminHealth, presentAdminShowOps } from "./admin";

const NOW = new Date("2026-06-03T12:00:00Z");

function makeShow(overrides: Partial<ShowSummary> = {}): ShowSummary {
  return {
    id: "show-1",
    artistId: "artist-1",
    venueId: "venue-1",
    venueArchitectureId: "arch-1",
    status: "open",
    doorsAt: new Date("2026-06-20T00:00:00Z"),
    offerWindowOpensAt: new Date("2026-05-20T00:00:00Z"),
    bindingAllocationAt: new Date("2026-06-18T00:00:00Z"),
    pausedAt: null,
    activeRowIds: ["row_a"],
    tierFloorsCents: { premium: 6000 },
    artistName: "Citizen Cope",
    venueName: "Lincoln Theatre",
    venueCity: "Washington, DC",
    ...overrides,
  };
}

describe("presentAdminHealth", () => {
  it("aggregates live offers/fill from pre-result shows and capture from resulted ones", () => {
    const shows = [
      makeShow({ id: "open-1", status: "open", bindingAllocationAt: new Date("2026-06-10T00:00:00Z") }),
      makeShow({ id: "open-2", status: "closed", bindingAllocationAt: new Date("2026-06-05T00:00:00Z") }),
      makeShow({ id: "done-1", status: "allocated" }),
    ];
    const health = presentAdminHealth({
      shows,
      offerStatsByShow: new Map([
        ["open-1", { count: 100, ticketsCount: 140 }],
        ["open-2", { count: 50, ticketsCount: 60 }],
        ["done-1", { count: 0, ticketsCount: 0 }],
      ]),
      statusCountsByShow: new Map<string, OfferStatusCounts>([
        ["done-1", { charged: 200, card_failure: 0, unplaced: 12 }],
      ]),
      filledByShow: new Map([
        ["open-1", 80],
        ["open-2", 40],
        ["done-1", 200],
      ]),
      capacityByShowId: new Map([
        ["open-1", 200],
        ["open-2", 100],
        ["done-1", 200],
      ]),
      now: NOW,
    });

    // Pre-result only (open-1 + open-2): offers 150, tickets 200.
    expect(health.offersLive).toBe(150);
    expect(health.ticketsLive).toBe(200);
    // Fill over pre-result shows: 120 / 300 = 40%.
    expect(health.seatsPlaced).toBe(120);
    expect(health.seatsCapacity).toBe(300);
    expect(health.seatsPct).toBe(40);
    // Capture from resulted show only.
    expect(health.charged).toBe(200);
    expect(health.cardFailures).toBe(0);
    expect(health.captureOk).toBe(true);
    expect(health.captureLabel).toBe("All clear");
    // Soonest future binding among open/closed → open-2 (Jun 5 00:00, ~36h
    // from NOW; shared formatCountdown floors to whole days past 24h).
    expect(health.nextBinding?.venue).toBe("Lincoln Theatre");
    expect(health.nextBinding?.countdown).toBe("1d");
  });

  it("goes loud when a resulted show has a card failure", () => {
    const health = presentAdminHealth({
      shows: [makeShow({ id: "done-1", status: "complete" })],
      offerStatsByShow: new Map(),
      statusCountsByShow: new Map<string, OfferStatusCounts>([
        ["done-1", { charged: 180, card_failure: 2 }],
      ]),
      filledByShow: new Map(),
      capacityByShowId: new Map(),
      now: NOW,
    });
    expect(health.cardFailures).toBe(2);
    expect(health.captureOk).toBe(false);
    expect(health.captureLabel).toBe("2 cards need attention");
    expect(health.nextBinding).toBeNull();
  });
});

describe("presentAdminShowOps", () => {
  it("builds the ops line for an open show with the binding countdown", () => {
    const ops = presentAdminShowOps({
      summary: makeShow({
        status: "open",
        bindingAllocationAt: new Date("2026-06-06T16:00:00Z"),
      }),
      poolCount: 412,
      statusCounts: undefined,
      chargedTotals: undefined,
      now: NOW,
    });
    expect(ops.opsLine).toBe("Offers open · 412 in pool · binding in 3d");
    expect(ops.reconciliation).toBeNull();
  });

  it("reconciles a clean allocated show (green)", () => {
    const counts: OfferStatusCounts = { charged: 200, card_failure: 0, unplaced: 12 };
    const totals: ChargedTotals = { amountCents: 1432000, chargedSeats: 200 };
    const ops = presentAdminShowOps({
      summary: makeShow({ status: "allocated" }),
      poolCount: 0,
      statusCounts: counts,
      chargedTotals: totals,
      now: NOW,
    });
    expect(ops.opsLine).toBe("Allocated · binding complete");
    expect(ops.reconciliation?.reconciled).toBe(true);
    expect(ops.reconciliation?.label).toBe("Seats ↔ charges reconciled");
    expect(ops.reconciliation?.chargedDisplay).toBe("$14,320.00");
    expect(ops.reconciliation?.detail).toBe(
      "200 charged · 200 seats · 0 need a card · 12 not placed",
    );
  });

  it("flags an allocated show with card failures (loud)", () => {
    const ops = presentAdminShowOps({
      summary: makeShow({ status: "allocated" }),
      poolCount: 0,
      statusCounts: { charged: 198, card_failure: 2, unplaced: 0 },
      chargedTotals: { amountCents: 1400000, chargedSeats: 198 },
      now: NOW,
    });
    expect(ops.reconciliation?.reconciled).toBe(false);
    expect(ops.reconciliation?.label).toBe("2 card failures — money unsettled");
  });

  it("has no reconciliation for a pre-binding show", () => {
    const ops = presentAdminShowOps({
      summary: makeShow({ status: "paused" }),
      poolCount: 30,
      statusCounts: undefined,
      chargedTotals: undefined,
      now: NOW,
    });
    expect(ops.opsLine).toBe("Paused · 30 in pool · resume to reopen");
    expect(ops.reconciliation).toBeNull();
  });
});
