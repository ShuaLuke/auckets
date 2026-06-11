// Integration coverage for per-show holds reaching the allocation engine
// — the launch-critical comp-seat bug. Before the fix, holds written to
// the `holds` table (POST /api/holds → createHold) were read only by the
// artist dashboard UI: preview and binding runs built the GAE venue from
// the architecture JSONB alone, so the engine happily sold — and at
// binding CAPTURED MONEY for — the exact seats the artist had comped.
//
// These tests exercise the full orchestrator paths against real Postgres:
// the artist files a hold via the repo (same write the route performs),
// then a preview / binding run executes, and we assert no seat_assignment
// lands on the held seats and (at binding) no fan is charged into them.
//
// Patterns follow binding-allocation.integration.test.ts (which seeds
// architectures with holds: [] only — exactly why this bug had no net).

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { db } from "@/lib/db";
import { runBindingAllocation } from "@/lib/allocation/run-binding";
import { runPreviewAllocation } from "@/lib/allocation/run-preview";
import { createHold } from "@/lib/db/repositories";
import { holds, offers, seatAssignments } from "../../drizzle/schema";

import { seedShow, seedUser, seedVenue, seedVenueArchitecture } from "./helpers";

// One orchestra row of 8 with a BUILDING-level manifest hold on seat 1
// (the kind the GAE already respected). The per-show comp holds are
// layered on via the `holds` table inside each test.
const ROW_CAP_8_BUILDING_HOLD = [
  {
    id: "row_a",
    area: "orchestra",
    section: "main",
    rowName: "A",
    rowRank: 1,
    capacity: 8,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: ["1", "2", "3", "4", "5", "6", "7", "8"],
    holds: ["1"],
    tier: "premium",
    isGa: false,
  },
];

async function seedHeldShow(status: "open" | "closed" = "open") {
  const venue = await seedVenue();
  const arch = await seedVenueArchitecture(venue.id, {
    rows: ROW_CAP_8_BUILDING_HOLD,
  });
  const { show } = await seedShow({
    venueId: venue.id,
    venueArchitectureId: arch.id,
    status,
  });
  // The artist comps seats 4+5 — same write POST /api/holds performs.
  await createHold(db, {
    showId: show.id,
    source: "Artist comp",
    kind: "artist",
    venueRowId: "row_a",
    seatNumbers: ["4", "5"],
    notes: "family",
  });
  return show;
}

