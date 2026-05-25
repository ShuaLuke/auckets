import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Zod-validated environment variables.
 *
 * Per ADR-0009 / docs/SECURITY.md #9: all env vars are validated at build time
 * so missing or malformed values fail loudly, not at 3am in production. Never
 * read `process.env.X` directly elsewhere in the app — import from here.
 *
 * `SKIP_ENV_VALIDATION=1` bypasses validation. Use only when running tooling
 * that doesn't need a real environment (e.g. Docker builds, type-checking in CI
 * before secrets are wired up).
 */
export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
