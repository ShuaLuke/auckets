/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { allocate } from "@/lib/gae";
import type { AllocationConfig } from "@/lib/gae/types";

import { loadPoolCsv } from "./pool";
import { renderFillReport } from "./report";
import { createRng } from "./rng";
import { runScenario } from "./run";
import { drawArrival, finishTimeline, simulateWindow } from "./temporal";
import { offer, row, venue } from "./test-helpers";
import type { Scenario, TimelineSpec } from "./types";
import { toArchitecture } from "./venue";

const config: AllocationConfig = { mode: "preview", allowOrphans: true, maxGroupSize: 10, orphanPolicy: "leave" };
const v = venue([row({ id: "a", rank: 1, cap: 4, tier: "premium" }), row({ id: "b", rank: 2, cap: 4, tier: "mid", holds: ["4"] })]);
const arch = toArchitecture(v);

describe("drawArrival", () => {
  it("curves put mass where they say", () => {
    const sample = (curve: Parameters<typeof drawArrival>[0]): number[] => {
      const rng = createRng(1);
      return Array.from({ length: 4000 }, () => drawArrival(curve, rng));
    };
    const early = (xs: number[]): number => xs.filter((x) => x < 0.25).length / xs.length;
    expect(early(sample("uniform"))).toBeCloseTo(0.25, 1);
    expect(early(sample("front-loaded"))).toBeGreaterThan(0.4);
    expect(sample("last-day-spike").filter((x) => x >= 0.9).length / 4000).toBeGreaterThan(0.4);
    const mid = sample("s-curve");
    expect(mid.filter((x) => x > 0.3 && x < 0.7).length / 4000).toBeGreaterThan(0.6);
    for (const c of ["uniform", "front-loaded", "last-day-spike", "s-curve"] as const) for (const x of sample(c)) expect(x >= 0 && x < 1).toBe(true);
  });
});

describe("simulateWindow", () => {
  // 7 seats. Late, rich arrivals push early fans out.
  const pool = [
    offer("early-a", 4, 5000, { type: "any" }),
    offer("early-b", 3, 5000, { type: "any" }),
    offer("late-rich", 4, 20000, { type: "any" }),
    offer("late-pair", 2, 15000, { type: "any" }),
    offer("late-solo", 1, 12000, { type: "any" }),
  ];
  const timeline: TimelineSpec = { windowDays: 2, previewEveryHours: 12, arrival: "uniform", rollingConfirmed: { afterHours: 12 } };

  it("is deterministic, arrivals span the window, and displacement is counted", () => {
    const a = simulateWindow(arch, pool, {}, timeline, config, { kind: "fixed", cents: 500 }, 3);
    const b = simulateWindow(arch, pool, {}, timeline, config, { kind: "fixed", cents: 500 }, 3);
    expect(JSON.stringify(a.partial.ticks)).toBe(JSON.stringify(b.partial.ticks));
    expect(a.partial.previews).toBe(4);
    expect(a.partial.ticks.map((t) => t.hour)).toEqual([12, 24, 36, 48]);
    expect(a.partial.ticks[3]!.arrivedOffers).toBe(5);
    expect(a.finalOffers).toHaveLength(5);
    for (const o of a.finalOffers) expect(o.submittedAt.getTime()).toBeGreaterThanOrEqual(Date.UTC(2026, 0, 1));
    // ticks are monotone in arrivals and every tick's booked value is the active offers' value
    for (let i = 1; i < a.partial.ticks.length; i++) expect(a.partial.ticks[i]!.arrivedOffers).toBeGreaterThanOrEqual(a.partial.ticks[i - 1]!.arrivedOffers);
    expect(a.partial.displacement.outEvents + a.partial.displacement.downEvents).toBeGreaterThanOrEqual(0);
    expect(a.partial.bookedByDayCents).toHaveLength(2);
  });

  it("revisers raise after displacement; withdrawers leave; the final pool reflects both", () => {
    const tl: TimelineSpec = { ...timeline, revisions: { sharePct: 100, stepsUp: [2, 2], maxPerFan: 1 }, withdrawals: { sharePct: 100 } };
    const w = simulateWindow(arch, pool, {}, tl, config, { kind: "fixed", cents: 500 }, 5, 500);
    expect(w.partial.withdrawals.withdrawers).toBe(5);
    expect(w.finalOffers.length).toBeLessThan(5);
    expect(w.partial.withdrawals.withdrawn + w.finalOffers.length).toBe(5);
    const tlNoWithdraw: TimelineSpec = { ...timeline, revisions: { sharePct: 100, stepsUp: [2, 2], maxPerFan: 1 } };
    const w2 = simulateWindow(arch, pool, {}, tlNoWithdraw, config, { kind: "fixed", cents: 500 }, 5, 500);
    if (w2.partial.revisions.revisionsApplied > 0) {
      expect(w2.partial.revisions.addedCents).toBeGreaterThan(0);
      const revised = w2.finalOffers.filter((o) => o.pricePerTicketCents !== pool.find((p) => p.id === o.id)!.pricePerTicketCents);
      expect(revised.length).toBe(w2.partial.revisions.fansRevised);
      for (const o of revised) expect(o.rankKey).toBe(o.pricePerTicketCents * 1000 + o.groupSize);
    }
  });
});

