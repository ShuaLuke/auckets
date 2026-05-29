import Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { verifyAndParseEvent } from "./webhook";

// A real Stripe client (no network calls happen for signature verification —
// constructEvent / generateTestHeaderString are local HMAC operations).
const stripe = new Stripe("sk_test_dummy", { apiVersion: "2026-05-27.dahlia" });
const SECRET = "whsec_test_secret";

function signedPayload(payload: string) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
}

describe("verifyAndParseEvent", () => {
  it("accepts and parses a correctly-signed payload", () => {
    const payload = JSON.stringify({
      id: "evt_123",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_123" } },
    });
    const result = verifyAndParseEvent(
      stripe,
      payload,
      signedPayload(payload),
      SECRET,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.id).toBe("evt_123");
    expect(result.event.type).toBe("payment_intent.succeeded");
  });

  it("rejects a missing signature header", () => {
    const result = verifyAndParseEvent(stripe, "{}", null, SECRET);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/missing/i);
  });

  it("rejects a signature that doesn't match the secret", () => {
    const payload = JSON.stringify({ id: "evt_1", type: "x" });
    // Header signed with a different secret → verification fails.
    const wrong = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "whsec_a_different_secret",
    });
    const result = verifyAndParseEvent(stripe, payload, wrong, SECRET);
    expect(result.ok).toBe(false);
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const payload = JSON.stringify({ id: "evt_1", type: "x" });
    const header = signedPayload(payload);
    const result = verifyAndParseEvent(
      stripe,
      payload + " ",
      header,
      SECRET,
    );
    expect(result.ok).toBe(false);
  });
});
