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
// Same safety posture as SKIP_ENV_VALIDATION — refuse loudly in
// production so a stray env var on Vercel can't accidentally turn it
// on and start writing fake-payment-method offer rows.
if (
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_DEV_OFFER_STUB === "true"
) {
  throw new Error(
    "ALLOW_DEV_OFFER_STUB is not allowed in production. The real POST /api/offers (with SetupIntent) lands once ADR-0003 is settled.",
  );
}

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
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    ALLOW_DEV_OFFER_STUB: process.env.ALLOW_DEV_OFFER_STUB,
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});
