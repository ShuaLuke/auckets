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
  releaseExpiredCardFailure,
  STALE_RECOVERING_MINUTES,
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

// A counting, optionally slow / failing fake — for the concurrency tests,
// where what matters is exactly how many real charges Stripe would have seen.
function countingStripe(opts: { delayMs?: number; failFirst?: boolean } = {}) {
  let charges = 0;
  let failed = false;
  const stripe = {
    paymentIntents: {
      create: async (params: { amount: number }) => {
        charges += 1;
        if (opts.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
        }
        if (opts.failFirst && !failed) {
          failed = true;
          const err = Object.assign(new Error("Your card was declined."), {
            code: "card_declined",
          });
          throw err;
        }
        return {
          id: "pi_new_" + Math.random().toString(36).slice(2, 10),
          status: "succeeded",
          amount_received: params.amount,
        };
      },
    },
  } as unknown as Stripe;
  return { stripe, chargeCount: () => charges };
}

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

  it("never reaches Stripe when another recovery already holds the claim", async () => {
    const show = await seedShowRow();
    const { offer, userId } = await seedCardFailure(show.id, {
      failedMinutesAgo: 5,
      status: "recovering",
    });
    const { stripe, chargeCount } = countingStripe();

    const outcome = await recoverCardFailure(db, stripe, {
      offerId: offer.id,
      userId,
      paymentMethodId: "pm_new",
      windowMinutes: WINDOW_MIN,
      now: new Date(),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.kind).toBe("not_recoverable");
    expect(chargeCount()).toBe(0);
  });

  it("two concurrent recoveries charge the fan exactly once (the double-click race)", async () => {
    const show = await seedShowRow();
    const { offer, userId } = await seedCardFailure(show.id, {
      failedMinutesAgo: 5,
    });
    // Slow Stripe: both requests pass the advisory status read before either
    // writes — exactly the pre-fix double-charge interleaving. The atomic
    // claim must let only one of them through to the charge.
    const { stripe, chargeCount } = countingStripe({ delayMs: 100 });

    const run = () =>
      recoverCardFailure(db, stripe, {
        offerId: offer.id,
        userId,
        paymentMethodId: "pm_new",
        windowMinutes: WINDOW_MIN,
        now: new Date(),
      });
    const [a, b] = await Promise.all([run(), run()]);

    const succeeded = [a, b].filter((o) => o.ok);
    const lost = [a, b].filter((o) => !o.ok);
    expect(succeeded).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const loser = lost[0]!;
    if (!loser.ok) expect(loser.error.kind).toBe("not_recoverable");
    expect(chargeCount()).toBe(1); // ONE real charge, not two

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("charged");
    expect(row?.recoveringAt).toBeNull();
  });

  it("reverts the claim on a failed charge so the fan can retry", async () => {
    const show = await seedShowRow();
    const { offer, userId } = await seedCardFailure(show.id, {
      failedMinutesAgo: 5,
    });
    const { stripe, chargeCount } = countingStripe({ failFirst: true });

    const params = {
      offerId: offer.id,
      userId,
      paymentMethodId: "pm_new",
      windowMinutes: WINDOW_MIN,
      now: new Date(),
    };

    const first = await recoverCardFailure(db, stripe, params);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error.kind).toBe("charge_failed");

    // The claim was handed back — not stuck in 'recovering'.
    const [afterFail] = await db
      .select()
      .from(offers)
      .where(eq(offers.id, offer.id));
    expect(afterFail?.status).toBe("card_failure");
    expect(afterFail?.recoveringAt).toBeNull();

    // Second card works: the retry claims again and resolves.
    const second = await recoverCardFailure(db, stripe, params);
    expect(second.ok).toBe(true);
    expect(chargeCount()).toBe(2);
    const [afterRetry] = await db
      .select()
      .from(offers)
      .where(eq(offers.id, offer.id));
    expect(afterRetry?.status).toBe("charged");
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

  it("does not clobber an offer that got charged after the work list was read", async () => {
    // The race: the cron reads its work list, a recovery (or the succeeded
    // webhook backstop) resolves the offer to 'charged', THEN the cron's
    // per-offer release runs. Pre-fix this overwrote 'charged' with
    // 'unplaced' and deleted the paid seat. The release is status-guarded —
    // exercise the guard directly at the post-list interleaving point.
    const show = await seedShowRow();
    const { offer } = await seedCardFailure(show.id, {
      failedMinutesAgo: WINDOW_MIN + 30,
    });
    const [seat] = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offer.id));
    if (!seat) throw new Error("no seat seeded");

    // The recovery wins the race after the (hypothetical) work-list read.
    await db
      .update(offers)
      .set({ status: "charged", stripePaymentIntentId: "pi_recovered" })
      .where(eq(offers.id, offer.id));

    const released = await releaseExpiredCardFailure(db, offer.id, seat.id);
    expect(released).toBe(false);

    // Charged fan keeps their status AND their seat.
    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("charged");
    const seats = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offer.id));
    expect(seats).toHaveLength(1);
  });

  it("leaves a live (fresh) 'recovering' claim alone", async () => {
    const show = await seedShowRow();
    const { offer } = await seedCardFailure(show.id, { failedMinutesAgo: 30 });
    await db
      .update(offers)
      .set({ status: "recovering", recoveringAt: new Date(Date.now() - 1 * MIN) })
      .where(eq(offers.id, offer.id));

    const result = await expireCardFailures(db, new Date(), WINDOW_MIN);
    expect(result.staleRecoveriesReverted).toBe(0);

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("recovering"); // still mid-charge — not ours to touch
  });

  it("sweeps a stale 'recovering' claim back to card_failure so the fan can retry", async () => {
    // A crashed recovery strands the offer in 'recovering' (the claim CAS
    // would reject every retry). The cron hands it back after the bound.
    const show = await seedShowRow();
    const { offer } = await seedCardFailure(show.id, { failedMinutesAgo: 60 });
    await db
      .update(offers)
      .set({
        status: "recovering",
        recoveringAt: new Date(Date.now() - (STALE_RECOVERING_MINUTES + 5) * MIN),
      })
      .where(eq(offers.id, offer.id));

    const result = await expireCardFailures(db, new Date(), WINDOW_MIN);
    expect(result.staleRecoveriesReverted).toBe(1);
    expect(result.expired).toBe(0); // window (4h) not lapsed — seat stays held

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("card_failure");
    expect(row?.recoveringAt).toBeNull();
    const seats = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offer.id));
    expect(seats).toHaveLength(1);
  });

  it("releases a stale 'recovering' offer in the same run when its window also lapsed", async () => {
    const show = await seedShowRow();
    const { offer } = await seedCardFailure(show.id, {
      failedMinutesAgo: WINDOW_MIN + 60,
    });
    await db
      .update(offers)
      .set({
        status: "recovering",
        recoveringAt: new Date(Date.now() - (STALE_RECOVERING_MINUTES + 5) * MIN),
      })
      .where(eq(offers.id, offer.id));

    const result = await expireCardFailures(db, new Date(), WINDOW_MIN);
    expect(result.staleRecoveriesReverted).toBe(1);
    expect(result.expired).toBe(1);
    expect(result.offerIds).toEqual([offer.id]);

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("unplaced");
    const seats = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offer.id));
    expect(seats).toHaveLength(0);
  });
});
