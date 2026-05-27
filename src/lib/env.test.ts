import { describe, expect, it } from "vitest";

import { assertNoDevStubInProduction } from "./env";

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
