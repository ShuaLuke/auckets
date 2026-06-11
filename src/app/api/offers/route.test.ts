/** @vitest-environment node */
// Unit tests for POST /api/offers — the real (Stripe-backed) path's
// revision-vs-replay logic. We mock the auth boundary, the db handle, the
// repositories, and the Stripe helpers so these exercise the route's own
// branching:
//
//   - the idempotent-replay guard: a client retry with the same
//     Idempotency-Key makes Stripe replay the SAME PaymentIntent; the
//     route must NOT cancel it (it's the live auth the stored offer
//     points at) and must NOT re-upsert (which would stamp revised_at +
//     write a phantom offer_revisions row).
//   - genuine revisions (different PI ids) still cancel the old auth.
//   - the client-supplied Idempotency-Key is namespaced with the
//     verified userId before it reaches Stripe (account-scoped keys —
//     the raw client value must never be the whole key).
//
// The Stripe helper internals are covered in
// src/lib/stripe/payment-intents.test.ts; the upsert + offer_revisions
// bookkeeping in tests/integration/offers.upsert.integration.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const authMock = vi.fn();
const currentUserMock = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => authMock(),
  currentUser: () => currentUserMock(),
}));

// The route only passes `db` through to the repo functions, which are
// mocked below — an opaque token is enough.
vi.mock("@/lib/db", () => ({ db: {} }));

// Real path only: stub disabled, Stripe client present (the route just
// checks non-null and passes it to the mocked helpers).
vi.mock("@/lib/env", () => ({ env: { ALLOW_DEV_OFFER_STUB: "false" } }));
vi.mock("@/lib/stripe/client", () => ({ stripe: {} }));

const ensureUserMirror = vi.fn();
const getOfferByShowAndUser = vi.fn();
const getShowById = vi.fn();
const setStripeCustomerId = vi.fn();
const upsertOfferForUser = vi.fn();
vi.mock("@/lib/db/repositories", () => ({
  ensureUserMirror: (...args: unknown[]) => ensureUserMirror(...args),
  getOfferByShowAndUser: (...args: unknown[]) => getOfferByShowAndUser(...args),
  getShowById: (...args: unknown[]) => getShowById(...args),
  setStripeCustomerId: (...args: unknown[]) => setStripeCustomerId(...args),
  upsertOfferForUser: (...args: unknown[]) => upsertOfferForUser(...args),
}));

const ensureStripeCustomer = vi.fn();
vi.mock("@/lib/stripe/customers", () => ({
  ensureStripeCustomer: (...args: unknown[]) => ensureStripeCustomer(...args),
}));

const createOfferPaymentIntent = vi.fn();
const cancelOfferPaymentIntent = vi.fn();
// Keep the REAL namespacedStripeIdempotencyKey so the namespacing test
// exercises the actual helper through the route, not a mock of it.
vi.mock("@/lib/stripe/payment-intents", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/stripe/payment-intents")>();
  return {
    ...actual,
    createOfferPaymentIntent: (...args: unknown[]) =>
      createOfferPaymentIntent(...args),
    cancelOfferPaymentIntent: (...args: unknown[]) =>
      cancelOfferPaymentIntent(...args),
  };
});

const notifyOfferReceived = vi.fn();
vi.mock("@/lib/notifications/fan", () => ({
  notifyOfferReceived: (...args: unknown[]) => notifyOfferReceived(...args),
}));

const SHOW_ID = "11111111-1111-1111-1111-111111111111";
const OFFER_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "user_fan_1";

function req(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://test/api/offers", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const validBody = {
  showId: SHOW_ID,
  groupSize: 2,
  pricePerTicketCents: 5_000,
  tierPreference: "any",
  stripePaymentMethodId: "pm_test_card",
};

// An offers row as getOfferByShowAndUser returns it — only the fields
// the route reads.
function existingOffer(overrides: Record<string, unknown> = {}) {
  return {
    id: OFFER_ID,
    showId: SHOW_ID,
    userId: USER_ID,
    stripePaymentIntentId: "pi_A",
    revisedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ userId: USER_ID });
  currentUserMock.mockResolvedValue({
    primaryEmailAddress: { emailAddress: "fan@example.com" },
  });
  ensureUserMirror.mockResolvedValue({
    id: USER_ID,
    email: "fan@example.com",
    stripeCustomerId: "cus_1",
  });
  getShowById.mockResolvedValue({
    id: SHOW_ID,
    status: "open",
    doorsAt: new Date("2026-07-01T00:00:00Z"),
    artist: { name: "Citizen Cope" },
    venue: { name: "The Anthem" },
  });
  getOfferByShowAndUser.mockResolvedValue(null);
  ensureStripeCustomer.mockResolvedValue({
    ok: true,
    customerId: "cus_1",
    created: false,
  });
  createOfferPaymentIntent.mockResolvedValue({
    ok: true,
    paymentIntentId: "pi_A",
    status: "requires_capture",
  });
  cancelOfferPaymentIntent.mockResolvedValue({ ok: true });
  upsertOfferForUser.mockResolvedValue({
    offer: { id: OFFER_ID, showId: SHOW_ID },
    isRevision: false,
  });
  notifyOfferReceived.mockResolvedValue(undefined);
});

