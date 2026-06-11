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
// re-acting on one already in a terminal status. recordWebhookReceived is the
// concurrent-delivery gate: it claims the receipt row with an insert-or-noop,
// and only the claim winner runs handlers — two simultaneous deliveries of the
// same event can't both act (and, e.g., send the card-failure email twice).
// A receipt left in 'error' (handler threw) or in a stale 'received' (process
// died mid-handling) is reprocessed on Stripe's retry; the state transitions
// below are themselves idempotent, so a reprocess is safe.

import { and, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";

import type { Db } from "@/lib/db";
import {
  WEBHOOK_TERMINAL_STATUSES,
  getOfferByPaymentIntentId,
  getShowById,
  getUserById,
  getWebhookEvent,
  markWebhookEvent,
  recordWebhookReceived,
} from "@/lib/db/repositories";
import { logger } from "@/lib/logger";
import { notifyCardFailure } from "@/lib/notifications/fan";
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

// How fresh a 'received' (claimed, not yet finished) receipt must be to count
// as in-flight. Concurrent duplicate deliveries land within seconds; a
// 'received' row older than this means the claiming process died mid-handling,
// and Stripe's retry should reprocess rather than be told "duplicate" forever.
const IN_FLIGHT_RECEIPT_MAX_AGE_MS = 5 * 60_000;

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
  const claimed = await recordWebhookReceived(db, {
    eventId: event.id,
    type: event.type,
    paymentIntentId: pi?.id ?? null,
  });
  if (!claimed) {
    // The receipt row already existed, so we did NOT win the claim. Decide
    // from its status whether this delivery should still run handlers:
    //   - terminal → finished since our fast-path read; duplicate.
    //   - fresh 'received' → another delivery is handling it right now;
    //     running handlers too would double-act (the concurrent-delivery
    //     race this claim exists to close). Duplicate.
    //   - 'error', or a stale 'received' (claimer died mid-handling) →
    //     this is Stripe's retry; fall through and reprocess.
    const receipt = await getWebhookEvent(db, event.id);
    if (receipt) {
      const terminal = (
        WEBHOOK_TERMINAL_STATUSES as readonly string[]
      ).includes(receipt.status);
      const inFlight =
        receipt.status === "received" &&
        Date.now() - receipt.createdAt.getTime() < IN_FLIGHT_RECEIPT_MAX_AGE_MS;
      if (terminal || inFlight) {
        return { processed: false, action: "duplicate" };
      }
    }
  }

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
  if (offer.status === "recovering") {
    // An in-flight card-failure recovery owns this offer (it already knows
    // the card failed — that's why it's recovering). Resetting it to
    // card_failure here would break the recovery's claim and reopen the
    // double-charge window; the recovery itself reverts on a failed charge.
    logger.warn(
      { offerId: offer.id, paymentIntentId: pi.id },
      "payment_failed for an offer mid-recovery — recovery owns it; ignoring",
    );
    return "ignored";
  }
  const flipped = await db.transaction(async (tx) => {
    // Status-guarded for the same reason as above, but atomically: the
    // read of offer.status can go stale before this write (a recovery
    // claiming the offer, the succeeded backstop charging it). Only stamp
    // the seat — and only email the fan below — when the flip happened.
    const rows = await tx
      .update(offers)
      .set({ status: "card_failure" })
      .where(
        and(
          eq(offers.id, offer.id),
          inArray(offers.status, ["pool", "placed", "unplaced", "card_failure"]),
        ),
      )
      .returning({ id: offers.id });
    if (rows.length === 0) return false;
    // Stamps the assignment when one exists (binding-time failure); matches
    // zero rows for a pre-binding failure, which is fine.
    await tx
      .update(seatAssignments)
      .set({ cardFailureAt: new Date() })
      .where(eq(seatAssignments.offerId, offer.id));
    return true;
  });
  if (!flipped) {
    logger.warn(
      { offerId: offer.id, paymentIntentId: pi.id },
      "payment_failed flip skipped — offer status moved concurrently",
    );
    return "ignored";
  }

  // Tell the fan to add a working card within the recovery window. Best-effort
  // and fully isolated: a mail/lookup hiccup must not flip the webhook to an
  // error status (which would make Stripe retry and re-process). sendEmail
  // no-ops without RESEND_API_KEY.
  try {
    const [show, user] = await Promise.all([
      getShowById(db, offer.showId),
      getUserById(db, offer.userId),
    ]);
    if (show && user) {
      await notifyCardFailure(
        {
          showId: show.id,
          artistName: show.artist.name,
          showName: show.venue.name,
          doorsAt: show.doorsAt,
        },
        { to: user.email },
      );
    }
  } catch (err) {
    logger.error(
      { event: "webhook.card_failure.notify_failed", offerId: offer.id, err },
      "card_failure fan email failed (offer already flagged)",
    );
  }

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
    // and surface it rather than silently flipping it to charged. This also
    // covers 'recovering': an in-flight recovery owns the offer and will
    // write its own outcome.
    logger.warn(
      { offerId: offer.id, status: offer.status, paymentIntentId: pi.id },
      "payment_intent.succeeded for an offer in an unexpected status — recorded only",
    );
    return "ignored";
  }
  // amount_received is the captured amount; fall back to the offer's total.
  const amountCents =
    pi.amount_received || offer.pricePerTicketCents * offer.groupSize;
  const charged = await db.transaction(async (tx) => {
    // Status-guarded: the read above can go stale (e.g. a recovery claims
    // the offer between our read and this write). Only the statuses we
    // checked for may flip; the seat stamp rides on the flip.
    const rows = await tx
      .update(offers)
      .set({ status: "charged" })
      .where(
        and(
          eq(offers.id, offer.id),
          inArray(offers.status, ["placed", "card_failure"]),
        ),
      )
      .returning({ id: offers.id });
    if (rows.length === 0) return false;
    await tx
      .update(seatAssignments)
      .set({ chargedAmountCents: amountCents, cardFailureAt: null })
      .where(eq(seatAssignments.offerId, offer.id));
    return true;
  });
  if (!charged) {
    logger.warn(
      { offerId: offer.id, paymentIntentId: pi.id },
      "payment_intent.succeeded flip skipped — offer status moved concurrently",
    );
    return "ignored";
  }
  return "charged";
}
