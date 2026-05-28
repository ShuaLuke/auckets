// POST /api/offers — submits or revises an offer for the calling user.
//
// Two code paths share this route, picked by the env + body shape:
//
//   1. REAL PATH (Stripe-backed): when STRIPE_SECRET_KEY is set AND the
//      body includes stripePaymentMethodId. Creates a PaymentIntent
//      with capture_method='manual' to hold the fan's card auth for
//      the offer window (≤6 days per 2026-05-27 ADR-0003 working
//      assumption), then upserts the offer with the real
//      stripe_payment_intent_id. Only handles FIRST submission this
//      slice — revisions on the real path return 501 (Customer attach
//      + PaymentMethod reuse for revision lands in the next slice).
//
//   2. DEV STUB: when ALLOW_DEV_OFFER_STUB="true" and the real path
//      isn't selected. Bypasses Stripe with placeholder
//      stripe_payment_method_id / stripe_setup_intent_id so the bid
//      flow stays exercisable end-to-end without configuring Stripe.
//      Production refuses the stub at module load via env validation.
//
//   3. Neither configured → 503. Tells the caller offer submission is
//      disabled and what to enable.
//
// Flow: auth → body → ensure user mirror → fetch show → branch on
// Stripe-mode → (real: create PaymentIntent OR stub) → upsert offer →
// respond.
//
// Out of scope for this slice:
//   - Idempotency-keys table writes (offer_idempotency_keys). The
//     real path passes the Stripe Idempotency-Key header through to
//     Stripe (server-side dedup), which covers retry safety for the
//     PaymentIntent. App-level dedup against the table lands later.
//   - Revision on the real path. Reusing a PaymentMethod requires
//     attaching it to a Customer; current real path keeps PaymentMethod
//     single-use. Revisions fall through to the dev stub OR return 501.
//   - "Revise upward only" rule. Lands when revision is supported.
//   - Webhook handler for payment_intent.payment_failed (the 2% card-
//     failure case). Separate slice.

import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  ensureUserMirror,
  getOfferByShowAndUser,
  getShowById,
  upsertOfferForUser,
} from "@/lib/db/repositories";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe/client";
import { createOfferPaymentIntent } from "@/lib/stripe/payment-intents";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

// Schema mirrors the offers table CHECK constraints
// (drizzle/schema.ts §7) so the validator catches what the DB would
// reject anyway, with friendlier error messages.
const BodySchema = z
  .object({
    showId: uuidParam,
    groupSize: z.int().min(1).max(10),
    pricePerTicketCents: z.int().positive(),
    tierPreference: z.enum([
      "specific",
      "this_or_better",
      "this_or_worse",
      "any",
    ]),
    preferredTier: z.string().min(1).optional(),
    channel: z.enum(["market", "bleacher"]).default("market"),
    autoBidEnabled: z.boolean().default(false),
    autoBidCapCents: z.int().positive().optional(),
    autoBidIncrementCents: z.int().positive().default(500),
    // ADR-0017 — server-only. Accepted on input but never echoed back
    // to other users; the GET /api/shows/[id] response strips it via
    // the presenter.
    privateThresholdCents: z.int().positive().optional(),
    // Stripe PaymentMethod ID from Stripe Elements client-side. When
    // present + Stripe keys configured, the real PaymentIntent path
    // runs. When absent, the route falls back to the dev stub if
    // enabled. Format: pm_<random>.
    stripePaymentMethodId: z
      .string()
      .startsWith("pm_")
      .optional(),
  })
  .superRefine((data, ctx) => {
    // Mirror the DB CHECK: when autoBidEnabled, the cap must be set
    // AND >= pricePerTicketCents.
    if (data.autoBidEnabled) {
      if (data.autoBidCapCents === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["autoBidCapCents"],
          message: "autoBidCapCents required when autoBidEnabled",
        });
      } else if (data.autoBidCapCents < data.pricePerTicketCents) {
        ctx.addIssue({
          code: "custom",
          path: ["autoBidCapCents"],
          message: "autoBidCapCents must be >= pricePerTicketCents",
        });
      }
    }
    // Tier-bound preferences need preferredTier set. 'any' must not
    // carry one (it'd be misleading).
    if (data.tierPreference !== "any" && !data.preferredTier) {
      ctx.addIssue({
        code: "custom",
        path: ["preferredTier"],
        message: `preferredTier required when tierPreference is "${data.tierPreference}"`,
      });
    }
    if (data.tierPreference === "any" && data.preferredTier) {
      ctx.addIssue({
        code: "custom",
        path: ["preferredTier"],
        message: 'preferredTier must be omitted when tierPreference is "any"',
      });
    }
  });

