// Integration coverage for processStripeEvent (the Stripe webhook core,
// prime directive #6) against a real Postgres. Signature verification lives
// in the route + a unit test; here we drive the parsed-event dispatch with
// synthetic Stripe.Event objects and assert the offer / seat_assignment
// state transitions + the stripe_webhook_events receipt + idempotency.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { db } from "@/lib/db";
import { processStripeEvent } from "@/lib/stripe/webhook";
import {
  offers,
  seatAssignments,
  stripeWebhookEvents,
} from "../../drizzle/schema";

import { seedShow, seedUser, seedVenue, seedVenueArchitecture } from "./helpers";

const ROW = [
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

async function seedShowRow() {
  const venue = await seedVenue();
  const arch = await seedVenueArchitecture(venue.id, { rows: ROW });
  const { show } = await seedShow({
    venueId: venue.id,
    venueArchitectureId: arch.id,
  });
  return show;
}

// A placed offer with a binding seat assignment carrying the auth — the state
// the webhook acts on (a capture failed / succeeded after binding ran).
async function seedPlacedOffer(
  showId: string,
  opts: { piId: string; priceCents: number; groupSize: number },
) {
  const user = await seedUser();
  const [offer] = await db
    .insert(offers)
    .values({
      showId,
      userId: user.id,
      groupSize: opts.groupSize,
      pricePerTicketCents: opts.priceCents,
      tierPreference: "any",
      stripePaymentMethodId: "pm_test_stub",
      stripePaymentIntentId: opts.piId,
      status: "placed",
    })
    .returning();
  if (!offer) throw new Error("seedPlacedOffer: no offer");
  await db.insert(seatAssignments).values({
    offerId: offer.id,
    showId,
    venueRowId: "row_a",
    seatNumbers: ["1", "2", "3", "4"].slice(0, opts.groupSize),
    tier: "premium",
    isBinding: true,
    stripePaymentIntentId: opts.piId,
  });
  return offer;
}

function piEvent(
  id: string,
  type: string,
  pi: { id: string; amount_received?: number },
): Stripe.Event {
  return {
    id,
    type,
    data: { object: pi },
  } as unknown as Stripe.Event;
}

describe("processStripeEvent (integration)", () => {
  it("payment_intent.payment_failed flips the offer to card_failure", async () => {
    const show = await seedShowRow();
    const offer = await seedPlacedOffer(show.id, {
      piId: "pi_fail",
      priceCents: 6000,
      groupSize: 4,
    });

    const result = await processStripeEvent(
      db,
      piEvent("evt_fail_1", "payment_intent.payment_failed", { id: "pi_fail" }),
    );
    expect(result).toEqual({ processed: true, action: "card_failure" });

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("card_failure");
    const [assign] = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offer.id));
    expect(assign?.cardFailureAt).toBeInstanceOf(Date);
  });

  it("payment_intent.succeeded marks the offer charged with the captured amount", async () => {
    const show = await seedShowRow();
    const offer = await seedPlacedOffer(show.id, {
      piId: "pi_ok",
      priceCents: 6000,
      groupSize: 4,
    });

    const result = await processStripeEvent(
      db,
      piEvent("evt_ok_1", "payment_intent.succeeded", {
        id: "pi_ok",
        amount_received: 24000,
      }),
    );
    expect(result).toEqual({ processed: true, action: "charged" });

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("charged");
    const [assign] = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offer.id));
    expect(assign?.chargedAmountCents).toBe(24000);
  });

  it("is idempotent — a redelivered event id is a no-op", async () => {
    const show = await seedShowRow();
    const offer = await seedPlacedOffer(show.id, {
      piId: "pi_dup",
      priceCents: 5000,
      groupSize: 2,
    });

    const first = await processStripeEvent(
      db,
      piEvent("evt_dup", "payment_intent.payment_failed", { id: "pi_dup" }),
    );
    expect(first.action).toBe("card_failure");

    // Manually flip the offer back to 'placed' to prove the second delivery
    // does NOT re-run the handler (if it did, this would become card_failure
    // again).
    await db
      .update(offers)
      .set({ status: "placed" })
      .where(eq(offers.id, offer.id));

    const second = await processStripeEvent(
      db,
      piEvent("evt_dup", "payment_intent.payment_failed", { id: "pi_dup" }),
    );
    expect(second).toEqual({ processed: false, action: "duplicate" });

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("placed"); // untouched by the redelivery
  });

  it("short-circuits a concurrent duplicate delivery (in-flight 'received' receipt)", async () => {
    // Two simultaneous deliveries of the same event: the first claims the
    // receipt row ('received') and is still mid-handlers when the second
    // arrives. The second must NOT run handlers too (it would double-act —
    // e.g. send the card-failure email twice).
    const show = await seedShowRow();
    const offer = await seedPlacedOffer(show.id, {
      piId: "pi_inflight",
      priceCents: 5000,
      groupSize: 2,
    });

    // The first delivery's fresh claim, frozen mid-flight.
    await db.insert(stripeWebhookEvents).values({
      eventId: "evt_inflight",
      type: "payment_intent.payment_failed",
      paymentIntentId: "pi_inflight",
      status: "received",
    });

    const second = await processStripeEvent(
      db,
      piEvent("evt_inflight", "payment_intent.payment_failed", {
        id: "pi_inflight",
      }),
    );
    expect(second).toEqual({ processed: false, action: "duplicate" });

    // The handler did not run: the offer is untouched.
    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("placed");
  });

  it("reprocesses a receipt left in 'error' (Stripe's retry of a failed attempt)", async () => {
    const show = await seedShowRow();
    const offer = await seedPlacedOffer(show.id, {
      piId: "pi_retry_err",
      priceCents: 5000,
      groupSize: 2,
    });
    await db.insert(stripeWebhookEvents).values({
      eventId: "evt_retry_err",
      type: "payment_intent.payment_failed",
      paymentIntentId: "pi_retry_err",
      status: "error",
      note: "boom",
    });

    const retry = await processStripeEvent(
      db,
      piEvent("evt_retry_err", "payment_intent.payment_failed", {
        id: "pi_retry_err",
      }),
    );
    expect(retry).toEqual({ processed: true, action: "card_failure" });

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("card_failure");
  });

  it("reprocesses a stale 'received' receipt (the claimer died mid-handling)", async () => {
    const show = await seedShowRow();
    const offer = await seedPlacedOffer(show.id, {
      piId: "pi_stale",
      priceCents: 5000,
      groupSize: 2,
    });
    await db.insert(stripeWebhookEvents).values({
      eventId: "evt_stale",
      type: "payment_intent.payment_failed",
      paymentIntentId: "pi_stale",
      status: "received",
      createdAt: new Date(Date.now() - 10 * 60_000), // beyond the in-flight bound
    });

    const retry = await processStripeEvent(
      db,
      piEvent("evt_stale", "payment_intent.payment_failed", { id: "pi_stale" }),
    );
    expect(retry).toEqual({ processed: true, action: "card_failure" });

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("card_failure");
  });

  it("payment_failed does not clobber an offer mid-recovery ('recovering')", async () => {
    // A redelivered payment_failed for the old PI must not reset the
    // recovery's atomic claim — doing so would reopen the double-charge
    // window the claim exists to close.
    const show = await seedShowRow();
    const offer = await seedPlacedOffer(show.id, {
      piId: "pi_mid_recovery",
      priceCents: 5000,
      groupSize: 2,
    });
    await db
      .update(offers)
      .set({ status: "recovering", recoveringAt: new Date() })
      .where(eq(offers.id, offer.id));

    const result = await processStripeEvent(
      db,
      piEvent("evt_mid_recovery_fail", "payment_intent.payment_failed", {
        id: "pi_mid_recovery",
      }),
    );
    expect(result).toEqual({ processed: true, action: "ignored" });

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("recovering"); // claim intact
  });

  it("payment_intent.succeeded does not clobber an offer mid-recovery", async () => {
    const show = await seedShowRow();
    const offer = await seedPlacedOffer(show.id, {
      piId: "pi_mid_recovery_ok",
      priceCents: 5000,
      groupSize: 2,
    });
    await db
      .update(offers)
      .set({ status: "recovering", recoveringAt: new Date() })
      .where(eq(offers.id, offer.id));

    const result = await processStripeEvent(
      db,
      piEvent("evt_mid_recovery_ok", "payment_intent.succeeded", {
        id: "pi_mid_recovery_ok",
        amount_received: 10000,
      }),
    );
    expect(result).toEqual({ processed: true, action: "ignored" });

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("recovering"); // the recovery writes its own outcome
  });

  it("records canceled events without changing state", async () => {
    const show = await seedShowRow();
    const offer = await seedPlacedOffer(show.id, {
      piId: "pi_cancel",
      priceCents: 5000,
      groupSize: 2,
    });

    const result = await processStripeEvent(
      db,
      piEvent("evt_cancel", "payment_intent.canceled", { id: "pi_cancel" }),
    );
    expect(result.action).toBe("canceled_recorded");

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("placed"); // unchanged
    const [receipt] = await db
      .select()
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.eventId, "evt_cancel"));
    expect(receipt?.status).toBe("processed");
    expect(receipt?.paymentIntentId).toBe("pi_cancel");
  });

  it("records an unhandled event type as ignored", async () => {
    const result = await processStripeEvent(
      db,
      piEvent("evt_other", "charge.refunded", { id: "pi_whatever" }),
    );
    expect(result.action).toBe("ignored");
    const [receipt] = await db
      .select()
      .from(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.eventId, "evt_other"));
    expect(receipt?.status).toBe("ignored");
  });
});
