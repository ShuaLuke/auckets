import { describe, expect, it, vi } from "vitest";

import { ensureStripeCustomer } from "./customers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FakeStripe = any;

function makeStripe(create: (...args: unknown[]) => unknown): FakeStripe {
  return { customers: { create: vi.fn(create) } };
}

describe("ensureStripeCustomer", () => {
  it("returns the existing customer ID without calling Stripe when one is already stored", async () => {
    const stripe = makeStripe(() => {
      throw new Error("should not be called");
    });

    const result = await ensureStripeCustomer(stripe, {
      userId: "user_abc",
      email: "fan@example.com",
      existingCustomerId: "cus_existing",
    });

    expect(result).toEqual({
      ok: true,
      customerId: "cus_existing",
      created: false,
    });
    expect(stripe.customers.create).not.toHaveBeenCalled();
  });

  it("creates a new Customer (with clerk metadata) and flags created=true when none is stored", async () => {
    const stripe = makeStripe(async () => ({ id: "cus_new_123" }));

    const result = await ensureStripeCustomer(stripe, {
      userId: "user_abc",
      email: "fan@example.com",
      existingCustomerId: null,
    });

    expect(result).toEqual({
      ok: true,
      customerId: "cus_new_123",
      created: true,
    });
    const [paramsArg] = stripe.customers.create.mock.calls[0];
    expect(paramsArg.email).toBe("fan@example.com");
    expect(paramsArg.metadata).toEqual({ clerkUserId: "user_abc" });
  });

  it("returns ok:false with code + message when Stripe throws", async () => {
    const stripe = makeStripe(async () => {
      throw { code: "api_key_expired", message: "Expired API key." };
    });

    const result = await ensureStripeCustomer(stripe, {
      userId: "user_abc",
      email: "fan@example.com",
      existingCustomerId: null,
    });

    expect(result).toEqual({
      ok: false,
      code: "api_key_expired",
      message: "Expired API key.",
    });
  });
});
