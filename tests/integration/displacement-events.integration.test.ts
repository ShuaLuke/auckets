// Integration coverage for the displacement-alert side of runPreviewAllocation
// (ADR-0018 §4) against a real Postgres. Preview touches no Stripe, so this
// drives the orchestrator directly and asserts on the displacement_events
// rows it writes by diffing each run against the prior preview projection.
//
// What this verifies that the pure detector unit tests can't:
//   - run-preview reads the PRIOR preview placement as the baseline and
//     persists outbid_out when a higher offer displaces an earlier one.
//   - auto_bid_raise is written once and DEDUPED on an identical re-run
//     (the dedup query reads back the last persisted raise target).

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { runPreviewAllocation } from "@/lib/allocation/run-preview";
import { displacementEvents, offers } from "../../drizzle/schema";

import { seedShow, seedUser, seedVenue, seedVenueArchitecture } from "./helpers";

// One premium row, capacity 4 — a single group of 4 fills it, forcing a
// clean placed/unplaced split.
const ROW_CAP_4 = [
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

async function seedCap4Show() {
  const venue = await seedVenue();
  const arch = await seedVenueArchitecture(venue.id, { rows: ROW_CAP_4 });
  const { show } = await seedShow({
    venueId: venue.id,
    venueArchitectureId: arch.id,
  });
  return show;
}

async function seedPoolOffer(
  showId: string,
  opts: {
    priceCents: number;
    groupSize?: number;
    tierPreference?: "specific" | "this_or_better" | "this_or_worse" | "any";
    preferredTier?: string;
    autoBidEnabled?: boolean;
    autoBidCapCents?: number;
  },
) {
  const user = await seedUser();
  const rows = await db
    .insert(offers)
    .values({
      showId,
      userId: user.id,
      groupSize: opts.groupSize ?? 4,
      pricePerTicketCents: opts.priceCents,
      tierPreference: opts.tierPreference ?? "any",
      preferredTier: opts.preferredTier ?? null,
      autoBidEnabled: opts.autoBidEnabled ?? false,
      autoBidCapCents: opts.autoBidCapCents ?? null,
      stripePaymentMethodId: "pm_test_stub",
      stripeSetupIntentId: "seti_test_stub",
      status: "pool",
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("seedPoolOffer: no row returned");
  return row;
}

function eventsForOffer(showId: string, offerId: string) {
  return db
    .select()
    .from(displacementEvents)
    .where(
      and(
        eq(displacementEvents.showId, showId),
        eq(displacementEvents.offerId, offerId),
      ),
    );
}

describe("runPreviewAllocation displacement alerts (integration)", () => {
  it("emits outbid_out for an offer a later, higher offer displaces", async () => {
    const show = await seedCap4Show();
    const offerA = await seedPoolOffer(show.id, { priceCents: 6000 });

    // Run 1: A is the only offer → placed in premium. No prior projection, so
    // no alerts yet.
    const first = await runPreviewAllocation(db, show.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.displacementEventsWritten).toBe(0);

    // A higher offer arrives and takes the only row.
    await seedPoolOffer(show.id, { priceCents: 8000 });

    // Run 2: B displaces A. A was premium, now unplaced → one outbid_out.
    const second = await runPreviewAllocation(db, show.id);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.displacementEventsWritten).toBe(1);

    const aEvents = await eventsForOffer(show.id, offerA.id);
    expect(aEvents).toHaveLength(1);
    expect(aEvents[0]?.kind).toBe("outbid_out");
    expect((aEvents[0]?.detail as { fromTier?: string }).fromTier).toBe("premium");
    expect(aEvents[0]?.userId).toBe(offerA.userId);
    expect(aEvents[0]?.acknowledgedAt).toBeNull();
  });

  it("writes auto_bid_raise once and dedupes it on an identical re-run", async () => {
    const show = await seedCap4Show();
    // A ($62, no auto-bid) outranks B's submitted $50; B auto-bids up to $80
    // and climbs to $65 to take the row.
    await seedPoolOffer(show.id, { priceCents: 6200 });
    const offerB = await seedPoolOffer(show.id, {
      priceCents: 5000,
      tierPreference: "specific",
      preferredTier: "premium",
      autoBidEnabled: true,
      autoBidCapCents: 8000,
    });

    // Run 1: B's auto-bid fires → one auto_bid_raise to $65.
    const first = await runPreviewAllocation(db, show.id);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    let bEvents = await eventsForOffer(show.id, offerB.id);
    expect(bEvents).toHaveLength(1);
    expect(bEvents[0]?.kind).toBe("auto_bid_raise");
    expect((bEvents[0]?.detail as { toCents?: number }).toCents).toBe(6500);

    // Run 2: identical pool → B resolves to the same $65. The raise is deduped
    // against the persisted target, and placement is unchanged → no new event.
    const second = await runPreviewAllocation(db, show.id);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.displacementEventsWritten).toBe(0);

    bEvents = await eventsForOffer(show.id, offerB.id);
    expect(bEvents).toHaveLength(1);
  });
});
