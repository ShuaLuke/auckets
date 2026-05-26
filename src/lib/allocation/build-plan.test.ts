import { describe, expect, it } from "vitest";

import type {
  VenueArchitecture as DbVenueArchitecture,
} from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import type { offers, shows } from "../../../drizzle/schema";

import { buildPreviewAllocationPlan } from "./build-plan";

type Offer = typeof offers.$inferSelect;
type Show = typeof shows.$inferSelect;

function makeRow(overrides: Partial<VenueRow> = {}): VenueRow {
  return {
    id: "row_a",
    area: "orchestra",
    section: "main",
    rowName: "A",
    rowRank: 1,
    capacity: 8,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: ["1", "2", "3", "4", "5", "6", "7", "8"],
    holds: [],
    tier: "premium",
    ...overrides,
  };
}

function makeArch(rows: VenueRow[]): DbVenueArchitecture {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    venueId: "22222222-2222-2222-2222-222222222222",
    version: 1,
    rows,
    createdAt: new Date("2026-05-01T00:00:00Z"),
  };
}

function makeShow(overrides: Partial<Show> = {}): Show {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    artistId: "11111111-1111-1111-1111-111111111111",
    venueId: "22222222-2222-2222-2222-222222222222",
    venueArchitectureId: "33333333-3333-3333-3333-333333333333",
    doorsAt: new Date("2026-06-25T00:00:00Z"),
    offerWindowOpensAt: new Date("2026-05-25T00:00:00Z"),
    bindingAllocationAt: new Date("2026-06-24T00:00:00Z"),
    pausedAt: null,
    status: "open",
    tierFloorsCents: { premium: 5000, mid: 3500 },
    maxGroupSize: 10,
    activeRowIds: ["row_a", "row_b"],
    bleacherEnabled: false,
    bleacherCapacity: 0,
    bleacherPriceCents: null,
    showHolds: [],
    emailCustomization: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  };
}

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: "offer_1",
    showId: "44444444-4444-4444-4444-444444444444",
    userId: "user_2abc",
    channel: "market",
    groupSize: 4,
    pricePerTicketCents: 6000,
    tierPreference: "any",
    preferredTier: null,
    rankKey: BigInt(6000 * 1000 + 4),
    autoBidEnabled: false,
    autoBidCapCents: null,
    autoBidIncrementCents: 500,
    privateThresholdCents: null,
    stripePaymentMethodId: "pm_test",
    stripeSetupIntentId: "seti_test",
    status: "pool",
    submittedAt: new Date("2026-05-26T12:00:00Z"),
    revisedAt: null,
    ...overrides,
  };
}

