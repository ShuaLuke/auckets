// Integration coverage for sweepDueBindings — the scheduled-binding sweep
// (the Inngest cron's body) against a real Postgres with a fake Stripe. The
// Inngest wrapper is thin glue; this exercises the actual selection + binding.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { db } from "@/lib/db";
import { sweepDueBindings } from "@/lib/allocation/scheduled-binding";
import { runBindingPhase1 } from "@/lib/allocation/run-binding";
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

  it("resumes a show stuck in 'allocating' past the recovery threshold (crashed mid-settlement)", async () => {
    const { show } = await seedShow();
    // Checkpoint an hour ago — well past the ~10-minute stuck threshold.
    await setBindingAt(show.id, new Date(Date.now() - HOUR));
    await seedPoolOffer(show.id, "pi_stuck");

    // Simulate the crash: Phase 1 commits (show → 'allocating', offer →
    // 'placed') and the process dies before any Stripe call.
    const phase1 = await runBindingPhase1(db, show.id);
    expect(phase1.ok).toBe(true);
    const [mid] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(mid?.status).toBe("allocating");

    // Before this slice the show was stuck forever: not in the due set
    // (open|closed only), the admin button bounced 409, manual SQL was the
    // only way out. Now the sweep's stuck pass settles it.
    const result = await sweepDueBindings(db, fakeStripe, new Date());

    expect(result.stuck).toBe(1);
    const entry = result.results.find((r) => r.showId === show.id);
    expect(entry?.ok).toBe(true);
    if (!entry?.ok) return;
    expect(entry.resumed).toBe(true);
    expect(entry.captured).toBe(1);

    const [row] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(row?.status).toBe("allocated");
    const [offer] = await db
      .select()
      .from(offers)
      .where(eq(offers.showId, show.id));
    expect(offer?.status).toBe("charged");
  });

  it("leaves a freshly-'allocating' show alone — inside the threshold it may still be a live run", async () => {
    const { show } = await seedShow();
    // Checkpoint 2 minutes ago: due tick just fired; a healthy run could
    // legitimately still be capturing. The stuck pass must not touch it.
    await setBindingAt(show.id, new Date(Date.now() - 2 * 60 * 1000));
    await seedPoolOffer(show.id, "pi_live");

    const phase1 = await runBindingPhase1(db, show.id);
    expect(phase1.ok).toBe(true);

    const result = await sweepDueBindings(db, fakeStripe, new Date());

    expect(result.stuck).toBe(0);
    expect(result.results.some((r) => r.showId === show.id)).toBe(false);
    const [row] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(row?.status).toBe("allocating"); // untouched — next ticks recover it
    const [offer] = await db
      .select()
      .from(offers)
      .where(eq(offers.showId, show.id));
    expect(offer?.status).toBe("placed"); // no money moved
  });

  it("settles a show that turned 'allocating' between the due query and the claim (race fallthrough)", async () => {
    const { show } = await seedShow();
    await setBindingAt(show.id, new Date(Date.now() - HOUR));
    await seedPoolOffer(show.id, "pi_race_resume");

    // Reproduce the race with the step runner as the injection point: the
    // sweep reads its due + stuck lists while the show is still 'open'
    // (due includes it, stuck doesn't), then a "concurrent trigger" commits
    // Phase 1 before the sweep's own claim runs. The sweep's phase1 then
    // reports not_eligible/'allocating' and must settle instead of skip.
    const runner = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
      const res = await fn();
      if (id === "list-stuck-allocating") {
        const phase1 = await runBindingPhase1(db, show.id);
        expect(phase1.ok).toBe(true);
      }
      return res;
    };

    const result = await sweepDueBindings(db, fakeStripe, new Date(), runner);

    expect(result.due).toBe(1);
    expect(result.stuck).toBe(0);
    const entry = result.results.find((r) => r.showId === show.id);
    expect(entry?.ok).toBe(true);
    if (!entry?.ok) return;
    expect(entry.resumed).toBe(true);
    expect(entry.captured).toBe(1);

    const [row] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(row?.status).toBe("allocated");
    const [offer] = await db
      .select()
      .from(offers)
      .where(eq(offers.showId, show.id));
    expect(offer?.status).toBe("charged");
  });
});
