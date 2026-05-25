// Sentry edge-runtime configuration. Loaded by src/instrumentation.ts when
// NEXT_RUNTIME === "edge". We don't currently target the edge runtime for
// any routes, but Sentry wires this up generically so future edge handlers
// (e.g. middleware) get error reporting for free.

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
