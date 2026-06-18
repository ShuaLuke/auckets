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

// Production-fatal env vars. Several keys are Zod-optional so dev, preview,
// and CI can run without real credentials — but in REAL production their
// absence doesn't fail loudly, it degrades silently:
//
//   STRIPE_SECRET_KEY              missing → POST /api/offers 503s AND the
//                                  scheduled-binding cron skips every sweep,
//                                  so shows never bind and nobody is paged.
//   STRIPE_WEBHOOK_SECRET          missing → the Stripe webhook 503s; card-
//                                  failure detection is dead.
//   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY  missing → Stripe Elements never
//                                  mounts; fans can't submit card details.
//   INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY  missing → none of the four
//                                  crons fire (binding, card-failure expiry,
//                                  ticket issuance, imminent emails).
//
// So: on a real production deploy, require them all at module load with one
// error that lists exactly what's missing and what breaks without it.
//
// "Real production" means VERCEL_ENV === "production" — strictly, with NO
// NODE_ENV fallback. This is deliberately narrower than
// assertNoDevStubInProduction: CI builds and unit tests run with
// NODE_ENV=production and format-valid dummy envs (only DATABASE_URL +
// Clerk + APP_URL), and must keep passing without Stripe/Inngest keys.
// Vercel sets VERCEL_ENV at build time too, so a production deploy with a
// missing key fails the build — loudly, before it can serve traffic.
//
// INNGEST_DEV is the inverse: it must be ABSENT in production. If set,
// the Inngest SDK skips request-signature validation and /api/inngest
// becomes an unauthenticated job-execution endpoint.
//
// Exported so the guard is unit-testable without module-reload tricks.
export function assertProductionCriticalEnv(envVars: NodeJS.ProcessEnv): void {
  if (envVars.VERCEL_ENV !== "production") return;

  // What silently breaks without each var, for the error message.
  // emptyStringAsUndefined below means "" is as good as unset — treat it so.
  const required: Array<[name: string, silentFailure: string]> = [
    [
      "STRIPE_SECRET_KEY",
      "offer submission 503s and the scheduled-binding cron silently skips every sweep (shows never bind)",
    ],
    [
      "STRIPE_WEBHOOK_SECRET",
      "the Stripe webhook 503s (card-failure detection dead)",
    ],
    [
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      "fans cannot submit card details (Stripe Elements never mounts)",
    ],
    [
      "INNGEST_EVENT_KEY",
      "events are never delivered, so no cron fires (binding, card-failure expiry, ticket issuance, imminent emails)",
    ],
    [
      "INNGEST_SIGNING_KEY",
      "Inngest cannot authenticate to /api/inngest, so no cron fires",
    ],
  ];

  const problems: string[] = [];
  for (const [name, silentFailure] of required) {
    const value = envVars[name];
    if (value === undefined || value === "") {
      problems.push(`  - ${name} is missing: ${silentFailure}`);
    }
  }
  if (envVars.INNGEST_DEV !== undefined && envVars.INNGEST_DEV !== "") {
    problems.push(
      "  - INNGEST_DEV is set: the Inngest SDK skips signature validation, making /api/inngest an unauthenticated job-execution endpoint. Remove it.",
    );
  }

  if (problems.length > 0) {
    throw new Error(
      "Production environment is misconfigured — refusing to start:\n" +
        problems.join("\n") +
        "\nSet these in the Vercel production environment (see the launch runbook) and redeploy.",
    );
  }
}

assertProductionCriticalEnv(process.env);

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
    // Card-failure recovery window (OPEN_QUESTION B, resolved 2026-05-29 by
    // Julia → 4h). A fan whose card fails at binding has this many minutes
    // from card_failure_at to submit a new card and reclaim the seat; after
    // that the expiry cron releases it. Tunable per environment without a
    // code change. z.coerce because env vars arrive as strings.
    CARD_FAILURE_RECOVERY_WINDOW_MINUTES: z.coerce
      .number()
      .int()
      .positive()
      .default(240),
    // Dev-only escape hatch for the offer-submission flow while ADR-0003
    // (Stripe SetupIntent vs. pre-auth) is still being decided. When
    // "true", POST /api/offers accepts submissions using placeholder
    // Stripe IDs so the bid flow is exercisable end-to-end without
    // real Stripe. Refused in production at module load (see top of
    // file). Default "false" — the real path lands in its own slice
    // once Cope settles the hold-window question.
    ALLOW_DEV_OFFER_STUB: z.enum(["true", "false"]).default("false"),
    // Pre-launch site-wide password gate. When set, src/middleware.ts
    // redirects every human-facing request to /unlock until the shared
    // password is entered; the Inngest + Stripe webhooks stay reachable so
    // background jobs keep firing. Optional + dormant when unset, so
    // local/dev/CI and post-launch production run wide open. NOT a
    // NEXT_PUBLIC_ var — the value never reaches the client; the unlock
    // form posts it to a Server Action. See src/lib/site-gate.ts.
    SITE_PASSWORD: z.string().min(1).optional(),
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
    CARD_FAILURE_RECOVERY_WINDOW_MINUTES:
      process.env.CARD_FAILURE_RECOVERY_WINDOW_MINUTES,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    ALLOW_DEV_OFFER_STUB: process.env.ALLOW_DEV_OFFER_STUB,
    SITE_PASSWORD: process.env.SITE_PASSWORD,
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});
