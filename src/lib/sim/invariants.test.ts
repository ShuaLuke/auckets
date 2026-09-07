/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { allocate } from "@/lib/gae";
import type { AllocationConfig, AllocationResult } from "@/lib/gae/types";

import { checkInvariants } from "./invariants";
import { offer, row, venue } from "./test-helpers";

const config: AllocationConfig = { mode: "preview", allowOrphans: true, maxGroupSize: 10, orphanPolicy: "leave" };
const v = venue([row({ id: "r1", rank: 1, cap: 4, tier: "premium", holds: ["4"] }), row({ id: "r2", rank: 2, cap: 4, tier: "mid" })]);
const offers = [offer("A", 3, 10000, { type: "specific", tier: "premium" }), offer("B", 2, 9000, { type: "this_or_worse", tier: "mid" }), offer("C", 2, 8000)];

function clean(): AllocationResult {
  return allocate({ venueId: "x", rows: v.rows, activeRowIds: v.activeRowIds }, offers, config);
}

describe("checkInvariants", () => {
  it("passes on a real engine result", () => {
    expect(checkInvariants(v, offers, clean())).toEqual([]);
  });

  it("catches a duplicated seat and an offer that is both placed and unplaced", () => {
    const r = clean();
    r.assignments.push({ ...r.assignments[0]! });
    r.unplaced.push({ offerId: "A", reason: "no_fit_anywhere" });
    const kinds = checkInvariants(v, offers, r).map((x) => x.invariant);
    expect(kinds).toContain("double-booking");
  });

  it("catches a group seated on a held seat, split across rows, or short a seat", () => {
    const r = clean();
    const a = r.assignments.find((x) => x.offerId === "A" && x.positionIndex === 1)!;
    a.positionIndex = 3;
    a.seatNumber = "4"; // the held seat
    const msgs = checkInvariants(v, offers, r).map((x) => x.message).join("\n");
    expect(msgs).toMatch(/held seat r1:4/);
    expect(msgs).toMatch(/not adjacent/);

    const r2 = clean();
    r2.assignments.find((x) => x.offerId === "A")!.venueRowId = "r2";
    expect(checkInvariants(v, offers, r2).some((x) => /spans 2 rows/.test(x.message))).toBe(true);

    const r3 = clean();
    r3.assignments = r3.assignments.filter((x) => !(x.offerId === "A" && x.positionIndex === 0));
    r3.stats.placedSeats -= 1;
    expect(checkInvariants(v, offers, r3).some((x) => /got 2 seats/.test(x.message))).toBe(true);
  });

  it("catches a broken total-accounting stat and a free upgrade", () => {
    const r = clean();
    r.stats.orphanSeats += 1;
    expect(checkInvariants(v, offers, r).some((x) => x.invariant === "accounting")).toBe(true);

    const r2 = clean();
    // Move B (this_or_worse: mid) into the premium row's free seat — an upgrade it never asked for.
    for (const a of r2.assignments) if (a.offerId === "B") a.venueRowId = "r1";
    expect(checkInvariants(v, offers, r2).some((x) => x.invariant === "no-free-upgrade")).toBe(true);
  });
});
