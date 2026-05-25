// Next.js instrumentation hook. Called once per server runtime startup.
// Runtime-specific Sentry configs live at the repo root so the Sentry build
// plugin can discover them; this file is the glue that imports them.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export { captureRequestError as onRequestError } from "@sentry/nextjs";
