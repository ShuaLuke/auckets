// Card-failure recovery (ADR-0003 §5, OPEN_QUESTION B → 4h window). When a
// fan's card fails at binding, the offer is left in 'card_failure' with the
// seat held and seat_assignments.card_failure_at stamped. This is the path a
// fan takes to reclaim the seat: submit a new card, we charge it immediately
// (the binding decision already happened — no auth-and-hold), and on success
// the offer resolves to 'charged' and the seat is saved.
//
// Split from the route (like webhook.ts) so the ownership + window + charge +
// resolve flow is integration-testable with a fake Stripe.
//
// CONCURRENCY (the money-correctness core of this module):
//
//   recoverCardFailure makes a real, immediate-capture charge, and the route
//   doesn't require an Idempotency-Key — so two concurrent POSTs (a
//   double-click) must not both reach Stripe. A plain status check
//   (read 'card_failure' → multi-second Stripe round-trips → write 'charged')
//   is check-then-act: both requests pass the read before either writes.
//
//   Fix: an atomic claim BEFORE any Stripe call. The offer is moved
//   card_failure → 'recovering' with a status-guarded compare-and-set
//   (UPDATE … WHERE status='card_failure', rowcount-checked). Exactly one
//   concurrent request wins the row; the loser returns not_recoverable
//   without ever touching Stripe. On a failed charge the claim reverts
//   ('recovering' → 'card_failure') so the fan can retry within the window;
//   on success the final write is guarded too, so a state that moved under
//   us (expiry, webhook) is detected instead of overwritten.
//
//   Crash-safety: a process death mid-recovery would strand the offer in
//   'recovering' (the fan couldn't retry — the CAS would keep losing).
//   offers.recovering_at records when the claim was taken;
//   expireCardFailures sweeps claims older than STALE_RECOVERING_MINUTES
//   back to 'card_failure'. The bound is generous (recovery is two Stripe
//   calls — seconds, not minutes), so a live recovery is never swept.

import { and, eq, inArray, lte } from "drizzle-orm";
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

// How long a 'recovering' claim may sit before the expiry cron presumes the
// process died mid-recovery and reverts it to 'card_failure'. Recovery is
// two Stripe calls (ensure-customer + charge) — seconds in practice — so
// 15 minutes never sweeps a live recovery, while a crashed one unblocks the
// fan well inside the 4h window.
export const STALE_RECOVERING_MINUTES = 15;

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
  // an 'unplaced' one was released (window lapsed) and can't be reclaimed,
  // and 'recovering' means another request for this offer is mid-charge.
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

  // Atomic claim — the double-charge guard. The status check above was only
  // advisory (it can go stale during the Stripe round-trips below); THIS is
  // the gate. Exactly one concurrent request flips card_failure → recovering;
  // every other one matches zero rows and stops here, before any Stripe call.
  const claimed = await db
    .update(offers)
    .set({ status: "recovering", recoveringAt: params.now })
    .where(and(eq(offers.id, offer.id), eq(offers.status, "card_failure")))
    .returning({ id: offers.id });
  if (claimed.length === 0) {
    // Lost the claim: a concurrent recovery (or the expiry cron / webhook)
    // moved the offer first. Re-read for an accurate status in the error.
    const fresh = await getOfferById(db, params.offerId);
    return {
      ok: false,
      error: { kind: "not_recoverable", status: fresh?.status ?? offer.status },
    };
  }

  // Hand the claim back so the fan can retry with another card. Guarded so a
  // sweep that already reverted us (shouldn't happen inside the stale bound)
  // isn't double-written.
  const revertClaim = async () => {
    await db
      .update(offers)
      .set({ status: "card_failure", recoveringAt: null })
      .where(and(eq(offers.id, offer.id), eq(offers.status, "recovering")));
  };

  const user = await getUserById(db, params.userId);
  const email = user?.email ?? `${params.userId}@placeholder.auckets.local`;
  const customer = await ensureStripeCustomer(stripe, {
    userId: params.userId,
    email,
    existingCustomerId: user?.stripeCustomerId ?? null,
  });
  if (!customer.ok) {
    await revertClaim();
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
    await revertClaim();
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
  // the failure stamp and pointing at the new PaymentIntent. The offer write
  // is guarded: 'recovering' is ours; 'card_failure' covers the one
  // legitimate race where the stale-claim sweep reverted us mid-charge (a
  // recovery that somehow outlived STALE_RECOVERING_MINUTES) and nobody has
  // re-claimed since. Anything else means the state moved while money was in
  // flight — never overwrite it; log loudly for manual reconciliation.
  let resolved = false;
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(offers)
      .set({
        status: "charged",
        stripePaymentIntentId: charge.paymentIntentId,
        recoveringAt: null,
      })
      .where(
        and(
          eq(offers.id, offer.id),
          inArray(offers.status, ["recovering", "card_failure"]),
        ),
      )
      .returning({ id: offers.id });
    if (updated.length === 0) return;
    resolved = true;
    await tx
      .update(seatAssignments)
      .set({
        chargedAmountCents: charge.amountChargedCents,
        cardFailureAt: null,
        stripePaymentIntentId: charge.paymentIntentId,
      })
      .where(eq(seatAssignments.offerId, offer.id));
  });

  if (!resolved) {
    // The charge succeeded on Stripe but the offer was no longer ours to
    // resolve (e.g. swept to 'unplaced' or re-claimed after an implausibly
    // long recovery). Money moved — surface it for ops instead of silently
    // dropping it. We still report ok to the fan: their card WAS charged.
    logger.error(
      {
        offerId: offer.id,
        paymentIntentId: charge.paymentIntentId,
        amountChargedCents: charge.amountChargedCents,
      },
      "recovery charge succeeded but the offer left 'recovering' mid-charge — manual reconciliation needed",
    );
  } else {
    logger.info(
      { offerId: offer.id, amountChargedCents: charge.amountChargedCents },
      "card-failure recovery succeeded",
    );
  }
  return { ok: true, offerId: offer.id, amountChargedCents: charge.amountChargedCents };
}

