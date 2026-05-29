// Integration coverage for card-failure recovery (ADR-0003 §5) against a real
// Postgres with a fake Stripe: the recoverCardFailure orchestration (fan
// submits a new card → charge → resolve) and the expireCardFailures sweep
// (release seats whose 4h window lapsed).

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { db } from "@/lib/db";
import {
  expireCardFailures,
  recoverCardFailure,
} from "@/lib/stripe/card-failure-recovery";
import { offers, seatAssignments, users } from "../../drizzle/schema";

import { seedShow, seedUser, seedVenue, seedVenueArchitecture } from "./helpers";

const WINDOW_MIN = 240; // 4h
const MIN = 60 * 1000;

// Captures the amount immediately; existing customer means customers.create
// is never reached.
const fakeStripe = {
  paymentIntents: {
    create: async (params: { amount: number }) => ({
      id: "pi_new_" + Math.random().toString(36).slice(2, 10),
      status: "succeeded",
      amount_received: params.amount,
    }),
  },
} as unknown as Stripe;

const ROW = [
  {
    id: "row_a",
    area: "orchestra",
    section: "main",
    rowName: "A",
    rowRank: 1,
    capacity: 4,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: ["1", "2", "3", "4"],
    holds: [],
    tier: "premium",
    isGa: false,
  },
];

async function seedShowRow() {
  const venue = await seedVenue();
  const arch = await seedVenueArchitecture(venue.id, { rows: ROW });
  const { show } = await seedShow({
    venueId: venue.id,
    venueArchitectureId: arch.id,
  });
  return show;
}

// A card_failure offer with a held binding seat stamped `failedMinutesAgo`.
async function seedCardFailure(
  showId: string,
  opts: { failedMinutesAgo: number; status?: string },
) {
  const user = await seedUser();
  await db
    .update(users)
    .set({ stripeCustomerId: "cus_existing" })
    .where(eq(users.id, user.id));

  const [offer] = await db
    .insert(offers)
    .values({
      showId,
      userId: user.id,
      groupSize: 2,
      pricePerTicketCents: 6000,
      tierPreference: "any",
      stripePaymentMethodId: "pm_old",
      stripePaymentIntentId: "pi_old",
      status: opts.status ?? "card_failure",
    })
    .returning();
  if (!offer) throw new Error("seedCardFailure: no offer");

  await db.insert(seatAssignments).values({
    offerId: offer.id,
    showId,
    venueRowId: "row_a",
    seatNumbers: ["1", "2"],
    tier: "premium",
    isBinding: true,
    stripePaymentIntentId: "pi_old",
    cardFailureAt: new Date(Date.now() - opts.failedMinutesAgo * MIN),
  });

  return { offer, userId: offer.userId };
}

describe("recoverCardFailure (integration)", () => {
  it("charges the new card and resolves the offer to charged", async () => {
    const show = await seedShowRow();
    const { offer, userId } = await seedCardFailure(show.id, {
      failedMinutesAgo: 10,
    });

    const outcome = await recoverCardFailure(db, fakeStripe, {
      offerId: offer.id,
      userId,
      paymentMethodId: "pm_new",
      windowMinutes: WINDOW_MIN,
      now: new Date(),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.amountChargedCents).toBe(12000); // 2 × $60

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("charged");
    expect(row?.stripePaymentIntentId).toMatch(/^pi_new_/);
    const [assign] = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offer.id));
    expect(assign?.chargedAmountCents).toBe(12000);
    expect(assign?.cardFailureAt).toBeNull();
  });

  it("refuses recovery after the window has expired", async () => {
    const show = await seedShowRow();
    const { offer, userId } = await seedCardFailure(show.id, {
      failedMinutesAgo: WINDOW_MIN + 10,
    });

    const outcome = await recoverCardFailure(db, fakeStripe, {
      offerId: offer.id,
      userId,
      paymentMethodId: "pm_new",
      windowMinutes: WINDOW_MIN,
      now: new Date(),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("window_expired");
    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("card_failure"); // untouched
  });

  it("refuses recovery of another fan's offer", async () => {
    const show = await seedShowRow();
    const { offer } = await seedCardFailure(show.id, { failedMinutesAgo: 5 });

    const outcome = await recoverCardFailure(db, fakeStripe, {
      offerId: offer.id,
      userId: "user_someone_else",
      paymentMethodId: "pm_new",
      windowMinutes: WINDOW_MIN,
      now: new Date(),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("forbidden");
  });

  it("refuses recovery of an offer that isn't in card_failure", async () => {
    const show = await seedShowRow();
    const { offer, userId } = await seedCardFailure(show.id, {
      failedMinutesAgo: 5,
      status: "charged",
    });

    const outcome = await recoverCardFailure(db, fakeStripe, {
      offerId: offer.id,
      userId,
      paymentMethodId: "pm_new",
      windowMinutes: WINDOW_MIN,
      now: new Date(),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("not_recoverable");
  });
});

describe("expireCardFailures (integration)", () => {
  it("releases seats past the window and leaves in-window ones alone", async () => {
    const show = await seedShowRow();
    const expired = await seedCardFailure(show.id, {
      failedMinutesAgo: WINDOW_MIN + 30,
    });
    const inWindow = await seedCardFailure(show.id, { failedMinutesAgo: 30 });

    const result = await expireCardFailures(db, new Date(), WINDOW_MIN);
    expect(result.expired).toBe(1);
    expect(result.offerIds).toEqual([expired.offer.id]);

    // Expired: offer unplaced, seat released.
    const [expiredRow] = await db
      .select()
      .from(offers)
      .where(eq(offers.id, expired.offer.id));
    expect(expiredRow?.status).toBe("unplaced");
    const expiredSeat = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, expired.offer.id));
    expect(expiredSeat).toHaveLength(0);

    // In-window: untouched.
    const [keptRow] = await db
      .select()
      .from(offers)
      .where(eq(offers.id, inWindow.offer.id));
    expect(keptRow?.status).toBe("card_failure");
    const keptSeat = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, inWindow.offer.id));
    expect(keptSeat).toHaveLength(1);
  });
});