type SubmitResponse = {
  ok: true;
  offerId: string;
  isRevision: boolean;
  showId: string;
  // Echo the path that was taken so clients can branch on it (e.g.
  // surface "your card was authorized for $X" when path='real'.)
  path: "real" | "stub";
};

type ErrorBody = { error: string; details?: unknown };

const SHOW_OPEN_STATUSES = new Set(["open"]);

// Placeholder Stripe IDs encode the userId + a timestamp so they're
// unique per submission and obviously fake to any human inspecting
// the row. The real path writes stripe_payment_intent_id (a real
// PaymentIntent) instead. The schema check
// (offers_stripe_intent_check) requires at least one of the two
// columns to be set; the stub fills the SetupIntent slot.
function stubStripeIds(userId: string) {
  const tag = `${userId}_${Date.now()}`;
  return {
    stripePaymentMethodId: `pm_dev_${tag}`,
    stripeSetupIntentId: `seti_dev_${tag}`,
  };
}

// Map Stripe error codes to HTTP statuses. card_declined and similar
// user-fixable errors → 402 (Payment Required) so the client can
// surface "your card was declined" without conflating it with our own
// 400s. Everything else → 502 (we couldn't talk to / Stripe rejected
// us at the infra level).
function stripeErrorToHttpStatus(code: string): number {
  if (
    code === "card_declined" ||
    code === "expired_card" ||
    code === "incorrect_cvc" ||
    code === "insufficient_funds" ||
    code === "processing_error"
  ) {
    return 402;
  }
  return 502;
}