export type ExpireCardFailuresResult = {
  expired: number;
  offerIds: string[];
  // 'recovering' claims older than STALE_RECOVERING_MINUTES handed back to
  // 'card_failure' (a crashed recovery — the fan can retry).
  staleRecoveriesReverted: number;
};

// Release one expired card-failure seat. Status-guarded: the offer flips to
// 'unplaced' ONLY if it is still 'card_failure', and the seat assignment is
// deleted only when that flip actually happened. This closes the race where
// a recovery (or the payment_intent.succeeded webhook backstop) resolves the
// offer to 'charged' between the cron's work-list read and this write — an
// unconditional update would have overwritten 'charged' and deleted the seat
// of a fan who just paid. Returns true when the seat was released.
//
// Exported for direct test coverage of the guard (the race itself can't be
// interleaved deterministically through expireCardFailures).
export async function releaseExpiredCardFailure(
  db: Db,
  offerId: string,
  seatAssignmentId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const released = await tx
      .update(offers)
      .set({ status: "unplaced" })
      .where(and(eq(offers.id, offerId), eq(offers.status, "card_failure")))
      .returning({ id: offers.id });
    if (released.length === 0) {
      // The offer moved since the work list was read (recovered to 'charged',
      // or claimed by an in-flight recovery). Leave it — and its seat — alone.
      return false;
    }
    await tx
      .delete(seatAssignments)
      .where(eq(seatAssignments.id, seatAssignmentId));
    return true;
  });
}

// Release seats whose recovery window has lapsed. For each card_failure offer
// past now − windowMinutes, the offer becomes 'unplaced' and its binding seat
// assignment is deleted (the seat returns to availability). No Stripe — the
// auth already failed, so there's nothing to cancel. Idempotent: once an
// offer is 'unplaced' it no longer matches listExpiredCardFailures.
//
// Also sweeps orphaned 'recovering' claims (see the module header): a claim
// older than STALE_RECOVERING_MINUTES reverts to 'card_failure' first, so a
// crashed recovery unblocks the fan — and, if its window has also lapsed, it
// is picked up by the expiry pass in this same run.
export async function expireCardFailures(
  db: Db,
  now: Date,
  windowMinutes: number,
): Promise<ExpireCardFailuresResult> {
  // 1. Sweep stale 'recovering' claims back to 'card_failure'. Status-guarded
  // by construction (WHERE status='recovering'); recovering_at is only set
  // while a claim is held, so a live recovery inside the bound is never swept.
  const staleCutoff = new Date(
    now.getTime() - STALE_RECOVERING_MINUTES * 60_000,
  );
  const reverted = await db
    .update(offers)
    .set({ status: "card_failure", recoveringAt: null })
    .where(
      and(eq(offers.status, "recovering"), lte(offers.recoveringAt, staleCutoff)),
    )
    .returning({ id: offers.id });
  if (reverted.length > 0) {
    logger.warn(
      { offerIds: reverted.map((r) => r.id) },
      "stale 'recovering' claims swept back to card_failure (crashed recovery?)",
    );
  }

  // 2. Release seats whose window has lapsed.
  const cutoff = new Date(now.getTime() - windowMinutes * 60_000);
  const expired = await listExpiredCardFailures(db, cutoff);

  const releasedIds: string[] = [];
  for (const { offerId, seatAssignmentId } of expired) {
    const released = await releaseExpiredCardFailure(
      db,
      offerId,
      seatAssignmentId,
    );
    if (released) releasedIds.push(offerId);
  }

  if (releasedIds.length > 0) {
    logger.info(
      { expired: releasedIds.length },
      "card-failure recovery windows lapsed — seats released",
    );
  }
  return {
    expired: releasedIds.length,
    offerIds: releasedIds,
    staleRecoveriesReverted: reverted.length,
  };
}