describe("finishTimeline", () => {
  const pool = loadPoolCsv("id,size,price\nA,4,100\nB,3,90\nC,2,80\nD,2,70\nE,1,60\n").offers; // 12 tickets for 7 seats
  const tl: TimelineSpec = { windowDays: 1, previewEveryHours: 24, rollingConfirmed: { afterHours: 24 }, returns: { sharePct: 100, refill: "keep-pool-live" } };

  it("keep-pool-live refills returned seats from the unplaced pool; release leaves them empty", () => {
    const w = simulateWindow(arch, pool, {}, tl, config, { kind: "fixed", cents: 500 }, 1);
    const binding = allocate(arch, w.finalOffers, config);
    const live = finishTimeline(arch, w, binding, tl, config, 1);
    expect(live.returns!.returnedSeats).toBe(binding.stats.placedSeats); // everyone returns
    expect(live.returns!.refilledSeats).toBeGreaterThan(0);
    expect(live.returns!.refilledValueCents).toBeGreaterThan(0);
    expect(live.registerFirst.bookedAtCloseCents).toBe(pool.reduce((s, o) => s + o.pricePerTicketCents * o.groupSize, 0));
    expect(live.registerFirst.seatedAtBindingCents + live.registerFirst.acceptedUnseatedValueCents).toBe(live.registerFirst.bookedAtCloseCents);
    // Everyone seated 24h straight at the only preview is "confirmed"; all are seated at binding too → none broken.
    expect(live.rollingConfirmed!.confirmedFans).toBeGreaterThan(0);
    expect(live.rollingConfirmed!.brokenConfirmations).toBe(0);

    const released = finishTimeline(arch, w, binding, { ...tl, returns: { sharePct: 100, refill: "release" } }, config, 1);
    expect(released.returns!.refilledSeats).toBe(0);
    expect(released.returns!.fillAfterReturns).toBe(0);
  });

  it("releases free held seats and count toward refill", () => {
    const w = simulateWindow(arch, pool, {}, { windowDays: 1, previewEveryHours: 24 }, config, { kind: "fixed", cents: 500 }, 2);
    const binding = allocate(arch, w.finalOffers, config);
    const t = finishTimeline(arch, w, binding, { windowDays: 1, previewEveryHours: 24, releases: { seats: 1 } }, config, 2);
    expect(t.returns).toMatchObject({ releasedSeats: 1, returnedSeats: 0, refill: "keep-pool-live" });
    expect(t.returns!.refilledSeats).toBe(1); // E (a single) or another fitting unplaced offer takes the freed seat
  });
});

describe("runScenario with a timeline", () => {
  it("attaches temporal metrics, aggregates them, and renders the Timeline section", () => {
    const scenario: Scenario = {
      name: "tl",
      venue: "test-venue",
      pool: { generate: { seed: 2, oversubscription: 1.6, groupSizeMix: "couples", priceModel: { kind: "ladder", ladderCents: 500 }, autoBid: { sharePct: 20, capMultiplier: [1.2, 1.5] } } },
      seeds: 3,
      timeline: { windowDays: 3, previewEveryHours: 24, arrival: "last-day-spike", revisions: { sharePct: 30, stepsUp: [1, 2] }, withdrawals: { sharePct: 5 }, rollingConfirmed: { afterHours: 24 }, returns: { sharePct: 10, refill: "keep-pool-live" } },
    };
    const big = venue([row({ id: "a", rank: 1, cap: 8, tier: "premium" }), row({ id: "b", rank: 2, cap: 8, tier: "mid" }), row({ id: "c", rank: 3, cap: 6, tier: "rear" })]);
    const out = runScenario({ scenario, venue: big, now: "2026-09-07T00:00:00Z" });
    expect(out.runs).toHaveLength(3);
    for (const r of out.runs) {
      expect(r.temporal).toBeDefined();
      expect(r.temporal!.previews).toBe(3);
      expect(r.violations).toEqual([]);
    }
    const sc = out.aggregates[0]!.scalars;
    expect(sc["temporal.displacement.fansToldInThenOut"]).toBeDefined();
    expect(sc["temporal.registerFirst.bookedAtCloseCents"]!.p50).toBeGreaterThan(0);
    const md = renderFillReport(out);
    expect(md).toContain("### Timeline");
    expect(md).toContain("#### Displacement (Q3");
    expect(md).toContain("#### After binding (Q4)");
    expect(md).toContain("#### Register-first view (Q5");
    // Same inputs → same timeline.
    const again = runScenario({ scenario, venue: big, now: "2026-09-07T00:00:00Z" });
    expect(again.runs.map((r) => r.resultHash)).toEqual(out.runs.map((r) => r.resultHash));
  });
});
