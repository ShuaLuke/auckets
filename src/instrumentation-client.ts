// Sentry client-side configuration. Next.js auto-loads this file in the
// browser (replaces the older sentry.client.config.ts convention; required
// for Turbopack compatibility).
//
// Per docs/SECURITY.md #32: PII fields are scrubbed from error reports.
// Sentry handles header/cookie scrubbing automatically; additional fields
// can be redacted in a `beforeSend` hook as we identify them.
//
// When NEXT_PUBLIC_SENTRY_DSN is unset, Sentry.init() is a no-op — no
// network calls, no overhead, no errors reported. Useful for local dev.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // 10% trace sampling by default — bump locally or per-env as needed.
    tracesSampleRate: 0.1,
    // Don't send PII fields by default. Re-enable per-event if we need it.
    sendDefaultPii: false,
    environment: process.env.NODE_ENV,
  });
}
