// PaymentIntent helpers for the offer flow. Per the 2026-05-27 ADR-0003
// working assumption, we create a PaymentIntent with capture_method
// 'manual' at offer submission — this authorizes the fan's card for the
// full amount (price × group_size) and holds the funds for up to ~7 days
// (Stripe's standard auth window). We capture the auth at binding
// allocation; for unplaced offers we cancel the auth and the funds
// release.
//
// What this module DELIBERATELY does NOT do:
//   - Stripe Customer management (slice 20). For first-submission only,
//     we pass the PaymentMethod ID directly to the PaymentIntent. The
//     PM is single-use unless attached to a Customer — fine for now
//     because revision support (which would need PM reuse) isn't in
//     this slice.
//   - Webhook handling (slice 22). Stripe will fire
//     payment_intent.payment_failed if the auth declines AFTER our
//     confirm=true succeeded (e.g. card cancelled between confirm and
//     capture). That's the 2% card-failure case the ADR mentions.
//   - Idempotency-key storage in offer_idempotency_keys (separate
//     concern, can ride along here or in its own slice). For now we
//     accept an idempotencyKey arg + pass it straight to Stripe;
//     Stripe's own idempotency dedupes most retry scenarios.

import type Stripe from "stripe";

import { logger } from "@/lib/logger";

export type CreateOfferPaymentIntentParams = {
  // The PaymentMethod ID created client-side via Stripe Elements (or
  // similar).
  paymentMethodId: string;
  // The fan's Stripe Customer (slice 20). Associates the PaymentIntent
  // with the Customer so all of a fan's payments group together in the
  // dashboard. Optional for back-compat with the slice-19 first-cut,
  // but the route always passes it now.
  customerId?: string;
  // price_per_ticket_cents × group_size. Money is integer cents (per
  // the project's hard constraint), and Stripe expects amounts in the
  // currency's smallest unit (cents for USD).
  amountCents: number;
  // Three-letter ISO currency code. Hardcoded "usd" for MVP — when we
  // ship to non-US venues, this needs to be derived from the show
  // (venue.country → currency mapping or a per-show currency column).
  // TODO: revisit when first non-US venue lands.
  currency?: "usd";
  // Stripe idempotency key — passed through to PaymentIntents.create
  // so a network retry doesn't create a duplicate PI. Optional; when
  // absent, Stripe assigns its own dedup key but we lose retry safety.
  idempotencyKey?: string;
  // Free-form key/value pairs attached to the PaymentIntent on the
  // Stripe side. Useful for ops debugging — search "showId" in the
  // Stripe dashboard to find all PaymentIntents for a show.
  metadata?: Record<string, string>;
};

export type CreateOfferPaymentIntentResult =
  | {
      ok: true;
      paymentIntentId: string;
      // Stripe statuses we care about post-confirm:
      //   "requires_capture" → success, funds held, ready for binding
      //   "succeeded" → instant capture (NOT what we want; this would
      //                  mean capture_method got dropped somehow)
      //   "requires_action" → 3DS or similar challenge needed (rare on
      //                       saved-card flows; logged so we notice)
      //   "requires_payment_method" → confirm failed; need a new PM
      status: Stripe.PaymentIntent.Status;
    }
  | {
      ok: false;
      // Stripe error code (e.g. "card_declined"). Routes map this to
      // appropriate HTTP statuses + user-facing copy.
      code: string;
      // The decline-or-error message Stripe returned. NOT for direct
      // display to fans (use code for branching + custom copy) but
      // captured here for logs and route response bodies.
      message: string;
    };

export async function createOfferPaymentIntent(
  stripe: Stripe,
  params: CreateOfferPaymentIntentParams,
): Promise<CreateOfferPaymentIntentResult> {
  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: params.amountCents,
        currency: params.currency ?? "usd",
        payment_method: params.paymentMethodId,
        ...(params.customerId ? { customer: params.customerId } : {}),
        // Manual capture is the whole point — Stripe holds the funds
        // (auth) but doesn't charge until we explicitly capture at
        // binding allocation. The auth typically holds for 7 days on
        // most card networks, matching the ≤6-day offer window
        // constraint from the ADR-0003 working assumption.
        capture_method: "manual",
        // Confirm immediately so the hold takes effect at create time.
        // Without this the PI sits in "requires_confirmation" and the
        // card is never charged/held.
        confirm: true,
        // Don't redirect for off-session payments. Our flow is
        // synchronous server-side; if 3DS triggers we get
        // "requires_action" back and surface that to the route. (Most
        // saved-card auths don't trigger 3DS.)
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
        ...(params.metadata ? { metadata: params.metadata } : {}),
      },
      params.idempotencyKey
        ? { idempotencyKey: params.idempotencyKey }
        : undefined,
    );

    if (intent.status === "requires_capture") {
      // Happy path — auth held, ready for binding capture.
      return { ok: true, paymentIntentId: intent.id, status: intent.status };
    }

    // requires_action / requires_payment_method / succeeded — surface
    // so the route can decide what to do. "succeeded" is the
    // surprising one: would mean capture_method got dropped, which
    // would be a real bug.
    logger.warn(
      { paymentIntentId: intent.id, status: intent.status },
      "PaymentIntent in unexpected status post-confirm",
    );
    return { ok: true, paymentIntentId: intent.id, status: intent.status };
  } catch (err) {
    // Stripe SDK throws typed errors. We narrow to StripeError-shaped
    // objects to pull code + message. Anything that doesn't match
    // (network errors, etc.) bubbles up as a generic error code.
    if (err && typeof err === "object" && "code" in err) {
      const stripeErr = err as { code?: string; message?: string };
      logger.error(
        { code: stripeErr.code, message: stripeErr.message },
        "Stripe createPaymentIntent failed",
      );
      return {
        ok: false,
        code: stripeErr.code ?? "stripe_error",
        message: stripeErr.message ?? "Unknown Stripe error",
      };
    }
    logger.error({ err }, "Non-Stripe error during createPaymentIntent");
    return {
      ok: false,
      code: "internal",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export type CancelPaymentIntentResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

// Cancels a PaymentIntent, releasing the card authorization (the fan's
// held funds free up). Used on revision: we cancel the prior auth
// before placing a new one for the revised amount.
//
// Idempotent-ish from our perspective: Stripe rejects cancelling a PI
// that's already in a terminal state (canceled / succeeded) with an
// invalid-state error. We treat "already not cancelable" as a soft
// success — the goal (no live auth on the old PI) is already met — and
// only surface hard errors. This keeps a revision from failing just
// because the old auth had already lapsed or been captured.
export async function cancelOfferPaymentIntent(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<CancelPaymentIntentResult> {
  try {
    await stripe.paymentIntents.cancel(paymentIntentId);
    return { ok: true };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      const stripeErr = err as { code?: string; message?: string };
      // payment_intent_unexpected_state → already canceled/succeeded.
      // Treat as success: there's no live auth to release.
      if (stripeErr.code === "payment_intent_unexpected_state") {
        logger.warn(
          { paymentIntentId, code: stripeErr.code },
          "Cancel skipped — PaymentIntent already in a terminal state",
        );
        return { ok: true };
      }
      logger.error(
        { paymentIntentId, code: stripeErr.code, message: stripeErr.message },
        "Stripe paymentIntents.cancel failed",
      );
      return {
        ok: false,
        code: stripeErr.code ?? "stripe_error",
        message: stripeErr.message ?? "Unknown Stripe error",
      };
    }
    logger.error({ err, paymentIntentId }, "Non-Stripe error during cancel");
    return {
      ok: false,
      code: "internal",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
