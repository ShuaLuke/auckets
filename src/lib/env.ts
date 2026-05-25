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

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
    // Sentry DSN is intended to be public — exposing it doesn't grant write
    // access to anything beyond what the Sentry project already accepts.
    // Optional: when unset, Sentry stays dormant.
    NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});
