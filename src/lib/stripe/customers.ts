// Stripe Customer helper. Each fan gets one Stripe Customer, created
// lazily on their first real-path offer and persisted to
// users.stripe_customer_id. Associating PaymentIntents with a Customer
// keeps the Stripe dashboard organized (all of a fan's payments under
// one Customer) and sets up the later "saved card" optimization where
// a revision reuses the attached PaymentMethod instead of re-collecting.
//
// This module is pure Stripe + the returned ID; persistence to the
// users row is the caller's job (route layer) so this stays testable
// without a DB.

import type Stripe from "stripe";

import { logger } from "@/lib/logger";

export type EnsureStripeCustomerResult =
  | { ok: true; customerId: string; created: boolean }
  | { ok: false; code: string; message: string };

// Returns the fan's Stripe Customer ID. When existingCustomerId is set
// (read from users.stripe_customer_id), returns it without a Stripe
// call. Otherwise creates a new Customer and returns its ID with
// created=true so the caller knows to persist it.
export async function ensureStripeCustomer(
  stripe: Stripe,
  params: {
    userId: string;
    email: string;
    existingCustomerId: string | null;
  },
): Promise<EnsureStripeCustomerResult> {
  if (params.existingCustomerId) {
    return { ok: true, customerId: params.existingCustomerId, created: false };
  }

  try {
    const customer = await stripe.customers.create({
      email: params.email,
      // metadata.clerkUserId lets ops map a Stripe Customer back to a
      // Clerk/local user from the dashboard.
      metadata: { clerkUserId: params.userId },
    });
    return { ok: true, customerId: customer.id, created: true };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      const stripeErr = err as { code?: string; message?: string };
      logger.error(
        { code: stripeErr.code, message: stripeErr.message, userId: params.userId },
        "Stripe customers.create failed",
      );
      return {
        ok: false,
        code: stripeErr.code ?? "stripe_error",
        message: stripeErr.message ?? "Unknown Stripe error",
      };
    }
    logger.error({ err, userId: params.userId }, "Non-Stripe error creating customer");
    return {
      ok: false,
      code: "internal",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
