// Integration coverage for binding resumability — the recovery path for a
// run that died mid-Phase-2 (Vercel timeout, deploy, OOM, Stripe outage),
// leaving the show stuck in 'allocating' with some fans charged and the
// rest in limbo. Exercises the real Postgres state machine with a
// hand-rolled fake Stripe that counts every capture/cancel call, because
// the invariant under test is about money: across a crash and any number
// of resume passes, each placed offer's auth is captured EXACTLY once.
//
// What this file verifies that binding-allocation.integration.test.ts
// (the happy-path fresh run) can't:
//   - The settlement work list is rebuilt from offer statuses: offers the
//     crashed run already settled ('charged') are skipped — zero extra
//     Stripe calls — while still-'placed' offers are captured.
//   - The ambiguous crash window (capture reached Stripe, terminal write
//     lost → PI 'succeeded' but offer still 'placed') converges to
//     'charged' without a double charge, recording Stripe's
//     amount_received as the charged amount.
//   - A genuinely dead auth discovered at resume becomes card_failure and
//     does NOT block the run completing.
//   - Unplaced auth release is re-entrant (already-canceled = success).
//   - The show reaches 'allocated', seat assignments stay unique, and a
//     second resume on the now-allocated show is refused.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";

import { db } from "@/lib/db";
import {
  captureBindingOffers,
  listBindingSettlementWorklist,
  resumeBindingAllocation,
  runBindingPhase1,
} from "@/lib/allocation/run-binding";
import { offers, seatAssignments, shows } from "../../drizzle/schema";

import { seedShow, seedUser, seedVenue, seedVenueArchitecture } from "./helpers";

// One orchestra row, capacity 8 — fits two group-of-4 offers, so a third
// group-of-4 is forced unplaced. Gives a work list of 2 captures + 1 cancel,
// enough to crash "between" captures.
const ROW_CAP_8 = [
  {
    id: "row_a",
    area: "orchestra",
    section: "main",
    rowName: "A",
    rowRank: 1,
    capacity: 8,
    parity: "EVEN",
    lean: "CENTER",
    seatNumbers: ["1", "2", "3", "4", "5", "6", "7", "8"],
    holds: [],
    tier: "premium",
    isGa: false,
  },
];

async function seedCap8Show() {
  const venue = await seedVenue();
  const arch = await seedVenueArchitecture(venue.id, { rows: ROW_CAP_8 });
  const { show } = await seedShow({
    venueId: venue.id,
    venueArchitectureId: arch.id,
  });
  return show;
}

