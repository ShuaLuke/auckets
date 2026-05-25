// Sentry server-side configuration. Loaded by src/instrumentation.ts when
// NEXT_RUNTIME === "nodejs" (i.e. Next.js's standard server runtime).
//
// See sentry.client.config.ts for the rationale on PII scrubbing and
// dormant-without-DSN behavior.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    environment: process.env.NODE_ENV,
  });
}