async function seedPoolOffer(
  showId: string,
  opts: { groupSize: number; priceCents: number; paymentIntentId: string },
) {
  const user = await seedUser();
  const rows = await db
    .insert(offers)
    .values({
      showId,
      userId: user.id,
      groupSize: opts.groupSize,
      pricePerTicketCents: opts.priceCents,
      tierPreference: "any",
      preferredTier: null,
      stripePaymentMethodId: "pm_test_stub",
      stripePaymentIntentId: opts.paymentIntentId,
      status: "pool",
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("seedPoolOffer: no row returned");
  return row;
}

function makeFakeStripe() {
  const captureCalls: { id: string; opts: unknown }[] = [];
  const cancelCalls: string[] = [];
  const stripe = {
    paymentIntents: {
      capture: async (id: string, o?: unknown) => {
        captureCalls.push({ id, opts: o });
        return { id, status: "succeeded" };
      },
      cancel: async (id: string) => {
        cancelCalls.push(id);
        return { id, status: "canceled" };
      },
    },
  } as unknown as Stripe;
  return { stripe, captureCalls, cancelCalls };
}

async function assignedSeatsForShow(showId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(seatAssignments)
    .where(eq(seatAssignments.showId, showId));
  return rows.flatMap((r) => r.seatNumbers.map((s) => `${r.venueRowId}:${s}`));
}

describe("per-show holds reach the allocation engine (integration)", () => {
  it("preview: an artist-filed hold keeps its seats out of every seat_assignment", async () => {
    const show = await seedHeldShow("open");
    // Eight singles would fill all 8 seats absent holds. With building
    // hold {1} + comp {4,5}, only 2,3,6,7,8 are sellable.
    for (let i = 0; i < 8; i++) {
      await seedPoolOffer(show.id, {
        groupSize: 1,
        priceCents: 9000 - i * 100,
        paymentIntentId: `pi_s${i}`,
      });
    }

    const outcome = await runPreviewAllocation(db, show.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.stats.placedSeats).toBe(5);

    const seats = await assignedSeatsForShow(show.id);
    expect(seats).toHaveLength(5);
    expect(seats).not.toContain("row_a:1"); // building hold
    expect(seats).not.toContain("row_a:4"); // artist comp
    expect(seats).not.toContain("row_a:5"); // artist comp
    expect(seats.sort()).toEqual([
      "row_a:2",
      "row_a:3",
      "row_a:6",
      "row_a:7",
      "row_a:8",
    ]);
  });

  it("binding: no fan is seated or charged into comped seats; a group that no longer fits is released, not crammed in", async () => {
    const show = await seedHeldShow("open");
    // The comp on 4+5 splits the row into runs {2,3} and {6,7,8}. The
    // group of 4 — which pre-fix would have been seated straight across
    // the comped seats and charged — can no longer fit anywhere. The
    // pair and the single still place in the remaining runs.
    const groupOf4 = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 9000,
      paymentIntentId: "pi_group4",
    });
    const pairOffer = await seedPoolOffer(show.id, {
      groupSize: 2,
      priceCents: 6000,
      paymentIntentId: "pi_pair",
    });
    const singleOffer = await seedPoolOffer(show.id, {
      groupSize: 1,
      priceCents: 5000,
      paymentIntentId: "pi_single",
    });

    const { stripe, captureCalls, cancelCalls } = makeFakeStripe();
    const outcome = await runBindingAllocation(db, stripe, show.id);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.captured).toBe(2);
    expect(outcome.value.cancelled).toBe(1);

    // No assignment touches a held seat.
    const seats = await assignedSeatsForShow(show.id);
    expect(seats).not.toContain("row_a:1");
    expect(seats).not.toContain("row_a:4");
    expect(seats).not.toContain("row_a:5");

    // The group of 4 was NOT charged — its auth was released.
    const [g4] = await db
      .select()
      .from(offers)
      .where(eq(offers.id, groupOf4.id));
    expect(g4?.status).toBe("unplaced");
    expect(cancelCalls).toEqual(["pi_group4"]);
    expect(captureCalls.map((c) => c.id).sort()).toEqual([
      "pi_pair",
      "pi_single",
    ]);

    // The placed offers landed strictly in the unheld runs.
    const [pairRow] = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, pairOffer.id));
    expect(pairRow?.seatNumbers.every((s) => !["1", "4", "5"].includes(s))).toBe(
      true,
    );
    const [singleRow] = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, singleOffer.id));
    expect(
      singleRow?.seatNumbers.every((s) => !["1", "4", "5"].includes(s)),
    ).toBe(true);
  });

  it("preview after a hold is deleted returns the seats to the pool (holds are re-read every run)", async () => {
    const show = await seedHeldShow("open");
    for (let i = 0; i < 8; i++) {
      await seedPoolOffer(show.id, {
        groupSize: 1,
        priceCents: 9000 - i * 100,
        paymentIntentId: `pi_d${i}`,
      });
    }

    const first = await runPreviewAllocation(db, show.id);
    expect(first.ok && first.value.stats.placedSeats).toBe(5);

    // The artist releases the comp (DELETE /api/holds/[id] path).
    await db.delete(holds).where(eq(holds.showId, show.id));

    const second = await runPreviewAllocation(db, show.id);
    expect(second.ok && second.value.stats.placedSeats).toBe(7);

    const seats = await assignedSeatsForShow(show.id);
    expect(seats).toContain("row_a:4");
    expect(seats).toContain("row_a:5");
    expect(seats).not.toContain("row_a:1"); // building hold still respected
  });
});
