import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Zod-validated environment variables.
 *
 * Per ADR-0009 / docs/SECURITY.md #9: all env vars are validated at build time
 * so missing or malformed values fail loudly, not at 3am in production. Never
 * read `process.env.X` directly elsewhere in the app — import from here.
 *
 * `SKIP_ENV_VALIDATION=1` bypasses validation in non-production contexts (CI
 * typecheck before secrets are wired, Docker builds, etc). It is rejected in
 * production: if someone leaves it set on Vercel prod we'd lose the whole
 * point of the validator, so refuse it loudly at module load.
 */
if (
  process.env.NODE_ENV === "production" &&
  process.env.SKIP_ENV_VALIDATION === "1"
) {
  throw new Error(
    "SKIP_ENV_VALIDATION is not allowed in production. Remove it from the environment.",
  );
}

// ALLOW_DEV_OFFER_STUB enables the dev-mode POST /api/offers stub that
// uses placeholder Stripe IDs instead of going through SetupIntent.
// Same safety posture as SKIP_ENV_VALIDATION — refuse loudly in real
// production so a stray env var can't accidentally turn it on and start
// writing fake-payment-method offer rows.
//
// Vercel sets NODE_ENV=production for BOTH production and preview
// deployments, so a pure NODE_ENV check would refuse the stub on
// preview too, where we actually want it enabled until the real
// SetupIntent flow (ADR-0003) lands. Prefer VERCEL_ENV when present
// (it distinguishes "production" / "preview" / "development") and fall
// back to NODE_ENV for local builds and CI. Exported so the guard is
// unit-testable without module-reload tricks.
export function assertNoDevStubInProduction(envVars: NodeJS.ProcessEnv): void {
  const isProductionDeploy =
    envVars.VERCEL_ENV !== undefined
      ? envVars.VERCEL_ENV === "production"
      : envVars.NODE_ENV === "production";
  if (isProductionDeploy && envVars.ALLOW_DEV_OFFER_STUB === "true") {
    throw new Error(
      "ALLOW_DEV_OFFER_STUB is not allowed in production. The real POST /api/offers (with SetupIntent) lands once ADR-0003 is settled.",
    );
  }
}

assertNoDevStubInProduction(process.env);

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    CLERK_SECRET_KEY: z.string().min(1).startsWith("sk_"),
    // Inngest signing/event keys are only needed once we deploy. Locally,
    // `npx inngest-cli dev` runs unauthenticated; in prod, Inngest will
    // reject unsigned requests if these are missing.
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    // Resend API key — optional so the email client stays dormant until
    // we have a verified domain. sendEmail() warns and no-ops without it.
    RESEND_API_KEY: z.string().min(1).startsWith("re_").optional(),
    RESEND_FROM_EMAIL: z.email().default("noreply@auckets.com"),
    // Ops notification targets.
    //   OPS_EMAIL — recipient for admin action emails (e.g. "ops@auckets.com").
    //   SLACK_OPS_WEBHOOK_URL — Slack incoming-webhook URL for the ops channel.
    //     Optional; when unset the Slack notifier warns and no-ops, matching
    //     the Resend pattern.
    OPS_EMAIL: z.email().default("ops@auckets.com"),
    SLACK_OPS_WEBHOOK_URL: z.url().optional(),
    // Stripe — optional; when unset the Stripe client (src/lib/stripe/client.ts)
    // stays dormant and POST /api/offers falls back to the dev stub (gated on
    // ALLOW_DEV_OFFER_STUB). Same dormant-without-keys posture as Resend.
    // STRIPE_SECRET_KEY: sk_test_ for the test mode, sk_live_ for production.
    //   The env validator accepts either; environment safety (no live keys
    //   in preview, no test keys in production) is enforced by Vercel env
    //   scoping, not here.
    // STRIPE_WEBHOOK_SECRET: whsec_ — used to verify webhook signatures
    //   (payment_intent.payment_failed, charge.refunded, etc). One per env.
    STRIPE_SECRET_KEY: z.string().min(1).startsWith("sk_").optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).startsWith("whsec_").optional(),
    // Dev-only escape hatch for the offer-submission flow while ADR-0003
    // (Stripe SetupIntent vs. pre-auth) is still being decided. When
    // "true", POST /api/offers accepts submissions using placeholder
    // Stripe IDs so the bid flow is exercisable end-to-end without
    // real Stripe. Refused in production at module load (see top of
    // file). Default "false" — the real path lands in its own slice
    // once Cope settles the hold-window question.
    ALLOW_DEV_OFFER_STUB: z.enum(["true", "false"]).default("false"),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).startsWith("pk_"),
    // Sentry DSN is intended to be public — exposing it doesn't grant write
    // access to anything beyond what the Sentry project already accepts.
    // Optional: when unset, Sentry stays dormant.
    NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
    // Stripe publishable key — used client-side by Stripe Elements to
    // tokenize cards into PaymentMethods before the server creates the
    // PaymentIntent. Public by design (it can only create PaymentMethods,
    // not charge them). Optional: when unset, the offer composer falls
    // back to the dev-stub submit path.
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).startsWith("pk_").optional(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
    INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
    OPS_EMAIL: process.env.OPS_EMAIL,
    SLACK_OPS_WEBHOOK_URL: process.env.SLACK_OPS_WEBHOOK_URL,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    ALLOW_DEV_OFFER_STUB: process.env.ALLOW_DEV_OFFER_STUB,
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});