describe("POST /api/offers — idempotent replay guard", () => {
  it("does NOT cancel the stored PaymentIntent when a retry replays the same PI (the self-cancel bug)", async () => {
    // First submission stored pi_A; the response was lost; the client
    // retried with the same Idempotency-Key, so Stripe replayed pi_A.
    getOfferByShowAndUser.mockResolvedValue(existingOffer());
    createOfferPaymentIntent.mockResolvedValue({
      ok: true,
      paymentIntentId: "pi_A",
      status: "requires_capture",
    });

    const res = await POST(req(validBody, { "Idempotency-Key": "retry-1" }));

    expect(cancelOfferPaymentIntent).not.toHaveBeenCalled();
    // Replays the original first-submission response.
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      ok: true,
      offerId: OFFER_ID,
      isRevision: false,
      showId: SHOW_ID,
      path: "real",
    });
  });

  it("does NOT re-upsert on replay (no phantom revision row / revised_at stamp)", async () => {
    getOfferByShowAndUser.mockResolvedValue(existingOffer());

    await POST(req(validBody, { "Idempotency-Key": "retry-1" }));

    expect(upsertOfferForUser).not.toHaveBeenCalled();
    // The original request already sent the confirmation email.
    expect(notifyOfferReceived).not.toHaveBeenCalled();
  });

  it("replays a revision's response (200, isRevision=true) when the replayed offer had been revised", async () => {
    getOfferByShowAndUser.mockResolvedValue(
      existingOffer({ revisedAt: new Date("2026-06-10T00:00:00Z") }),
    );

    const res = await POST(req(validBody, { "Idempotency-Key": "retry-2" }));

    expect(cancelOfferPaymentIntent).not.toHaveBeenCalled();
    expect(upsertOfferForUser).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, isRevision: true });
  });
});

describe("POST /api/offers — genuine revision", () => {
  it("still cancels the OLD PaymentIntent when the new PI differs", async () => {
    getOfferByShowAndUser.mockResolvedValue(
      existingOffer({ stripePaymentIntentId: "pi_OLD" }),
    );
    createOfferPaymentIntent.mockResolvedValue({
      ok: true,
      paymentIntentId: "pi_NEW",
      status: "requires_capture",
    });
    upsertOfferForUser.mockResolvedValue({
      offer: { id: OFFER_ID, showId: SHOW_ID },
      isRevision: true,
    });

    const res = await POST(req(validBody, { "Idempotency-Key": "revise-1" }));

    expect(cancelOfferPaymentIntent).toHaveBeenCalledTimes(1);
    expect(cancelOfferPaymentIntent.mock.calls[0]?.[1]).toBe("pi_OLD");
    // The upsert stores the NEW PaymentIntent.
    expect(upsertOfferForUser.mock.calls[0]?.[1]).toMatchObject({
      stripePaymentIntentId: "pi_NEW",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, isRevision: true });
  });

  it("first submission (no existing offer): no cancel, upsert stores the new PI", async () => {
    const res = await POST(req(validBody));

    expect(cancelOfferPaymentIntent).not.toHaveBeenCalled();
    expect(upsertOfferForUser).toHaveBeenCalledTimes(1);
    expect(upsertOfferForUser.mock.calls[0]?.[1]).toMatchObject({
      stripePaymentIntentId: "pi_A",
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/offers — Idempotency-Key namespacing", () => {
  it("prefixes the client key with the verified userId before it reaches Stripe", async () => {
    await POST(req(validBody, { "Idempotency-Key": "client-key-1" }));

    expect(createOfferPaymentIntent).toHaveBeenCalledTimes(1);
    expect(createOfferPaymentIntent.mock.calls[0]?.[1]).toMatchObject({
      idempotencyKey: `${USER_ID}:client-key-1`,
    });
  });

  it("omits the idempotency key entirely when the header is absent", async () => {
    await POST(req(validBody));

    expect(createOfferPaymentIntent).toHaveBeenCalledTimes(1);
    expect(createOfferPaymentIntent.mock.calls[0]?.[1]).not.toHaveProperty(
      "idempotencyKey",
    );
  });
});
