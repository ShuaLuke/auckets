import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GATE_COOKIE_NAME,
  gateCookieValue,
  isGateCookieValid,
  isGateExemptPath,
  safeEqualHex,
} from "./site-gate";

describe("isGateExemptPath", () => {
  it("exempts the unlock page and its server-action POST", () => {
    expect(isGateExemptPath("/unlock")).toBe(true);
    expect(isGateExemptPath("/unlock/")).toBe(true);
  });

  it("exempts the signed webhook endpoints (and anything nested)", () => {
    expect(isGateExemptPath("/api/inngest")).toBe(true);
    expect(isGateExemptPath("/api/stripe/webhook")).toBe(true);
    expect(isGateExemptPath("/api/stripe/webhook/retry")).toBe(true);
  });

  it("does NOT exempt lookalike paths that merely share a prefix", () => {
    expect(isGateExemptPath("/unlocked")).toBe(false);
    expect(isGateExemptPath("/unlock-me")).toBe(false);
    // /api/stripe is gated; only its /webhook child is exempt.
    expect(isGateExemptPath("/api/stripe")).toBe(false);
  });

  it("gates ordinary pages and API routes", () => {
    expect(isGateExemptPath("/")).toBe(false);
    expect(isGateExemptPath("/shows")).toBe(false);
    expect(isGateExemptPath("/dashboard")).toBe(false);
    expect(isGateExemptPath("/sign-in")).toBe(false);
    expect(isGateExemptPath("/api/offers")).toBe(false);
  });
});

describe("gateCookieValue", () => {
  it("matches a plain SHA-256 hex digest (Web Crypto == Node crypto)", async () => {
    const expected = createHash("sha256").update("hunter2").digest("hex");
    expect(await gateCookieValue("hunter2")).toBe(expected);
  });

  it("is a stable 64-char lowercase hex string", async () => {
    const value = await gateCookieValue("the-shared-password");
    expect(value).toMatch(/^[0-9a-f]{64}$/);
    expect(await gateCookieValue("the-shared-password")).toBe(value);
  });

  it("differs for different passwords", async () => {
    expect(await gateCookieValue("alpha")).not.toBe(
      await gateCookieValue("beta"),
    );
  });
});

describe("safeEqualHex", () => {
  it("returns true only for identical strings", () => {
    expect(safeEqualHex("abc123", "abc123")).toBe(true);
    expect(safeEqualHex("abc123", "abc124")).toBe(false);
  });

  it("returns false when lengths differ", () => {
    expect(safeEqualHex("abc", "abcd")).toBe(false);
  });
});

describe("isGateCookieValid", () => {
  const password = "open-sesame";

  it("accepts the cookie minted from the current password", async () => {
    const cookie = await gateCookieValue(password);
    expect(await isGateCookieValid(cookie, password)).toBe(true);
  });

  it("rejects a missing cookie", async () => {
    expect(await isGateCookieValid(undefined, password)).toBe(false);
    expect(await isGateCookieValid("", password)).toBe(false);
  });

  it("rejects a cookie minted from a different (rotated) password", async () => {
    const stale = await gateCookieValue("old-password");
    expect(await isGateCookieValid(stale, password)).toBe(false);
  });
});

describe("GATE_COOKIE_NAME", () => {
  it("is the stable cookie name shared by middleware and the unlock action", () => {
    expect(GATE_COOKIE_NAME).toBe("auckets_gate");
  });
});