describe("buildPreviewAllocationPlan", () => {
  it("returns empty plan when the pool is empty", () => {
    const plan = buildPreviewAllocationPlan(
      makeShow({ activeRowIds: ["row_a"] }),
      makeArch([makeRow()]),
      [],
    );
    expect(plan.assignmentRows).toEqual([]);
    expect(plan.result.assignments).toEqual([]);
    expect(plan.result.stats.totalOffers).toBe(0);
  });

  it("groups the GAE's per-seat assignments into one DB row per offer", () => {
    // One offer for 4 seats → one assignment row with seat_numbers
    // of length 4 (not 4 rows of length 1).
    const plan = buildPreviewAllocationPlan(
      makeShow({ activeRowIds: ["row_a"] }),
      makeArch([makeRow({ id: "row_a", capacity: 8 })]),
      [makeOffer({ id: "offer_1", groupSize: 4 })],
    );
    expect(plan.assignmentRows).toHaveLength(1);
    const [row] = plan.assignmentRows;
    expect(row?.offerId).toBe("offer_1");
    expect(row?.seatNumbers).toHaveLength(4);
  });

  it("captures the row's tier on the assignment row (placement-time snapshot)", () => {
    const plan = buildPreviewAllocationPlan(
      makeShow({ activeRowIds: ["row_a"] }),
      makeArch([makeRow({ id: "row_a", tier: "premium" })]),
      [makeOffer({ groupSize: 4 })],
    );
    expect(plan.assignmentRows[0]?.tier).toBe("premium");
  });

  it("captures 'ga' for GA rows (no tier field, isGa true)", () => {
    // GA rows have no tier in the architecture (they're a special
    // category). seat_assignments.tier is NOT NULL in the schema —
    // we fall back to "ga" to keep it satisfiable without changing
    // the constraint.
    // Build the GA row without a `tier` field (exactOptionalProperty-
    // Types is on, so we can't pass `tier: undefined`).
    const gaRow: VenueRow = {
      id: "row_ga",
      area: "ga",
      section: "ga",
      rowName: "GA",
      rowRank: 5,
      capacity: 22,
      parity: "EVEN",
      lean: "CENTER",
      seatNumbers: Array.from({ length: 22 }, (_, i) => String(i + 1)),
      holds: [],
      isGa: true,
    };
    const plan = buildPreviewAllocationPlan(
      makeShow({ activeRowIds: ["row_ga"] }),
      makeArch([gaRow]),
      [makeOffer({ tierPreference: "any" })],
    );
    expect(plan.assignmentRows[0]?.tier).toBe("ga");
  });

  it("flags every produced assignment row as is_binding=false (preview mode)", () => {
    const plan = buildPreviewAllocationPlan(
      makeShow({ activeRowIds: ["row_a"] }),
      makeArch([makeRow()]),
      [makeOffer({ groupSize: 4 })],
    );
    for (const row of plan.assignmentRows) {
      expect(row.isBinding).toBe(false);
    }
  });

  it("emits one log row per GAE decision, with mode='preview'", () => {
    const plan = buildPreviewAllocationPlan(
      makeShow({ activeRowIds: ["row_a"] }),
      makeArch([makeRow({ capacity: 8 })]),
      [makeOffer({ groupSize: 4 })],
    );
    expect(plan.logRows.length).toBe(plan.result.decisions.length);
    expect(plan.logRows.every((r) => r.mode === "preview")).toBe(true);
    expect(plan.logRows.every((r) => r.showId === "44444444-4444-4444-4444-444444444444")).toBe(
      true,
    );
  });

  it("carries the GAE decision's snapshot through unchanged for audit", () => {
    // Per CLAUDE.md prime directive #8: allocation decisions log full
    // snapshot state. The build-plan layer must NOT redact or
    // transform; the audit row is whatever the GAE emitted.
    const plan = buildPreviewAllocationPlan(
      makeShow({ activeRowIds: ["row_a"] }),
      makeArch([makeRow({ capacity: 8 })]),
      [makeOffer({ groupSize: 4 })],
    );
    expect(plan.logRows.length).toBeGreaterThan(0);
    expect(plan.logRows[0]?.snapshot).toBe(plan.result.decisions[0]?.snapshot);
  });

  // The build-plan layer passes show.maxGroupSize through to the
  // GAE's AllocationConfig, but the GAE currently ignores that field
  // (see src/lib/gae/index.ts — config is reserved for future
  // behavior). A test that exercises the cap belongs alongside the
  // GAE itself once it actually enforces the config. For now the
  // submission-time check (Zod + schema CHECK constraint
  // BETWEEN 1 AND 10) is the only place the cap binds.

  it("respects the show's activeRowIds (only places into the partial-venue subset)", () => {
    // 2-row architecture, show only activates row_a. Even though
    // row_b has capacity, the GAE shouldn't place into it.
    const plan = buildPreviewAllocationPlan(
      makeShow({ activeRowIds: ["row_a"] }),
      makeArch([
        makeRow({ id: "row_a", capacity: 4 }),
        makeRow({ id: "row_b", capacity: 100 }),
      ]),
      // An offer that doesn't fit in row_a (4 seats taken) should be
      // unplaced rather than overflowing into row_b.
      [
        makeOffer({ id: "offer_1", groupSize: 4 }),
        makeOffer({ id: "offer_2", groupSize: 4, submittedAt: new Date("2026-05-26T13:00:00Z") }),
      ],
    );
    for (const row of plan.assignmentRows) {
      expect(row.venueRowId).toBe("row_a");
    }
  });
});
