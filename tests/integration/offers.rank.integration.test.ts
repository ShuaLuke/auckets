// Integration coverage for getUserRankInShowPool — the per-user rank
// query that powers the Show detail RankBoard.
//
// What the mock-DB unit test cannot verify, and this file does:
//   - The generated `rank_key` column orders offers correctly under the
//     `(price_per_ticket_cents::bigint * 1000 + group_size)` formula
//   - The tie-break clause (rank_key DESC, submitted_at ASC) actually
//     fires when two offers have identical rank_keys — i.e. same price
//     AND same group size — earlier submitter wins
//   - The status filter ('pool' | 'placed' only) excludes terminal
//     statuses from the rank computation

import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  getUserRankInShowPool,
  upsertOfferForUser,
} from "@/lib/db/repositories/offers";
import { offers } from "../../drizzle/schema";

import {
  STUB_PAYMENT_METHOD_ID,
  STUB_SETUP_INTENT_ID,
  seedShow,
  seedUser,
} from "./helpers";

async function placeOffer(
  showId: string,
  userId: string,
  pricePerTicketCents: number,
  groupSize: number,
): Promise<void> {
  await upsertOfferForUser(db, {
    showId,
    userId,
    groupSize,
    pricePerTicketCents,
    tierPreference: "any",
    stripePaymentMethodId: STUB_PAYMENT_METHOD_ID,
    stripeSetupIntentId: STUB_SETUP_INTENT_ID,
  });
}

describe("getUserRankInShowPool (integration)", () => {
  it("returns null when the user has no offer on this show", async () => {
    const user = await seedUser();
    const { show } = await seedShow();
    expect(await getUserRankInShowPool(db, show.id, user.id)).toBeNull();
  });

  it("returns 1 for the sole offer in the pool", async () => {
    const user = await seedUser();
    const { show } = await seedShow();
    await placeOffer(show.id, user.id, 4200, 4);
    expect(await getUserRankInShowPool(db, show.id, user.id)).toBe(1);
  });

  it("ranks higher-priced offers above lower-priced ones (rank_key DESC)", async () => {
    const top = await seedUser();
    const mid = await seedUser();
    const bottom = await seedUser();
    const { show } = await seedShow();

    await placeOffer(show.id, bottom.id, 2000, 2);
    await placeOffer(show.id, mid.id, 3500, 2);
    await placeOffer(show.id, top.id, 6000, 2);

    expect(await getUserRankInShowPool(db, show.id, top.id)).toBe(1);
    expect(await getUserRankInShowPool(db, show.id, mid.id)).toBe(2);
    expect(await getUserRankInShowPool(db, show.id, bottom.id)).toBe(3);
  });

  it("breaks ties at equal price using group_size — larger group ranks higher (per the rank_key formula)", async () => {
    // rank_key = price * 1000 + group_size. At equal price, the larger
    // group has a higher rank_key, so it ranks above. (Not a tie-break
    // by submission time — the formula itself decides.)
    const bigger = await seedUser();
    const smaller = await seedUser();
    const { show } = await seedShow();

    await placeOffer(show.id, smaller.id, 4000, 2);
    await placeOffer(show.id, bigger.id, 4000, 6);

    expect(await getUserRankInShowPool(db, show.id, bigger.id)).toBe(1);
    expect(await getUserRankInShowPool(db, show.id, smaller.id)).toBe(2);
  });

  it("breaks rank_key ties (same price AND same group size) by earliest submitted_at", async () => {
    // Two offers with identical price + group_size produce identical
    // rank_keys. The tie-break is submitted_at ASC — whoever got here
    // first ranks above. We force the submission order by inserting
    // sequentially with a small explicit delay; Postgres' transaction
    // timestamps will reflect the order even at sub-second resolution.
    const earlier = await seedUser();
    const later = await seedUser();
    const { show } = await seedShow();

    await placeOffer(show.id, earlier.id, 4500, 3);
    // Tiny delay to make the timestamps definitively distinct — without
    // it, two upserts in the same millisecond could tie at the
    // submitted_at level too and the test would be order-flaky.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await placeOffer(show.id, later.id, 4500, 3);

    expect(await getUserRankInShowPool(db, show.id, earlier.id)).toBe(1);
    expect(await getUserRankInShowPool(db, show.id, later.id)).toBe(2);
  });

  it("ignores offers in terminal statuses ('charged' / 'refunded' / etc.) when computing rank", async () => {
    // Insert two offers, then flip one to 'charged' (post-binding terminal).
    // The remaining 'pool' offer should rank #1 — the charged one shouldn't
    // count as "above" it.
    const live = await seedUser();
    const charged = await seedUser();
    const { show } = await seedShow();

    await placeOffer(show.id, charged.id, 8000, 4);
    await placeOffer(show.id, live.id, 3000, 2);

    // Flip the higher-priced offer to 'charged' via a direct UPDATE — the
    // repository doesn't expose status mutation today (lands with the
    // binding allocation slice).
    const { eq } = await import("drizzle-orm");
    await db
      .update(offers)
      .set({ status: "charged" })
      .where(eq(offers.userId, charged.id));

    expect(await getUserRankInShowPool(db, show.id, live.id)).toBe(1);
    // And the charged user's own rank query returns null — they're past
    // the point where pre-binding rank is meaningful.
    expect(await getUserRankInShowPool(db, show.id, charged.id)).toBeNull();
  });
});
