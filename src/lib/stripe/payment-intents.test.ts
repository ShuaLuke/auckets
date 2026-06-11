// Unit tests for createOfferPaymentIntent. The helper is a thin wrapper
// around stripe.paymentIntents.create — tests verify the parameter shape
// we send to Stripe (capture_method, confirm, etc.) and the result
// mapping for the happy + error paths.
//
// Stripe SDK is mocked at the parameter boundary: the helper takes the
// Stripe client as a parameter, so tests pass a hand-rolled stub
// rather than vi.mock'ing the whole SDK. Cleaner contract.

import { describe, expect, it, vi } from "vitest";

import {
  cancelOfferPaymentIntent,
  captureOfferPaymentIntent,
  createOfferPaymentIntent,
  namespacedStripeIdempotencyKey,
} from "./payment-intents";

// Minimal Stripe shape — only the methods the helper actually calls.
// Typed as `any` because building a full Stripe type by hand here would
// be pointless ceremony; the helper itself is typed against the real
// Stripe namespace.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FakeStripe = any;

function makeStripe(behavior: {
  create: (...args: unknown[]) => Promise<unknown> | unknown;
}): FakeStripe {
  return {
    paymentIntents: { create: vi.fn(behavior.create) },
  };
}

describe("createOfferPaymentIntent", () => {
  it("returns ok with the PI id + status when Stripe returns requires_capture (happy path)", async () => {
    const stripe = makeStripe({
      create: async () => ({
        id: "pi_test_123",
        status: "requires_capture",
      }),
    });

    const result = await createOfferPaymentIntent(stripe, {
      paymentMethodId: "pm_test_card",
      amountCents: 16_800,
    });

    expect(result).toEqual({
      ok: true,
      paymentIntentId: "pi_test_123",
      status: "requires_capture",
    });
  });

  it("sends capture_method=manual + confirm=true to Stripe (the whole point of this helper)", async () => {
    const stripe = makeStripe({
      create: async () => ({ id: "pi_x", status: "requires_capture" }),
    });

    await createOfferPaymentIntent(stripe, {
      paymentMethodId: "pm_test",
      amountCents: 4_200 * 4, // $42 × 4
    });

    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);
    const [paramsArg] = stripe.paymentIntents.create.mock.calls[0];
    expect(paramsArg.capture_method).toBe("manual");
    expect(paramsArg.confirm).toBe(true);
    expect(paramsArg.amount).toBe(16_800);
    expect(paramsArg.currency).toBe("usd");
    expect(paramsArg.payment_method).toBe("pm_test");
  });

  it("forwards idempotencyKey to Stripe as a request option (retry safety)", async () => {
    const stripe = makeStripe({
      create: async () => ({ id: "pi_y", status: "requires_capture" }),
    });

    await createOfferPaymentIntent(stripe, {
      paymentMethodId: "pm_test",
      amountCents: 1000,
      idempotencyKey: "offer-user_abc-show_xyz-attempt-1",
    });

    const [, optsArg] = stripe.paymentIntents.create.mock.calls[0];
    expect(optsArg?.idempotencyKey).toBe("offer-user_abc-show_xyz-attempt-1");
  });

  it("omits the idempotency option entirely when no key is provided", async () => {
    const stripe = makeStripe({
      create: async () => ({ id: "pi_z", status: "requires_capture" }),
    });

    await createOfferPaymentIntent(stripe, {
      paymentMethodId: "pm_test",
      amountCents: 1000,
    });

    const [, optsArg] = stripe.paymentIntents.create.mock.calls[0];
    expect(optsArg).toBeUndefined();
  });

  it("attaches metadata to the PaymentIntent when provided", async () => {
    const stripe = makeStripe({
      create: async () => ({ id: "pi_m", status: "requires_capture" }),
    });

    await createOfferPaymentIntent(stripe, {
      paymentMethodId: "pm_test",
      amountCents: 1000,
      metadata: { showId: "show_abc", offerId: "offer_xyz" },
    });

    const [paramsArg] = stripe.paymentIntents.create.mock.calls[0];
    expect(paramsArg.metadata).toEqual({
      showId: "show_abc",
      offerId: "offer_xyz",
    });
  });

  it("passes customer to Stripe when customerId is provided (slice 20)", async () => {
    const stripe = makeStripe({
      create: async () => ({ id: "pi_c", status: "requires_capture" }),
    });

    await createOfferPaymentIntent(stripe, {
      paymentMethodId: "pm_test",
      amountCents: 1000,
      customerId: "cus_abc",
    });

    const [paramsArg] = stripe.paymentIntents.create.mock.calls[0];
    expect(paramsArg.customer).toBe("cus_abc");
  });

  it("omits customer entirely when no customerId is given (back-compat)", async () => {
    const stripe = makeStripe({
      create: async () => ({ id: "pi_nc", status: "requires_capture" }),
    });

    await createOfferPaymentIntent(stripe, {
      paymentMethodId: "pm_test",
      amountCents: 1000,
    });

    const [paramsArg] = stripe.paymentIntents.create.mock.calls[0];
    expect(paramsArg.customer).toBeUndefined();
  });

  it("returns ok with the actual status when Stripe returns requires_action (3DS challenge)", async () => {
    // 3DS path — caller needs to surface "additional authentication
    // required" to the fan. Helper doesn't decide policy, it reports.
    const stripe = makeStripe({
      create: async () => ({ id: "pi_3ds", status: "requires_action" }),
    });

    const result = await createOfferPaymentIntent(stripe, {
      paymentMethodId: "pm_test",
      amountCents: 1000,
    });

    expect(result).toEqual({
      ok: true,
      paymentIntentId: "pi_3ds",
      status: "requires_action",
    });
  });

  it("returns ok:false with code + message when Stripe throws a card_declined error", async () => {
    const stripe = makeStripe({
      create: async () => {
        throw {
          code: "card_declined",
          message: "Your card was declined.",
          type: "StripeCardError",
        };
      },
    });

    const result = await createOfferPaymentIntent(stripe, {
      paymentMethodId: "pm_test",
      amountCents: 1000,
    });

    expect(result).toEqual({
      ok: false,
      code: "card_declined",
      message: "Your card was declined.",
    });
  });

  it("maps non-Stripe errors (e.g. network) into a generic 'internal' code", async () => {
    const stripe = makeStripe({
      create: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    const result = await createOfferPaymentIntent(stripe, {
      paymentMethodId: "pm_test",
      amountCents: 1000,
    });

    expect(result).toEqual({
      ok: false,
      code: "internal",
      message: "ECONNREFUSED",
    });
  });
});

function makeCancelStripe(
  cancel: (...args: unknown[]) => unknown,
): FakeStripe {
  return { paymentIntents: { cancel: vi.fn(cancel) } };
}

describe("cancelOfferPaymentIntent", () => {
  it("returns ok when Stripe cancels the PaymentIntent cleanly", async () => {
    const stripe = makeCancelStripe(async () => ({
      id: "pi_x",
      status: "canceled",
    }));
    const result = await cancelOfferPaymentIntent(stripe, "pi_x");
    expect(result).toEqual({ ok: true });
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith("pi_x");
  });

  it("treats payment_intent_unexpected_state as a soft success (already canceled/captured)", async () => {
    // The old auth was already gone — the revision's goal (no live auth
    // on the old PI) is already met, so we don't fail the revision.
    const stripe = makeCancelStripe(async () => {
      throw {
        code: "payment_intent_unexpected_state",
        message: "PI already canceled.",
      };
    });
    const result = await cancelOfferPaymentIntent(stripe, "pi_old");
    expect(result).toEqual({ ok: true });
  });

  it("returns ok:false for a genuine Stripe error (not the terminal-state case)", async () => {
    const stripe = makeCancelStripe(async () => {
      throw { code: "rate_limit", message: "Too many requests." };
    });
    const result = await cancelOfferPaymentIntent(stripe, "pi_old");
    expect(result).toEqual({
      ok: false,
      code: "rate_limit",
      message: "Too many requests.",
    });
  });
});

function makeCaptureStripe(
  capture: (...args: unknown[]) => unknown,
): FakeStripe {
  return { paymentIntents: { capture: vi.fn(capture) } };
}

describe("captureOfferPaymentIntent", () => {
  it("returns ok when Stripe captures the auth cleanly (placed offer charged)", async () => {
    const stripe = makeCaptureStripe(async () => ({
      id: "pi_x",
      status: "succeeded",
    }));
    const result = await captureOfferPaymentIntent(stripe, "pi_x");
    expect(result).toEqual({ ok: true });
  });

  it("passes amount_to_capture when an amount is provided (full authorized amount)", async () => {
    const stripe = makeCaptureStripe(async () => ({
      id: "pi_x",
      status: "succeeded",
    }));
    await captureOfferPaymentIntent(stripe, "pi_x", 16_800);
    const [idArg, optsArg] = stripe.paymentIntents.capture.mock.calls[0];
    expect(idArg).toBe("pi_x");
    expect(optsArg).toEqual({ amount_to_capture: 16_800 });
  });

  it("omits the options object when no amount is provided (capture full auth)", async () => {
    const stripe = makeCaptureStripe(async () => ({
      id: "pi_x",
      status: "succeeded",
    }));
    await captureOfferPaymentIntent(stripe, "pi_x");
    const [, optsArg] = stripe.paymentIntents.capture.mock.calls[0];
    expect(optsArg).toBeUndefined();
  });

  it("returns ok:false on payment_intent_unexpected_state — NOT a soft success (auth is dead → card_failure)", async () => {
    // Unlike cancel, capture must surface this: the auth is no longer
    // capturable, so the offer cannot be charged. Treating it as success
    // would mark the offer 'charged' with no funds collected.
    const stripe = makeCaptureStripe(async () => {
      throw {
        code: "payment_intent_unexpected_state",
        message: "PI cannot be captured.",
      };
    });
    const result = await captureOfferPaymentIntent(stripe, "pi_dead");
    expect(result).toEqual({
      ok: false,
      code: "payment_intent_unexpected_state",
      message: "PI cannot be captured.",
    });
  });

  it("maps non-Stripe errors (e.g. network) into a generic 'internal' code", async () => {
    const stripe = makeCaptureStripe(async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await captureOfferPaymentIntent(stripe, "pi_x");
    expect(result).toEqual({ ok: false, code: "internal", message: "ECONNREFUSED" });
  });
});

describe("namespacedStripeIdempotencyKey", () => {
  it("prefixes the client key with the verified userId (per-user namespace)", () => {
    expect(namespacedStripeIdempotencyKey("user_abc", "retry-1")).toBe(
      "user_abc:retry-1",
    );
  });

  it("caps the combined key at Stripe's 255-char limit", () => {
    const key = namespacedStripeIdempotencyKey("user_abc", "x".repeat(500));
    expect(key).toHaveLength(255);
    expect(key?.startsWith("user_abc:")).toBe(true);
  });

  it("returns undefined when the client sent no key (header absent)", () => {
    expect(namespacedStripeIdempotencyKey("user_abc", null)).toBeUndefined();
  });

  it("returns undefined for an empty header value", () => {
    expect(namespacedStripeIdempotencyKey("user_abc", "")).toBeUndefined();
  });
});