async function seedPoolOffer(
  showId: string,
  opts: { groupSize: number; priceCents: number; paymentIntentId: string },
) {
  const user = await seedUser();
  const rows = await db
    .insert(offers)
    .values({
      showId,
      userId: user.id,
      groupSize: opts.groupSize,
      pricePerTicketCents: opts.priceCents,
      tierPreference: "any",
      stripePaymentMethodId: "pm_test_stub",
      stripePaymentIntentId: opts.paymentIntentId,
      status: "pool",
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("seedPoolOffer: no row returned");
  return row;
}

type CaptureCall = { id: string; params: unknown; options: unknown };

// Fake Stripe with per-PI scripting:
//   alreadySucceeded — capture throws unexpected_state, retrieve reports
//     'succeeded' (the crashed-after-capture ambiguity).
//   deadAuth — capture throws unexpected_state, retrieve reports 'canceled'
//     (auth genuinely gone → card_failure).
function makeFakeStripe(
  opts: {
    alreadySucceeded?: Map<string, { amountReceived: number }>;
    deadAuth?: Set<string>;
  } = {},
) {
  const captureCalls: CaptureCall[] = [];
  const cancelCalls: string[] = [];
  const stripe = {
    paymentIntents: {
      capture: async (id: string, params?: unknown, options?: unknown) => {
        captureCalls.push({ id, params, options });
        if (opts.alreadySucceeded?.has(id) || opts.deadAuth?.has(id)) {
          throw {
            code: "payment_intent_unexpected_state",
            message: "PI is not in a capturable state",
          };
        }
        return { id, status: "succeeded" };
      },
      retrieve: async (id: string) => {
        const succeeded = opts.alreadySucceeded?.get(id);
        if (succeeded) {
          return { id, status: "succeeded", amount_received: succeeded.amountReceived };
        }
        return { id, status: "canceled" };
      },
      cancel: async (id: string) => {
        cancelCalls.push(id);
        return { id, status: "canceled" };
      },
    },
  } as unknown as Stripe;
  return { stripe, captureCalls, cancelCalls };
}

// Phase 1 alone = the crash point: placements + offer statuses committed,
// zero Stripe calls made, show left 'allocating'.
async function commitPhase1(showId: string) {
  const phase1 = await runBindingPhase1(db, showId);
  expect(phase1.ok).toBe(true);
  const [showRow] = await db.select().from(shows).where(eq(shows.id, showId));
  expect(showRow?.status).toBe("allocating");
}

describe("binding resumability (integration)", () => {
  it("resumes a run that died between captures: each PI captured exactly once, show allocated", async () => {
    const show = await seedCap8Show();
    // A and B (higher prices) win the 8 seats; C is forced unplaced.
    const offerA = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 6000,
      paymentIntentId: "pi_A",
    });
    const offerB = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 5000,
      paymentIntentId: "pi_B",
    });
    const offerC = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 3000,
      paymentIntentId: "pi_C",
    });

    const { stripe, captureCalls, cancelCalls } = makeFakeStripe();

    // --- Simulate the crash: Phase 1 commits, then only ONE of the two
    // placed offers is captured before the process dies. ---
    await commitPhase1(show.id);
    const worklist = await listBindingSettlementWorklist(db, show.id);
    expect(worklist.sort()).toEqual([offerA.id, offerB.id].sort());
    const firstId = worklist[0]!;
    await captureBindingOffers(db, stripe, show.id, [firstId]);

    // Mid-crash state: one charged, one still placed, C's auth NOT
    // released, show stuck 'allocating'. This is the state two reviews
    // rated critical — before this slice, nothing could move it.
    expect(captureCalls).toHaveLength(1);
    const [firstOffer] = await db
      .select()
      .from(offers)
      .where(eq(offers.id, firstId));
    expect(firstOffer?.status).toBe("charged");
    expect(cancelCalls).toHaveLength(0);

    // --- Resume. ---
    const resume = await resumeBindingAllocation(db, stripe, show.id);
    expect(resume.ok).toBe(true);
    if (!resume.ok) return;
    expect(resume.value.resumed).toBe(true);
    // Only the offer the crash left 'placed' was captured by the resume.
    expect(resume.value.captured).toBe(1);
    expect(resume.value.cardFailures).toBe(0);
    expect(resume.value.cancelled).toBe(1);
    expect(resume.value.finalized).toBe(true);

    // Money invariant: pi_A and pi_B were each captured EXACTLY once, with
    // deterministic idempotency keys; the already-charged offer triggered
    // zero additional Stripe calls.
    expect(captureCalls).toHaveLength(2);
    expect(new Set(captureCalls.map((c) => c.id))).toEqual(
      new Set(["pi_A", "pi_B"]),
    );
    for (const call of captureCalls) {
      expect(call.options).toHaveProperty("idempotencyKey");
    }
    const keys = captureCalls.map(
      (c) => (c.options as { idempotencyKey: string }).idempotencyKey,
    );
    expect(new Set(keys).size).toBe(2); // distinct per (offer, PI)

    // C's auth released exactly once; C never captured.
    expect(cancelCalls).toEqual(["pi_C"]);

    // Terminal DB state: both placed offers charged with amounts, C
    // unplaced, show allocated, one binding assignment per placed offer
    // (no duplicates).
    const [rowA] = await db.select().from(offers).where(eq(offers.id, offerA.id));
    const [rowB] = await db.select().from(offers).where(eq(offers.id, offerB.id));
    const [rowC] = await db.select().from(offers).where(eq(offers.id, offerC.id));
    expect(rowA?.status).toBe("charged");
    expect(rowB?.status).toBe("charged");
    expect(rowC?.status).toBe("unplaced");

    const assignments = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.showId, show.id));
    expect(assignments).toHaveLength(2);
    const byOffer = new Map(assignments.map((a) => [a.offerId, a]));
    expect(byOffer.get(offerA.id)?.chargedAmountCents).toBe(24000);
    expect(byOffer.get(offerB.id)?.chargedAmountCents).toBe(20000);
    expect(assignments.every((a) => a.isBinding)).toBe(true);

    const [showRow] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(showRow?.status).toBe("allocated");

    // --- A second resume on the now-allocated show is refused (and makes
    // no Stripe calls): resumability never reopens a finished run. ---
    const again = await resumeBindingAllocation(db, stripe, show.id);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toEqual({
      kind: "show_not_eligible",
      status: "allocated",
    });
    expect(captureCalls).toHaveLength(2);
    expect(cancelCalls).toHaveLength(1);
  });

  it("converges the ambiguous crash window: PI captured at Stripe but terminal write lost → charged once, Stripe's amount recorded", async () => {
    const show = await seedCap8Show();
    const offer = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 6000,
      paymentIntentId: "pi_ambiguous",
    });

    // The crashed run's capture reached Stripe (PI is 'succeeded') but died
    // before writing 'charged' — the offer is still 'placed'. The fake
    // makes the retry's capture throw unexpected_state and the retrieve
    // report success with the actually-received amount.
    const { stripe, captureCalls } = makeFakeStripe({
      alreadySucceeded: new Map([["pi_ambiguous", { amountReceived: 24000 }]]),
    });

    await commitPhase1(show.id);
    const resume = await resumeBindingAllocation(db, stripe, show.id);

    expect(resume.ok).toBe(true);
    if (!resume.ok) return;
    // Counted as captured — the fan IS charged (once, by the crashed run).
    expect(resume.value.captured).toBe(1);
    expect(resume.value.cardFailures).toBe(0);
    expect(resume.value.finalized).toBe(true);
    expect(captureCalls).toHaveLength(1);

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("charged");
    const [assignment] = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offer.id));
    expect(assignment?.chargedAmountCents).toBe(24000);

    const [showRow] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(showRow?.status).toBe("allocated");
  });

  it("flags a genuinely dead auth discovered at resume as card_failure without blocking completion", async () => {
    const show = await seedCap8Show();
    const offer = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 6000,
      paymentIntentId: "pi_dead",
    });

    // unexpected_state + retrieve says 'canceled': the card was canceled
    // between auth and capture (the ~2% ADR-0003 case) — NOT a success.
    const { stripe } = makeFakeStripe({ deadAuth: new Set(["pi_dead"]) });

    await commitPhase1(show.id);
    const resume = await resumeBindingAllocation(db, stripe, show.id);

    expect(resume.ok).toBe(true);
    if (!resume.ok) return;
    expect(resume.value.captured).toBe(0);
    expect(resume.value.cardFailures).toBe(1);
    expect(resume.value.finalized).toBe(true);

    const [row] = await db.select().from(offers).where(eq(offers.id, offer.id));
    expect(row?.status).toBe("card_failure");
    const [assignment] = await db
      .select()
      .from(seatAssignments)
      .where(eq(seatAssignments.offerId, offer.id));
    expect(assignment?.chargedAmountCents).toBeNull();
    expect(assignment?.cardFailureAt).toBeInstanceOf(Date);

    // The run still completes — card_failure feeds the recovery flow.
    const [showRow] = await db.select().from(shows).where(eq(shows.id, show.id));
    expect(showRow?.status).toBe("allocated");
  });

  it("refuses to resume a show that isn't 'allocating' (resume is recovery-only, never a fresh run)", async () => {
    const { show } = await seedShow(); // status 'open'
    const { stripe, captureCalls } = makeFakeStripe();

    const outcome = await resumeBindingAllocation(db, stripe, show.id);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toEqual({ kind: "show_not_eligible", status: "open" });
    expect(captureCalls).toHaveLength(0);

    const missing = await resumeBindingAllocation(
      db,
      stripe,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.kind).toBe("show_not_found");
  });

  it("derives the settlement work list from offer statuses: placed in, settled out", async () => {
    const show = await seedCap8Show();
    const offerA = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 6000,
      paymentIntentId: "pi_wl_A",
    });
    const offerB = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 5000,
      paymentIntentId: "pi_wl_B",
    });
    await commitPhase1(show.id);

    // Both placed → both in the work list.
    expect((await listBindingSettlementWorklist(db, show.id)).sort()).toEqual(
      [offerA.id, offerB.id].sort(),
    );

    // Settle A as charged and B as card_failure (terminal states a crashed
    // run leaves behind) — the work list must drop them both.
    await db
      .update(offers)
      .set({ status: "charged" })
      .where(eq(offers.id, offerA.id));
    await db
      .update(offers)
      .set({ status: "card_failure" })
      .where(eq(offers.id, offerB.id));
    expect(await listBindingSettlementWorklist(db, show.id)).toEqual([]);
  });

  it("skips an offer another worker settled between work-list read and capture (no double Stripe call)", async () => {
    const show = await seedCap8Show();
    const offer = await seedPoolOffer(show.id, {
      groupSize: 4,
      priceCents: 6000,
      paymentIntentId: "pi_raced",
    });
    await commitPhase1(show.id);

    // Simulate the race: a concurrent pass settles the offer after this
    // pass read its work list but before it captures.
    await db
      .update(offers)
      .set({ status: "charged" })
      .where(eq(offers.id, offer.id));

    const { stripe, captureCalls } = makeFakeStripe();
    const result = await captureBindingOffers(db, stripe, show.id, [offer.id]);

    expect(captureCalls).toHaveLength(0); // never touched Stripe
    expect(result).toEqual({ captured: 0, cardFailures: 0, skipped: 0 });
  });
});
