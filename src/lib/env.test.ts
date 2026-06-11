import { describe, expect, it } from "vitest";

import {
  assertNoDevStubInProduction,
  assertProductionCriticalEnv,
} from "./env";

/**
 * The guard refuses the dev-stub escape hatch on real production
 * deployments. Vercel sets NODE_ENV=production on BOTH production and
 * preview deploys, so we look at VERCEL_ENV when it's present and only
 * fall back to NODE_ENV for local/CI builds.
 */
describe("assertNoDevStubInProduction", () => {
  it("throws on Vercel production when the stub is enabled", () => {
    expect(() =>
      assertNoDevStubInProduction({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        ALLOW_DEV_OFFER_STUB: "true",
      }),
    ).toThrow(/ALLOW_DEV_OFFER_STUB is not allowed in production/);
  });

  it("allows the stub on Vercel preview", () => {
    // NODE_ENV is "production" on preview too — that's the trap the
    // VERCEL_ENV fallback exists to avoid.
    expect(() =>
      assertNoDevStubInProduction({
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
        ALLOW_DEV_OFFER_STUB: "true",
      }),
    ).not.toThrow();
  });

  it("allows the stub on Vercel development", () => {
    expect(() =>
      assertNoDevStubInProduction({
        NODE_ENV: "development",
        VERCEL_ENV: "development",
        ALLOW_DEV_OFFER_STUB: "true",
      }),
    ).not.toThrow();
  });

  it("throws when NODE_ENV=production locally and VERCEL_ENV is unset", () => {
    expect(() =>
      assertNoDevStubInProduction({
        NODE_ENV: "production",
        ALLOW_DEV_OFFER_STUB: "true",
      }),
    ).toThrow(/ALLOW_DEV_OFFER_STUB is not allowed in production/);
  });

  it("is a no-op when the stub flag is unset, regardless of env", () => {
    expect(() =>
      assertNoDevStubInProduction({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      }),
    ).not.toThrow();
  });

  it("is a no-op when the stub flag is the literal string \"false\"", () => {
    expect(() =>
      assertNoDevStubInProduction({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
        ALLOW_DEV_OFFER_STUB: "false",
      }),
    ).not.toThrow();
  });
});

/**
 * Production-critical env vars. Optional in the Zod schema (so dev/preview/CI
 * run keyless), but their absence in REAL production degrades silently —
 * crons skip, webhooks 503, fans can't pay. The guard makes that a loud
 * module-load failure on VERCEL_ENV=production only.
 */
describe("assertProductionCriticalEnv", () => {
  // The full set a real production deploy must carry.
  const completeProdEnv: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    STRIPE_SECRET_KEY: "sk_live_dummy",
    STRIPE_WEBHOOK_SECRET: "whsec_dummy",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_dummy",
    INNGEST_EVENT_KEY: "evt_dummy",
    INNGEST_SIGNING_KEY: "signkey_dummy",
  };

  it("passes on Vercel production when everything is set", () => {
    expect(() => assertProductionCriticalEnv(completeProdEnv)).not.toThrow();
  });

  it("throws on Vercel production when everything is missing, naming every var", () => {
    let message = "";
    try {
      assertProductionCriticalEnv({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
      });
    } catch (err) {
      message = (err as Error).message;
    }
    for (const name of [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      "INNGEST_EVENT_KEY",
      "INNGEST_SIGNING_KEY",
    ]) {
      expect(message).toContain(name);
    }
  });

  it("explains what silently breaks for a missing var", () => {
    expect(() =>
      assertProductionCriticalEnv({
        ...completeProdEnv,
        STRIPE_SECRET_KEY: undefined,
      }),
    ).toThrow(/scheduled-binding cron silently skips/);
  });

  it("lists only the missing vars, not the present ones", () => {
    let message = "";
    try {
      assertProductionCriticalEnv({
        ...completeProdEnv,
        INNGEST_SIGNING_KEY: undefined,
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("INNGEST_SIGNING_KEY");
    expect(message).not.toContain("STRIPE_SECRET_KEY");
  });

  it("treats an empty string as missing (matches emptyStringAsUndefined)", () => {
    expect(() =>
      assertProductionCriticalEnv({
        ...completeProdEnv,
        STRIPE_WEBHOOK_SECRET: "",
      }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("throws on Vercel production when INNGEST_DEV is set, even with all keys present", () => {
    expect(() =>
      assertProductionCriticalEnv({
        ...completeProdEnv,
        INNGEST_DEV: "1",
      }),
    ).toThrow(/INNGEST_DEV/);
  });

  it("is a no-op on Vercel preview with nothing set", () => {
    expect(() =>
      assertProductionCriticalEnv({
        NODE_ENV: "production",
        VERCEL_ENV: "preview",
      }),
    ).not.toThrow();
  });

  it("is a no-op when VERCEL_ENV is unset, even with NODE_ENV=production", () => {
    // Deliberately narrower than assertNoDevStubInProduction: CI builds and
    // unit tests run NODE_ENV=production with only the dummy DATABASE_URL +
    // Clerk + APP_URL vars, and must keep passing without Stripe/Inngest.
    expect(() =>
      assertProductionCriticalEnv({
        NODE_ENV: "production",
      }),
    ).not.toThrow();
  });

  it("is a no-op locally in development", () => {
    expect(() =>
      assertProductionCriticalEnv({
        NODE_ENV: "development",
        INNGEST_DEV: "1",
      }),
    ).not.toThrow();
  });
});