export async function POST(
  request: Request,
): Promise<NextResponse<SubmitResponse | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Decide which path runs. Real path requires both the server-side
  // Stripe client (STRIPE_SECRET_KEY) and a client-supplied
  // PaymentMethod ID. Without both, fall back to the stub if enabled.
  const realPathAvailable = stripe !== null && body.stripePaymentMethodId;
  const stubPathAllowed = env.ALLOW_DEV_OFFER_STUB === "true";

  if (!realPathAvailable && !stubPathAllowed) {
    return NextResponse.json(
      {
        error:
          "offer submission disabled. Either configure STRIPE_SECRET_KEY + send stripePaymentMethodId, or set ALLOW_DEV_OFFER_STUB=true for the dev stub.",
      },
      { status: 503 },
    );
  }

  // Ensure the local users mirror exists before the FK fires. Email is
  // pulled from Clerk; primaryEmailAddress is always set for verified
  // accounts. Fallback uses the Clerk user_id in a placeholder domain
  // so the email-UNIQUE constraint doesn't block a corner-case account
  // without a primary email (rare but possible during signup).
  const clerk = await currentUser();
  const email =
    clerk?.primaryEmailAddress?.emailAddress ??
    `${userId}@placeholder.auckets.local`;
  await ensureUserMirror(db, { id: userId, email });

  // Show must exist and be eligible to accept offers. 'open' only —
  // paused / closed / allocating / allocated / complete all reject
  // with 409. Time-window enforcement (offerWindowOpensAt) is part of
  // the real flow polish.
  const show = await getShowById(db, body.showId);
  if (!show) {
    return NextResponse.json({ error: "show not found" }, { status: 404 });
  }
  if (!SHOW_OPEN_STATUSES.has(show.status)) {
    return NextResponse.json(
      { error: `show is not accepting offers (status=${show.status})` },
      { status: 409 },
    );
  }

  // Real path: create a PaymentIntent, then upsert. First submission
  // only in this slice — revisions return 501 here (the stub path
  // continues to handle them).
  if (realPathAvailable && stripe && body.stripePaymentMethodId) {
    const existing = await getOfferByShowAndUser(db, body.showId, userId);
    if (existing) {
      return NextResponse.json(
        {
          error:
            "real-Stripe revision is not yet supported (slice 20). Existing offer found for this show.",
        },
        { status: 501 },
      );
    }

    const amountCents = body.pricePerTicketCents * body.groupSize;
    // Optional idempotency key from the request header. Stripe uses
    // this server-side to dedupe retries of the same PaymentIntent
    // create call. When absent, retries CAN create duplicates — the
    // client SHOULD always send one; we don't enforce it yet because
    // the dev-stub path doesn't either.
    const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;

    const piResult = await createOfferPaymentIntent(stripe, {
      paymentMethodId: body.stripePaymentMethodId,
      amountCents,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      metadata: { showId: body.showId, userId },
    });

    if (!piResult.ok) {
      return NextResponse.json(
        { error: piResult.message, details: { code: piResult.code } },
        { status: stripeErrorToHttpStatus(piResult.code) },
      );
    }

    if (piResult.status !== "requires_capture") {
      // 3DS challenge or similar — we don't have client-side action
      // wiring yet, so surface as 402 (Payment Required) with the
      // status code so the future client can branch on it.
      logger.warn(
        { paymentIntentId: piResult.paymentIntentId, status: piResult.status },
        "PaymentIntent needs additional action — not yet wired",
      );
      return NextResponse.json(
        {
          error: `PaymentIntent requires additional action (status=${piResult.status})`,
          details: {
            code: "requires_action",
            paymentIntentId: piResult.paymentIntentId,
          },
        },
        { status: 402 },
      );
    }

    const { offer, isRevision } = await upsertOfferForUser(db, {
      showId: body.showId,
      userId,
      groupSize: body.groupSize,
      pricePerTicketCents: body.pricePerTicketCents,
      tierPreference: body.tierPreference,
      preferredTier: body.preferredTier ?? null,
      channel: body.channel,
      autoBidEnabled: body.autoBidEnabled,
      autoBidCapCents: body.autoBidCapCents ?? null,
      autoBidIncrementCents: body.autoBidIncrementCents,
      privateThresholdCents: body.privateThresholdCents ?? null,
      stripePaymentMethodId: body.stripePaymentMethodId,
      // Real path leaves setup_intent_id null; payment_intent_id is
      // the chase-back-to-Stripe reference. The CHECK constraint
      // requires at least one — payment_intent_id satisfies it.
      stripePaymentIntentId: piResult.paymentIntentId,
    });

    return NextResponse.json(
      {
        ok: true,
        offerId: offer.id,
        isRevision,
        showId: offer.showId,
        path: "real",
      },
      { status: isRevision ? 200 : 201 },
    );
  }

  // Dev stub path. Existing behavior unchanged.
  const { offer, isRevision } = await upsertOfferForUser(db, {
    showId: body.showId,
    userId,
    groupSize: body.groupSize,
    pricePerTicketCents: body.pricePerTicketCents,
    tierPreference: body.tierPreference,
    preferredTier: body.preferredTier ?? null,
    channel: body.channel,
    autoBidEnabled: body.autoBidEnabled,
    autoBidCapCents: body.autoBidCapCents ?? null,
    autoBidIncrementCents: body.autoBidIncrementCents,
    privateThresholdCents: body.privateThresholdCents ?? null,
    ...stubStripeIds(userId),
  });

  return NextResponse.json(
    {
      ok: true,
      offerId: offer.id,
      isRevision,
      showId: offer.showId,
      path: "stub",
    },
    { status: isRevision ? 200 : 201 },
  );
}
