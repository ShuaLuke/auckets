// Integration coverage for upsertOfferForUser — the only write helper that
// touches the offers table from the repository layer.
//
// What the mock-DB unit tests cannot verify, and this file does:
//   - The (show_id, user_id) unique constraint actually fires onConflict
//   - The follow-on offer_revisions insert is atomic with the offer write
//     (transaction rollback on failure leaves offers untouched)
//   - The generated rank_key column reflects the formula
//     (price_per_ticket_cents::bigint * 1000 + group_size)
//   - The revisedAt: sql`NOW()` set actually evaluates to a real timestamp

import { desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  upsertOfferForUser,
  listOfferRevisionsForOffer,
} from "@/lib/db/repositories/offers";
import { offerRevisions, offers } from "../../drizzle/schema";

import {
  STUB_PAYMENT_METHOD_ID,
  STUB_SETUP_INTENT_ID,
  seedShow,
  seedUser,
} from "./helpers";

describe("upsertOfferForUser (integration)", () => {
  it("first call inserts a fresh offer, returns isRevision=false, and writes one revision row", async () => {
    const user = await seedUser();
    const { show } = await seedShow();

    const result = await upsertOfferForUser(db, {
      showId: show.id,
      userId: user.id,
      groupSize: 4,
      pricePerTicketCents: 4200,
      tierPreference: "any",
      stripePaymentMethodId: STUB_PAYMENT_METHOD_ID,
      stripeSetupIntentId: STUB_SETUP_INTENT_ID,
    });

    expect(result.isRevision).toBe(false);
    expect(result.offer.revisedAt).toBeNull();
    expect(result.offer.groupSize).toBe(4);
    expect(result.offer.pricePerTicketCents).toBe(4200);
    // rank_key is a STORED generated column — proves the formula evaluated.
    expect(result.offer.rankKey).toBe(BigInt(4200 * 1000 + 4));

    const revisions = await listOfferRevisionsForOffer(db, result.offer.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.snapshot).toMatchObject({
      groupSize: 4,
      pricePerTicketCents: 4200,
    });
  });

  it("second call on the same (showId, userId) updates the row, returns isRevision=true, and appends a second revision row", async () => {
    const user = await seedUser();
    const { show } = await seedShow();

    const first = await upsertOfferForUser(db, {
      showId: show.id,
      userId: user.id,
      groupSize: 2,
      pricePerTicketCents: 3000,
      tierPreference: "any",
      stripePaymentMethodId: STUB_PAYMENT_METHOD_ID,
      stripeSetupIntentId: STUB_SETUP_INTENT_ID,
    });

    const second = await upsertOfferForUser(db, {
      showId: show.id,
      userId: user.id,
      groupSize: 4,
      pricePerTicketCents: 4200,
      tierPreference: "any",
      stripePaymentMethodId: STUB_PAYMENT_METHOD_ID,
      stripeSetupIntentId: STUB_SETUP_INTENT_ID,
    });

    // Same row, not a new one — onConflictDoUpdate fired on the unique
    // constraint, didn't insert a duplicate.
    expect(second.offer.id).toBe(first.offer.id);
    expect(second.isRevision).toBe(true);
    expect(second.offer.revisedAt).toBeInstanceOf(Date);
    expect(second.offer.groupSize).toBe(4);
    expect(second.offer.pricePerTicketCents).toBe(4200);
    expect(second.offer.rankKey).toBe(BigInt(4200 * 1000 + 4));

    const revisions = await listOfferRevisionsForOffer(db, first.offer.id);
    expect(revisions).toHaveLength(2);
    // listOfferRevisionsForOffer returns ASC-by-recorded_at, so the second
    // snapshot is the newer (post-update) state.
    expect(revisions[1]?.snapshot).toMatchObject({
      groupSize: 4,
      pricePerTicketCents: 4200,
    });

    // And of course only one offers row exists for this (show, user).
    const allForUser = await db
      .select()
      .from(offers)
      .where(eq(offers.userId, user.id));
    expect(allForUser).toHaveLength(1);
  });

  it("rolls the offer update back when the transaction throws — both the offer change AND the revisions write are atomic", async () => {
    const user = await seedUser();
    const { show } = await seedShow();

    // Establish a baseline offer + revision.
    const baseline = await upsertOfferForUser(db, {
      showId: show.id,
      userId: user.id,
      groupSize: 2,
      pricePerTicketCents: 3000,
      tierPreference: "any",
      stripePaymentMethodId: STUB_PAYMENT_METHOD_ID,
      stripeSetupIntentId: STUB_SETUP_INTENT_ID,
    });

    // Trigger a real constraint violation inside the transaction by
    // submitting groupSize=0, which fails the
    // offers_group_size_check (BETWEEN 1 AND 10). The repository function
    // wraps the insert + the revisions write in db.transaction(), so the
    // throw should rollback BOTH — leaving the offer at its baseline and
    // the revisions table with exactly the baseline insert.
    await expect(
      upsertOfferForUser(db, {
        showId: show.id,
        userId: user.id,
        groupSize: 0,
        pricePerTicketCents: 9999,
        tierPreference: "any",
        stripePaymentMethodId: STUB_PAYMENT_METHOD_ID,
        stripeSetupIntentId: STUB_SETUP_INTENT_ID,
      }),
    ).rejects.toThrow();

    // Offer is back to the baseline values; no rogue update slipped through.
    const after = await db
      .select()
      .from(offers)
      .where(eq(offers.id, baseline.offer.id));
    expect(after[0]?.groupSize).toBe(2);
    expect(after[0]?.pricePerTicketCents).toBe(3000);

    // Revisions table also untouched — still just the baseline insert.
    const revisions = await db
      .select()
      .from(offerRevisions)
      .where(eq(offerRevisions.offerId, baseline.offer.id))
      .orderBy(desc(offerRevisions.recordedAt));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.snapshot).toMatchObject({
      groupSize: 2,
      pricePerTicketCents: 3000,
    });
  });

  it("updates the Stripe PaymentIntent id on revision (regression: revised offers kept the original auth and failed to capture at binding)", async () => {
    const user = await seedUser();
    const { show } = await seedShow();

    // First submission — real path shape: a PaymentIntent, no SetupIntent.
    const first = await upsertOfferForUser(db, {
      showId: show.id,
      userId: user.id,
      groupSize: 4,
      pricePerTicketCents: 5000, // $200 authorization
      tierPreference: "any",
      stripePaymentMethodId: "pm_first",
      stripePaymentIntentId: "pi_first_auth",
    });
    expect(first.offer.stripePaymentIntentId).toBe("pi_first_auth");

    // Revision raises the amount and carries a FRESH PaymentIntent.
    const second = await upsertOfferForUser(db, {
      showId: show.id,
      userId: user.id,
      groupSize: 5,
      pricePerTicketCents: 7000, // $350 authorization
      tierPreference: "any",
      stripePaymentMethodId: "pm_second",
      stripePaymentIntentId: "pi_second_auth",
    });

    // Same row (onConflict fired), and — the regression — the offer now
    // points at the NEW auth. The bug left this at "pi_first_auth", so
    // binding tried to capture $350 against the old $200 hold and failed.
    expect(second.offer.id).toBe(first.offer.id);
    expect(second.offer.stripePaymentIntentId).toBe("pi_second_auth");
    expect(second.offer.stripePaymentMethodId).toBe("pm_second");
    expect(second.offer.stripeSetupIntentId).toBeNull();

    // History records the auth that backed the latest version.
    const revisions = await listOfferRevisionsForOffer(db, first.offer.id);
    expect(revisions).toHaveLength(2);
    expect(revisions[1]?.snapshot).toMatchObject({
      stripePaymentIntentId: "pi_second_auth",
    });
  });

  it("clears the prior SetupIntent when a stub offer is revised onto the real (PaymentIntent) path", async () => {
    const user = await seedUser();
    const { show } = await seedShow();

    // Stub-path first submission: SetupIntent slot filled, no PaymentIntent.
    await upsertOfferForUser(db, {
      showId: show.id,
      userId: user.id,
      groupSize: 2,
      pricePerTicketCents: 3000,
      tierPreference: "any",
      stripePaymentMethodId: STUB_PAYMENT_METHOD_ID,
      stripeSetupIntentId: STUB_SETUP_INTENT_ID,
    });

    // Real-path revision: PaymentIntent set, SetupIntent intentionally absent.
    const revised = await upsertOfferForUser(db, {
      showId: show.id,
      userId: user.id,
      groupSize: 3,
      pricePerTicketCents: 4000,
      tierPreference: "any",
      stripePaymentMethodId: "pm_real",
      stripePaymentIntentId: "pi_real_auth",
    });

    // SetupIntent reset to null (no longer the active auth) and the
    // PaymentIntent now set. The write didn't throw, so the row still
    // satisfies offers_stripe_intent_check (>= 1 intent column non-null).
    expect(revised.offer.stripeSetupIntentId).toBeNull();
    expect(revised.offer.stripePaymentIntentId).toBe("pi_real_auth");
  });
});
