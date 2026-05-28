// Integration coverage for runBindingAllocation — the money-moving
// binding run. Exercises the full two-phase orchestrator against a real
// Postgres (placements + status transitions persist) with a hand-rolled
// fake Stripe injected (capture/cancel behavior is scripted per PI).
//
// What the unit tests (build-plan, payment-intents) can't verify, and
// this file does:
//   - Phase 1 actually writes is_binding=true seat_assignments and flips
//     offer.status pool → placed/unplaced and show.status → allocated.
//   - Phase 2 charges placed offers (status → charged, chargedAmountCents
//     set) and flags capture failures (status → card_failure,
//     card_failure_at set) WITHOUT aborting the run.
//   - Unplaced offers' auths are cancelled.
//   - The eligibility gate refuses a show that's already allocated.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { db } from "@/lib/db";
import { runBindingAllocation } from "@/lib/allocation/run-binding";
import { offers, seatAssignments, shows } from "../../drizzle/schema";

import { seedShow, seedUser, seedVenue, seedVenueArchitecture } from "./helpers";

// One orchestra row, capacity 4 — small enough that a second group-of-4
// offer is forced unplaced, giving us a clean placed/unplaced split.
const ROW_CAP_4 = [
  {
    id: "row_a",
    area: "orchestra",
    section: "main",
    rowName: "A",
    rowRank: 1,
    capacity: 4,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: ["1", "2", "3", "4"],
    holds: [],
    tier: "premium",
    isGa: false,
  },
];

async function seedCap4Show() {
  const venue = await seedVenue();
  const arch = await seedVenueArchitecture(venue.id, { rows: ROW_CAP_4 });
  const { show } = await seedShow({
    venueId: venue.id,
    venueArchitectureId: arch.id,
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
      stripePaymentMethodId: "pm_test_stub",
      stripePaymentIntentId: opts.paymentIntentId,
      status: "pool",
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("seedPoolOffer: no row returned");
  return row;
}

type CaptureCall = { id: string; opts: unknown };

function makeFakeStripe(opts: { captureThrowsFor?: Set<string> } = {}) {
  const captureCalls: CaptureCall[] = [];
  const cancelCalls: string[] = [];
  const stripe = {
    paymentIntents: {
      capture: async (id: string, o?: unknown) => {
        captureCalls.push({ id, opts: o });
        if (opts.captureThrowsFor?.has(id)) {
          throw {
            code: "payment_intent_unexpected_state",
            message: "auth no longer capturable",
          };
        }
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

describe("runBindingAllocation (integration)", () => {
  it("captures the placed offer, cancels the unplaced auth, and transitions all statuses", async () => {
    const show = await seedCap4Show();
    // A (higher price) wins the only 4 seats; B is forced out.
    const offerA = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 6000,
      paymentIntentId: "pi_A",
    });
    const offerB = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 3000,
      paymentIntentId: "pi_B",
    });

    const { stripe, captureCalls, cancelCalls } = makeFakeStripe();
    const outcome = await runBindingAllocation(db, stripe, show.id);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.captured).toBe(1);
    expect(outcome.value.cardFailures).toBe(0);
    expect(outcome.value.cancelled).toBe(1);
    expect(outcome.value.assignmentsWritten).toBe(1);

    // Placed offer A: charged, with a binding seat assignment carrying the
    // captured amount (4 × $60).
    const [rowA] = await db
      .select()
      .from(offers)
      .where(eq(offers.id, offerA.id));
    expect(rowA?.status).toBe("charged");
    const [assignA] = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offerA.id));
    expect(assignA?.isBinding).toBe(true);
    expect(assignA?.stripePaymentIntentId).toBe("pi_A");
    expect(assignA?.chargedAmountCents).toBe(24000);
    expect(assignA?.cardFailureAt).toBeNull();

    // Unplaced offer B: status unplaced, no seat assignment, auth cancelled.
    const [rowB] = await db
      .select()
      .from(offers)
      .where(eq(offers.id, offerB.id));
    expect(rowB?.status).toBe("unplaced");
    const assignB = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offerB.id));
    expect(assignB).toHaveLength(0);

    // Show is allocated.
    const [showRow] = await db
      .select()
      .from(shows)
      .where(eq(shows.id, show.id));
    expect(showRow?.status).toBe("allocated");

    // Stripe was driven correctly: capture(pi_A, full amount), cancel(pi_B).
    expect(captureCalls).toEqual([
      { id: "pi_A", opts: { amount_to_capture: 24000 } },
    ]);
    expect(cancelCalls).toEqual(["pi_B"]);

    // Eligibility gate: re-running on the now-allocated show is refused
    // (prevents a double-charge).
    const second = await runBindingAllocation(db, stripe, show.id);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe("show_not_eligible");
  });

  it("flags a placed offer as card_failure when the capture fails, without aborting the run", async () => {
    const show = await seedCap4Show();
    const offerA = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 6000,
      paymentIntentId: "pi_dead",
    });

    const { stripe } = makeFakeStripe({
      captureThrowsFor: new Set(["pi_dead"]),
    });
    const outcome = await runBindingAllocation(db, stripe, show.id);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.captured).toBe(0);
    expect(outcome.value.cardFailures).toBe(1);

    const [rowA] = await db
      .select()
      .from(offers)
      .where(eq(offers.id, offerA.id));
    expect(rowA?.status).toBe("card_failure");

    const [assignA] = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offerA.id));
    // Seat assignment still exists (the offer WAS placed) but records the
    // failure rather than a charge — input for the recovery flow.
    expect(assignA?.isBinding).toBe(true);
    expect(assignA?.chargedAmountCents).toBeNull();
    expect(assignA?.cardFailureAt).toBeInstanceOf(Date);

    // The run still completes — the show is allocated despite the failure.
    const [showRow] = await db
      .select()
      .from(shows)
      .where(eq(shows.id, show.id));
    expect(showRow?.status).toBe("allocated");
  });
});
