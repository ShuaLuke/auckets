// Card-failure recovery (ADR-0003 §5, OPEN_QUESTION B → 4h window). When a
// fan's card fails at binding, the offer is left in 'card_failure' with the
// seat held and seat_assignments.card_failure_at stamped. This is the path a
// fan takes to reclaim the seat: submit a new card, we charge it immediately
// (the binding decision already happened — no auth-and-hold), and on success
// the offer resolves to 'charged' and the seat is saved.
//
// Split from the route (like webhook.ts) so the ownership + window + charge +
// resolve flow is integration-testable with a fake Stripe.

import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import type { Db } from "@/lib/db";
import {
  getOfferById,
  getSeatAssignmentByOfferId,
  getUserById,
  listExpiredCardFailures,
  setStripeCustomerId,
} from "@/lib/db/repositories";
import { logger } from "@/lib/logger";
import { ensureStripeCustomer } from "@/lib/stripe/customers";
import { chargeOfferImmediately } from "@/lib/stripe/payment-intents";
import { offers, seatAssignments } from "../../../drizzle/schema";

export type RecoverCardFailureError =
  | { kind: "offer_not_found" }
  | { kind: "forbidden" }
  | { kind: "not_recoverable"; status: string }
  | { kind: "no_seat" }
  | { kind: "window_expired" }
  | { kind: "customer_error"; code: string; message: string }
  | { kind: "charge_failed"; code: string; message: string };

export type RecoverCardFailureOutcome =
  | { ok: true; offerId: string; amountChargedCents: number }
  | { ok: false; error: RecoverCardFailureError };

export async function recoverCardFailure(
  db: Db,
  stripe: Stripe,
  params: {
    offerId: string;
    userId: string;
    paymentMethodId: string;
    windowMinutes: number;
    now: Date;
    idempotencyKey?: string;
  },
): Promise<RecoverCardFailureOutcome> {
  const offer = await getOfferById(db, params.offerId);
  if (!offer) return { ok: false, error: { kind: "offer_not_found" } };
  // Ownership: a fan can only recover their own offer.
  if (offer.userId !== params.userId) {
    return { ok: false, error: { kind: "forbidden" } };
  }
  // Only a failed offer is recoverable — a 'charged' offer is already done,
  // an 'unplaced' one was released (window lapsed) and can't be reclaimed.
  if (offer.status !== "card_failure") {
    return { ok: false, error: { kind: "not_recoverable", status: offer.status } };
  }

  const seat = await getSeatAssignmentByOfferId(db, params.offerId);
  if (!seat || !seat.cardFailureAt) {
    // No held seat / no failure stamp — nothing to recover against.
    return { ok: false, error: { kind: "no_seat" } };
  }

  const deadline = new Date(
    seat.cardFailureAt.getTime() + params.windowMinutes * 60_000,
  );
  if (params.now > deadline) {
    // The expiry cron may not have released it yet, but the fan is past the
    // window — refuse rather than charge for a seat about to be freed.
    return { ok: false, error: { kind: "window_expired" } };
  }

  const user = await getUserById(db, params.userId);
  const email = user?.email ?? `${params.userId}@placeholder.auckets.local`;
  const customer = await ensureStripeCustomer(stripe, {
    userId: params.userId,
    email,
    existingCustomerId: user?.stripeCustomerId ?? null,
  });
  if (!customer.ok) {
    return {
      ok: false,
      error: { kind: "customer_error", code: customer.code, message: customer.message },
    };
  }
  if (customer.created) {
    await setStripeCustomerId(db, params.userId, customer.customerId);
  }

  // Charge the amount the offer was bound at (price persists auto-bid raises).
  const amountCents = offer.pricePerTicketCents * offer.groupSize;
  const charge = await chargeOfferImmediately(stripe, {
    paymentMethodId: params.paymentMethodId,
    customerId: customer.customerId,
    amountCents,
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
    metadata: { offerId: offer.id, showId: offer.showId, recovery: "true" },
  });
  if (!charge.ok) {
    logger.warn(
      { offerId: offer.id, code: charge.code },
      "card-failure recovery charge failed — seat stays in card_failure",
    );
    return {
      ok: false,
      error: { kind: "charge_failed", code: charge.code, message: charge.message },
    };
  }

  // Seat saved: resolve the offer + assignment to the charged state, clearing
  // the failure stamp and pointing at the new PaymentIntent.
  await db.transaction(async (tx) => {
    await tx
      .update(offers)
      .set({ status: "charged", stripePaymentIntentId: charge.paymentIntentId })
      .where(eq(offers.id, offer.id));
    await tx
      .update(seatAssignments)
      .set({
        chargedAmountCents: charge.amountChargedCents,
        cardFailureAt: null,
        stripePaymentIntentId: charge.paymentIntentId,
      })
      .where(eq(seatAssignments.offerId, offer.id));
  });

  logger.info(
    { offerId: offer.id, amountChargedCents: charge.amountChargedCents },
    "card-failure recovery succeeded",
  );
  return { ok: true, offerId: offer.id, amountChargedCents: charge.amountChargedCents };
}

export type ExpireCardFailuresResult = {
  expired: number;
  offerIds: string[];
};

// Release seats whose recovery window has lapsed. For each card_failure offer
// past now − windowMinutes, the offer becomes 'unplaced' and its binding seat
// assignment is deleted (the seat returns to availability). No Stripe — the
// auth already failed, so there's nothing to cancel. Idempotent: once an
// offer is 'unplaced' it no longer matches listExpiredCardFailures.
export async function expireCardFailures(
  db: Db,
  now: Date,
  windowMinutes: number,
): Promise<ExpireCardFailuresResult> {
  const cutoff = new Date(now.getTime() - windowMinutes * 60_000);
  const expired = await listExpiredCardFailures(db, cutoff);

  for (const { offerId, seatAssignmentId } of expired) {
    await db.transaction(async (tx) => {
      await tx
        .update(offers)
        .set({ status: "unplaced" })
        .where(eq(offers.id, offerId));
      await tx
        .delete(seatAssignments)
        .where(eq(seatAssignments.id, seatAssignmentId));
    });
  }

  if (expired.length > 0) {
    logger.info(
      { expired: expired.length },
      "card-failure recovery windows lapsed — seats released",
    );
  }
  return { expired: expired.length, offerIds: expired.map((e) => e.offerId) };
}
