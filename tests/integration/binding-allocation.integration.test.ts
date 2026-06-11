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
//   - The two-step CAS gate (claim open→closed, then closed→allocating
//     inside Phase 1): a paused show is never bound (ADR-0013), a show
//     mid-run ('allocating') bounces, an ops-closed / crash-recovered
//     'closed' show still binds, and two concurrent runs on the same show
//     produce exactly one winner and exactly one capture per offer.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { db } from "@/lib/db";
import { runBindingAllocation } from "@/lib/allocation/run-binding";
import {
  offerRevisions,
  offers,
  seatAssignments,
  shows,
} from "../../drizzle/schema";

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
  opts: {
    groupSize: number;
    priceCents: number;
    paymentIntentId: string;
    tierPreference?: "specific" | "this_or_better" | "this_or_worse" | "any";
    preferredTier?: string;
    autoBidEnabled?: boolean;
    autoBidCapCents?: number;
  },
) {
  const user = await seedUser();
  const rows = await db
    .insert(offers)
    .values({
      showId,
      userId: user.id,
      groupSize: opts.groupSize,
      pricePerTicketCents: opts.priceCents,
      tierPreference: opts.tierPreference ?? "any",
      preferredTier: opts.preferredTier ?? null,
      autoBidEnabled: opts.autoBidEnabled ?? false,
      autoBidCapCents: opts.autoBidCapCents ?? null,
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

  it("auto-raises a defended offer at binding, captures the raised amount, and persists the raise (ADR-0018)", async () => {
    const show = await seedCap4Show();
    // A ($62, no auto-bid) outranks B's submitted $50, so without auto-bid B
    // is unplaced. B auto-bids up to $80 to defend premium and climbs in $5
    // steps until it outranks A ($65), displacing A.
    const offerA = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 6200,
      paymentIntentId: "pi_A",
    });
    const offerB = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 5000,
      paymentIntentId: "pi_B",
      tierPreference: "specific",
      preferredTier: "premium",
      autoBidEnabled: true,
      autoBidCapCents: 8000,
    });

    const { stripe, captureCalls, cancelCalls } = makeFakeStripe();
    const outcome = await runBindingAllocation(db, stripe, show.id);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.captured).toBe(1);
    expect(outcome.value.cancelled).toBe(1);
    expect(outcome.value.autoRaised).toBe(1);

    // B won the row at the RAISED price: charged 4 × $65 = $260, and the
    // offer-of-record's price was bumped to match (+ revisedAt stamped).
    const [rowB] = await db.select().from(offers).where(eq(offers.id, offerB.id));
    expect(rowB?.status).toBe("charged");
    expect(rowB?.pricePerTicketCents).toBe(6500);
    expect(rowB?.revisedAt).toBeInstanceOf(Date);
    const [assignB] = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offerB.id));
    expect(assignB?.chargedAmountCents).toBe(26000);

    // The capture used the raised amount — within the cap the auth covers.
    expect(captureCalls).toEqual([
      { id: "pi_B", opts: { amount_to_capture: 26000 } },
    ]);

    // A was displaced and its auth released.
    const [rowA] = await db.select().from(offers).where(eq(offers.id, offerA.id));
    expect(rowA?.status).toBe("unplaced");
    expect(cancelCalls).toEqual(["pi_A"]);

    // The raise is captured as an append-only offer_revisions row, marked as
    // an auto-bid raise so the activity feed can distinguish it from a
    // fan-initiated revision.
    const revisions = await db
      .select()
      .from(offerRevisions)
      .where(eq(offerRevisions.offerId, offerB.id));
    expect(revisions).toHaveLength(1);
    const snapshot = revisions[0]?.snapshot as Record<string, unknown>;
    expect(snapshot.pricePerTicketCents).toBe(6500);
    expect(snapshot.status).toBe("placed");
    expect(snapshot.autoBidRaise).toMatchObject({ fromCents: 5000, toCents: 6500 });
  });

  it("refuses a paused show without touching the pool or Stripe (ADR-0013)", async () => {
    // Ops halted the show; the binding gate must never stomp that halt —
    // pause is a CAS from 'open' only, and the binding claim is a CAS from
    // 'open'/'closed' only, so the two can't interleave into money moving
    // on a halted show.
    const venue = await seedVenue();
    const arch = await seedVenueArchitecture(venue.id, { rows: ROW_CAP_4 });
    const { show } = await seedShow({
      venueId: venue.id,
      venueArchitectureId: arch.id,
      status: "paused",
    });
    const offer = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 6000,
      paymentIntentId: "pi_paused",
    });

    const { stripe, captureCalls, cancelCalls } = makeFakeStripe();
    const outcome = await runBindingAllocation(db, stripe, show.id);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({
      kind: "show_not_eligible",
      status: "paused",
    });

    // Nothing moved: show still paused, offer still in the pool, no money.
    const [showRow] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(showRow?.status).toBe("paused");
    const [offerRow] = await db
      .select()
      .from(offers)
      .where(eq(offers.id, offer.id));
    expect(offerRow?.status).toBe("pool");
    expect(captureCalls).toHaveLength(0);
    expect(cancelCalls).toHaveLength(0);
  });

  it("refuses a show whose binding run is already in flight ('allocating')", async () => {
    // 'allocating' means another run's Phase 1 committed and Phase 2 may be
    // mid-capture — a re-trigger must bounce rather than risk double-charging.
    const venue = await seedVenue();
    const arch = await seedVenueArchitecture(venue.id, { rows: ROW_CAP_4 });
    const { show } = await seedShow({
      venueId: venue.id,
      venueArchitectureId: arch.id,
      status: "allocating",
    });

    const { stripe, captureCalls } = makeFakeStripe();
    const outcome = await runBindingAllocation(db, stripe, show.id);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({
      kind: "show_not_eligible",
      status: "allocating",
    });
    expect(captureCalls).toHaveLength(0);
  });

  it("binds a 'closed' show — the end-early and crash-recovery path", async () => {
    // 'closed' is reached by ops' end-early AND by a prior binding attempt
    // that crashed after the open→closed claim but before Phase 1 committed.
    // Both must stay bindable so the next sweep tick completes the run.
    const venue = await seedVenue();
    const arch = await seedVenueArchitecture(venue.id, { rows: ROW_CAP_4 });
    const { show } = await seedShow({
      venueId: venue.id,
      venueArchitectureId: arch.id,
      status: "closed",
    });
    const offer = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 6000,
      paymentIntentId: "pi_closed",
    });

    const { stripe, captureCalls } = makeFakeStripe();
    const outcome = await runBindingAllocation(db, stripe, show.id);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.captured).toBe(1);

    const [offerRow] = await db
      .select()
      .from(offers)
      .where(eq(offers.id, offer.id));
    expect(offerRow?.status).toBe("charged");
    const [showRow] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(showRow?.status).toBe("allocated");
    expect(captureCalls).toEqual([
      { id: "pi_closed", opts: { amount_to_capture: 24000 } },
    ]);
  });

  it("two concurrent runs on the same show: exactly one wins, each auth captured once", async () => {
    // The double-trigger race this slice exists for: the admin Run-binding
    // button and the 5-minute sweep firing together. Whatever the
    // interleaving, the closed→allocating CAS inside Phase 1 admits exactly
    // one run; the loser aborts its transaction with zero writes and reports
    // show_not_eligible. The invariant that matters for money: one capture
    // per PaymentIntent, ever.
    const show = await seedCap4Show();
    await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 6000,
      paymentIntentId: "pi_race",
    });

    const { stripe, captureCalls, cancelCalls } = makeFakeStripe();
    const [first, second] = await Promise.all([
      runBindingAllocation(db, stripe, show.id),
      runBindingAllocation(db, stripe, show.id),
    ]);

    const outcomes = [first, second];
    const winners = outcomes.filter((o) => o.ok);
    const losers = outcomes.filter((o) => !o.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const loser = losers[0];
    if (!loser || loser.ok) return;
    expect(loser.error.kind).toBe("show_not_eligible");

    // The fan was charged exactly once, and nothing cancelled their auth.
    expect(captureCalls).toEqual([
      { id: "pi_race", opts: { amount_to_capture: 24000 } },
    ]);
    expect(cancelCalls).toHaveLength(0);

    const [showRow] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(showRow?.status).toBe("allocated");
  });
});
