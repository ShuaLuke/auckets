// POST /api/stripe/webhook — Stripe's async event delivery (prime directive
// #6). Verifies the signature against STRIPE_WEBHOOK_SECRET on the RAW body
// (no JSON parsing before verification), then hands the parsed event to the
// idempotent processor. See src/lib/stripe/webhook.ts for the dispatch.
//
// Unlike every other route, this one has no Clerk auth — Stripe is the
// caller, and the signature IS the authentication. An unsigned/forged
// request is rejected at verification with a 400.

import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { stripe } from "@/lib/stripe/client";
import { processStripeEvent, verifyAndParseEvent } from "@/lib/stripe/webhook";

export const dynamic = "force-dynamic";

type Body = { received: true; action: string } | { error: string };

export async function POST(request: Request): Promise<NextResponse<Body>> {
  // Both the SDK client and the signing secret are required to verify. When
  // either is unset (local/dev without Stripe), there's nothing to verify
  // against — refuse rather than process an unverifiable payload.
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    logger.error(
      "Stripe webhook received but STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET is not configured",
    );
    return NextResponse.json(
      { error: "stripe not configured" },
      { status: 503 },
    );
  }

  // Raw body is required for signature verification — must be the exact bytes
  // Stripe signed, so read as text before any parsing.
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  const verified = verifyAndParseEvent(
    stripe,
    rawBody,
    signature,
    env.STRIPE_WEBHOOK_SECRET,
  );
  if (!verified.ok) {
    logger.warn(
      { error: verified.error },
      "Stripe webhook signature verification failed",
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    const result = await processStripeEvent(db, verified.event);
    return NextResponse.json({ received: true, action: result.action });
  } catch {
    // The handler recorded the failure as 'error'; a 500 tells Stripe to
    // retry, and the receipt's non-terminal status lets the retry reprocess.
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }
}
