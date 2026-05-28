// Stripe SDK wrapper. Stays dormant when STRIPE_SECRET_KEY is unset —
// `stripe` is null in that case. Callers gate on the singleton (or use
// `requireStripe()`) and fall back to whatever the dormant path is for
// their specific flow (today: dev stub on POST /api/offers).
//
// Same posture as src/lib/email/client.ts — local dev / CI work
// without real keys; the gap surfaces as logs and is enforced at the
// route layer, not the module layer.
//
// API version is pinned. Stripe makes breaking API changes per version,
// and we want a deliberate upgrade path (re-run our test fixtures
// against a new version before bumping) rather than getting silently
// rolled forward by the SDK. Pin matches the SDK shipped here (Stripe
// 22.2.0 default = 2026-05-27.dahlia). When the SDK is bumped, this
// string moves in lock-step in the same PR.

import Stripe from "stripe";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const STRIPE_API_VERSION = "2026-05-27.dahlia";

export const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: STRIPE_API_VERSION,
      // Sane defaults for serverless: don't retry inside the function
      // (we own retry policy at the caller level via idempotency keys)
      // and short the network timeout so a Stripe outage doesn't pin a
      // Vercel function until the 30s default.
      maxNetworkRetries: 0,
      timeout: 10_000,
      typescript: true,
    })
  : null;

export type StripeClient = Stripe;

// Throws when called in a context that needs Stripe but the env isn't
// configured. Route handlers should use this when they intend to make
// a real Stripe call — the throw becomes a 500 the caller can map to a
// 503 if they want. The dev-stub path on POST /api/offers continues to
// check env.ALLOW_DEV_OFFER_STUB directly rather than going through
// here, since "dormant Stripe + dev stub" is the intended dev posture.
export function requireStripe(): Stripe {
  if (!stripe) {
    logger.error(
      "STRIPE_SECRET_KEY is not set but a real Stripe call was attempted",
    );
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for webhooks) to enable the real flow.",
    );
  }
  return stripe;
}
