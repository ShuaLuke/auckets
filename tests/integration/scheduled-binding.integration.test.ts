// Integration coverage for sweepDueBindings — the scheduled-binding sweep
// (the Inngest cron's body) against a real Postgres with a fake Stripe. The
// Inngest wrapper is thin glue; this exercises the actual selection + binding.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { db } from "@/lib/db";
import { sweepDueBindings } from "@/lib/allocation/scheduled-binding";
import { offers, shows } from "../../drizzle/schema";

import { seedShow, seedUser } from "./helpers";

const fakeStripe = {
  paymentIntents: {
    capture: async (id: string) => ({ id, status: "succeeded" }),
    cancel: async (id: string) => ({ id, status: "canceled" }),
  },
} as unknown as Stripe;

const HOUR = 60 * 60 * 1000;

async function setBindingAt(showId: string, when: Date) {
  await db
    .update(shows)
    .set({ bindingAllocationAt: when })
    .where(eq(shows.id, showId));
}

async function seedPoolOffer(showId: string, piId: string) {
  const user = await seedUser();
  await db.insert(offers).values({
    showId,
    userId: user.id,
    groupSize: 2,
    pricePerTicketCents: 6000,
    tierPreference: "any",
    stripePaymentMethodId: "pm_test_stub",
    stripePaymentIntentId: piId,
    status: "pool",
  });
}

describe("sweepDueBindings (integration)", () => {
  it("binds an open show whose checkpoint has passed", async () => {
    const { show } = await seedShow(); // status 'open'
    await setBindingAt(show.id, new Date(Date.now() - HOUR));
    await seedPoolOffer(show.id, "pi_due");

    const result = await sweepDueBindings(db, fakeStripe, new Date());

    expect(result.results.some((r) => r.showId === show.id && r.ok)).toBe(true);
    const [row] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(row?.status).toBe("allocated");
    const [offer] = await db
      .select()
      .from(offers)
      .where(eq(offers.showId, show.id));
    expect(offer?.status).toBe("charged");
  });

  it("skips a show whose checkpoint is still in the future", async () => {
    const { show } = await seedShow();
    await setBindingAt(show.id, new Date(Date.now() + 24 * HOUR));
    await seedPoolOffer(show.id, "pi_future");

    const result = await sweepDueBindings(db, fakeStripe, new Date());

    expect(result.results.some((r) => r.showId === show.id)).toBe(false);
    const [row] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(row?.status).toBe("open"); // untouched
  });

  it("does not auto-bind a paused show even past its checkpoint (ADR-0013)", async () => {
    const { show } = await seedShow({ status: "paused" });
    await setBindingAt(show.id, new Date(Date.now() - HOUR));
    await seedPoolOffer(show.id, "pi_paused");

    const result = await sweepDueBindings(db, fakeStripe, new Date());

    expect(result.results.some((r) => r.showId === show.id)).toBe(false);
    const [row] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(row?.status).toBe("paused"); // ops decides, not the scheduler
  });

  it("is a no-op on a second sweep — the bound show is no longer due", async () => {
    const { show } = await seedShow();
    await setBindingAt(show.id, new Date(Date.now() - HOUR));
    await seedPoolOffer(show.id, "pi_once");

    const first = await sweepDueBindings(db, fakeStripe, new Date());
    expect(first.bound).toBe(1);

    // The show is now 'allocated' → not in the due set → second sweep skips it.
    const second = await sweepDueBindings(db, fakeStripe, new Date());
    expect(second.due).toBe(0);
    expect(second.bound).toBe(0);
  });
});
