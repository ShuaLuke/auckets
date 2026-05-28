// Unit tests for createOfferPaymentIntent. The helper is a thin wrapper
// around stripe.paymentIntents.create — tests verify the parameter shape
// we send to Stripe (capture_method, confirm, etc.) and the result
// mapping for the happy + error paths.
//
// Stripe SDK is mocked at the parameter boundary: the helper takes the
// Stripe client as a parameter, so tests pass a hand-rolled stub
// rather than vi.mock'ing the whole SDK. Cleaner contract.

import { describe, expect, it, vi } from "vitest";

import { createOfferPaymentIntent } from "./payment-intents";

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
