/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import type { AllocationConfig } from "@/lib/gae/types";

import { incrementFor, resolveAutoBids } from "./autobid";
import { offer, row, venue } from "./test-helpers";
import { toArchitecture } from "./venue";

const config: AllocationConfig = { mode: "preview", allowOrphans: true, maxGroupSize: 10, orphanPolicy: "leave" };
// Premium row of 4, mid row of 4. Two pairs want premium; only one fits. The
// cheaper one auto-bids with a cap, so it raises until it either wins premium
// or runs out of headroom.
const v = venue([row({ id: "p", rank: 1, cap: 4, tier: "premium" }), row({ id: "m", rank: 2, cap: 4, tier: "mid" })]);
const arch = toArchitecture(v);
const pool = [
  offer("rich", 4, 12000, { type: "this_or_worse", tier: "premium" }),
  offer("auto", 2, 10000, { type: "this_or_worse", tier: "premium" }),
];

describe("resolveAutoBids", () => {
  it("raises a displaced bidder in fixed steps until it holds its section", () => {
    const r = resolveAutoBids(arch, pool, { auto: { capCents: 15000 } }, { kind: "fixed", cents: 500 }, config);
    const auto = r.offers.find((o) => o.id === "auto")!;
    expect(auto.pricePerTicketCents).toBe(12500); // $120 ties on price but rich's bigger group wins; $125 takes it
    expect(auto.rankKey).toBe(12500 * 1000 + 2);
    expect(r.raises).toEqual([{ offerId: "auto", kind: "auto", fromCents: 10000, toCents: 12500, steps: 5, heldSection: true }]);
    expect(r.rounds).toBeGreaterThan(1);
    expect(pool[1]!.pricePerTicketCents).toBe(10000); // input untouched
  });

  it("stops at the cap and reports the bidder as still displaced", () => {
    const r = resolveAutoBids(arch, pool, { auto: { capCents: 11000 } }, { kind: "fixed", cents: 500 }, config);
    expect(r.offers.find((o) => o.id === "auto")!.pricePerTicketCents).toBe(11000);
    expect(r.raises[0]).toMatchObject({ toCents: 11000, steps: 2, heldSection: false });
  });

  it("percentage rule steps by a share of the current price, rounded up to whole dollars", () => {
    expect(incrementFor({ kind: "percent", pct: 5 }, 10000)).toBe(500);
    expect(incrementFor({ kind: "percent", pct: 5 }, 10100)).toBe(600); // 5.05 → $6
    expect(incrementFor({ kind: "percent", pct: 0.1 }, 1000)).toBe(100); // floor of $1
    const r = resolveAutoBids(arch, pool, { auto: { capCents: 15000 } }, { kind: "percent", pct: 10 }, config);
    expect(r.raises[0]).toMatchObject({ toCents: 12100, steps: 2, heldSection: true }); // 100 → 110 (still loses to $120) → 121 (holds)
  });

  it("is a no-op without bidders and for bidders already in their section", () => {
    expect(resolveAutoBids(arch, pool, {}, { kind: "fixed", cents: 500 }, config)).toMatchObject({ raises: [], rounds: 0 });
    const r = resolveAutoBids(arch, pool, { rich: { capCents: 20000 } }, { kind: "fixed", cents: 500 }, config);
    expect(r.raises).toEqual([]);
  });
});
