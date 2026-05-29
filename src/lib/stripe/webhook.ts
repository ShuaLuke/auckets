// Stripe webhook core (prime directive #6: verify signatures, handle
// idempotently). Split from the route so the dispatch + state transitions
// are integration-testable with synthetic Stripe.Event objects, while the
// route stays a thin shell that reads the raw body and verifies the
// signature.
//
// Scope (v1): the manual-capture PaymentIntent flow (ADR-0003). We act on
//   - payment_intent.payment_failed → offer card_failure (the async
//     card-failure case the synchronous binding capture can miss; the 2%
//     case ADR-0003 describes).
//   - payment_intent.succeeded      → offer charged (backstop / confirmation
//     of the binding capture).
//   - payment_intent.canceled       → recorded only (expected for released
//     unplaced auths).
// Every other event type is recorded and acked without action. Refunds /
// disputes arrive with the resale + dispute slices.
//
// Idempotency: Stripe redelivers events. We read the prior receipt and skip
// re-acting on one already in a terminal status; the state transitions below
// are themselves idempotent (they only move an offer between specific
// statuses), so a mid-flight redelivery is also safe.

import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import type { Db } from "@/lib/db";
import {
  WEBHOOK_TERMINAL_STATUSES,
  getOfferByPaymentIntentId,
  getWebhookEvent,
  markWebhookEvent,
  recordWebhookReceived,
} from "@/lib/db/repositories";
import { logger } from "@/lib/logger";
import { offers, seatAssignments } from "../../../drizzle/schema";

export type VerifyResult =
  | { ok: true; event: Stripe.Event }
  | { ok: false; error: string };

// Verify the Stripe signature and parse the event. constructEvent throws on
// a missing/forged/expired signature; we narrow that to a typed failure the
// route maps to a 400.
export function verifyAndParseEvent(
  stripe: Stripe,
  rawBody: string,
  signature: string | null,
  webhookSecret: string,
): VerifyResult {
  if (!signature) {
    return { ok: false, error: "missing stripe-signature header" };
  }
  try {
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );
    return { ok: true, event };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "signature verification failed",
    };
  }
}

export type WebhookAction =
  | "card_failure"
  | "charged"
  | "canceled_recorded"
  | "ignored"
  | "duplicate";

export type ProcessResult = {
  // false when the event was a duplicate already in a terminal status.
  processed: boolean;
  action: WebhookAction;
};

function paymentIntentOf(event: Stripe.Event): Stripe.PaymentIntent | null {
  if (event.type.startsWith("payment_intent.")) {
    return event.data.object as Stripe.PaymentIntent;
  }
  return null;
}

export async function processStripeEvent(
  db: Db,
  event: Stripe.Event,
): Promise<ProcessResult> {
  // Fast-path dedupe: an event already finished is a no-op.
  const existing = await getWebhookEvent(db, event.id);
  if (
    existing &&
    (WEBHOOK_TERMINAL_STATUSES as readonly string[]).includes(existing.status)
  ) {
    return { processed: false, action: "duplicate" };
  }

  const pi = paymentIntentOf(event);
  await recordWebhookReceived(db, {
    eventId: event.id,
    type: event.type,
    paymentIntentId: pi?.id ?? null,
  });

  try {
    let action: WebhookAction;
    switch (event.type) {
      case "payment_intent.payment_failed":
        action = await handlePaymentFailed(db, pi);
        break;
      case "payment_intent.succeeded":
        action = await handleSucceeded(db, pi);
        break;
      case "payment_intent.canceled":
        // Expected for unplaced offers whose auth we released at binding.
        // Nothing to change; the receipt is the record.
        action = "canceled_recorded";
        break;
      default:
        action = "ignored";
    }
    await markWebhookEvent(
      db,
      event.id,
      action === "ignored" ? "ignored" : "processed",
      action,
    );
    return { processed: true, action };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { eventId: event.id, type: event.type, err: message },
      "Stripe webhook handler failed",
    );
    // Leave the receipt non-terminal so Stripe's retry reprocesses it.
    await markWebhookEvent(db, event.id, "error", message);
    throw err; // route → 500 → Stripe retries
  }
}

async function handlePaymentFailed(
  db: Db,
  pi: Stripe.PaymentIntent | null,
): Promise<WebhookAction> {
  if (!pi) return "ignored";
  const offer = await getOfferByPaymentIntentId(db, pi.id);
  if (!offer) {
    logger.warn(
      { paymentIntentId: pi.id },
      "payment_failed for an unknown PaymentIntent — recorded only",
    );
    return "ignored";
  }
  if (offer.status === "charged") {
    // A PI can't both succeed and fail; if we already captured, don't undo it.
    logger.warn(
      { offerId: offer.id, paymentIntentId: pi.id },
      "payment_failed for an already-charged offer — ignoring",
    );
    return "ignored";
  }
  await db.transaction(async (tx) => {
    await tx
      .update(offers)
      .set({ status: "card_failure" })
      .where(eq(offers.id, offer.id));
    // Stamps the assignment when one exists (binding-time failure); matches
    // zero rows for a pre-binding failure, which is fine.
    await tx
      .update(seatAssignments)
      .set({ cardFailureAt: new Date() })
      .where(eq(seatAssignments.offerId, offer.id));
  });
  return "card_failure";
}

async function handleSucceeded(
  db: Db,
  pi: Stripe.PaymentIntent | null,
): Promise<WebhookAction> {
  if (!pi) return "ignored";
  const offer = await getOfferByPaymentIntentId(db, pi.id);
  if (!offer) {
    logger.warn(
      { paymentIntentId: pi.id },
      "payment_intent.succeeded for an unknown PaymentIntent — recorded only",
    );
    return "ignored";
  }
  if (offer.status === "charged") {
    // Binding's synchronous capture already recorded it. Idempotent no-op.
    return "ignored";
  }
  if (offer.status !== "placed" && offer.status !== "card_failure") {
    // A capture on an offer we think is pool/unplaced is anomalous — record
    // and surface it rather than silently flipping it to charged.
    logger.warn(
      { offerId: offer.id, status: offer.status, paymentIntentId: pi.id },
      "payment_intent.succeeded for an offer in an unexpected status — recorded only",
    );
    return "ignored";
  }
  // amount_received is the captured amount; fall back to the offer's total.
  const amountCents =
    pi.amount_received || offer.pricePerTicketCents * offer.groupSize;
  await db.transaction(async (tx) => {
    await tx
      .update(offers)
      .set({ status: "charged" })
      .where(eq(offers.id, offer.id));
    await tx
      .update(seatAssignments)
      .set({ chargedAmountCents: amountCents, cardFailureAt: null })
      .where(eq(seatAssignments.offerId, offer.id));
  });
  return "charged";
}
