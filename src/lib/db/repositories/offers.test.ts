import { describe, expect, expectTypeOf, it } from "vitest";

import { offers } from "../../../../drizzle/schema";
import {
  getOfferByShowAndUser,
  getOfferStatsByShowIds,
  getOfferStatsByTierForShow,
  getOfferStatsForArtist,
  getOfferStatsForShow,
  listBidsForUser,
  listOffersForUser,
  listPoolOffersForShow,
  upsertOfferForUser,
  type OfferStats,
  type OfferTierBucket,
  type UserBidRow,
} from "./offers";
import { makeMockDb } from "./_mock-db";

type Offer = typeof offers.$inferSelect;

// A reasonable default offer row. Tests override only the fields that
// matter for the case under test so the shape stays consistent.
function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    showId: "44444444-4444-4444-4444-444444444444",
    userId: "user_2abc",
    channel: "market",
    groupSize: 4,
    pricePerTicketCents: 4200,
    tierPreference: "this_or_worse",
    preferredTier: null,
    // rank_key is a generated column in Postgres; in mock-Db tests we set
    // it manually to whatever the row should report back.
    rankKey: BigInt(4200 * 1000 + 4),
    autoBidEnabled: false,
    autoBidCapCents: null,
    autoBidIncrementCents: 500,
    privateThresholdCents: null,
    stripePaymentMethodId: "pm_test",
    stripeSetupIntentId: "seti_test",
    status: "pool",
    submittedAt: new Date("2026-05-26T12:00:00Z"),
    revisedAt: null,
    ...overrides,
  };
}

describe("getOfferByShowAndUser", () => {
  it("returns null when the user has no offer on this show", async () => {
    const db = makeMockDb<Offer>([]);
    expect(
      await getOfferByShowAndUser(
        db,
        "44444444-4444-4444-4444-444444444444",
        "user_2abc",
      ),
    ).toBeNull();
  });

  it("returns the offer row when one exists", async () => {
    const offer = makeOffer();
    const db = makeMockDb<Offer>([offer]);
    const result = await getOfferByShowAndUser(db, offer.showId, offer.userId);
    expect(result).toEqual(offer);
    // Money stays integer cents.
    expect(result?.pricePerTicketCents).toBe(4200);
    // Raw enum string, no formatting.
    expect(result?.status).toBe("pool");
  });

  it("has the expected return type", () => {
    expectTypeOf(getOfferByShowAndUser).returns.resolves.toEqualTypeOf<
      Offer | null
    >();
  });
});

describe("listOffersForUser", () => {
  it("returns an empty array when the user has no offers", async () => {
    const db = makeMockDb<Offer>([]);
    expect(await listOffersForUser(db, "user_2abc")).toEqual([]);
  });

  it("returns every offer the user owns", async () => {
    const a = makeOffer({ id: "11111111-1111-1111-1111-111111111111" });
    const b = makeOffer({
      id: "22222222-2222-2222-2222-222222222222",
      showId: "55555555-5555-5555-5555-555555555555",
      pricePerTicketCents: 6000,
    });
    const db = makeMockDb<Offer>([a, b]);
    const result = await listOffersForUser(db, "user_2abc");
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.id)).toEqual([a.id, b.id]);
  });

  it("does not strip private_threshold_cents — the caller owns the data", async () => {
    // The privacy boundary is "don't leak private_threshold to *other*
    // users." listOffersForUser is the user's own offers, so the full
    // row passes through. The route that exposes other users' offers
    // (none exists today) is where redaction would live.
    const offer = makeOffer({ privateThresholdCents: 5500 });
    const db = makeMockDb<Offer>([offer]);
    const result = await listOffersForUser(db, "user_2abc");
    expect(result[0]?.privateThresholdCents).toBe(5500);
  });

  it("has the expected return type", () => {
    expectTypeOf(listOffersForUser).returns.resolves.toEqualTypeOf<Offer[]>();
  });
});

describe("upsertOfferForUser", () => {
  // Note: mock-Db can't simulate ON CONFLICT, so these tests only
  // exercise the return-shape contract. The real conflict path is
  // verified by integration tests once the local DB connection is
  // unblocked.

  const baseInsert = {
    showId: "44444444-4444-4444-4444-444444444444",
    userId: "user_2abc",
    groupSize: 4,
    pricePerTicketCents: 4200,
    tierPreference: "this_or_worse",
    preferredTier: "premium",
    channel: "market",
    autoBidEnabled: false,
    autoBidCapCents: null,
    autoBidIncrementCents: 500,
    privateThresholdCents: null,
    stripePaymentMethodId: "pm_dev_stub",
    stripeSetupIntentId: "seti_dev_stub",
  } as const;

  it("returns isRevision=false on a fresh insert (revised_at null)", async () => {
    const inserted = makeOffer({ revisedAt: null });
    const db = makeMockDb<Offer>([inserted]);
    const result = await upsertOfferForUser(db, baseInsert);
    expect(result.isRevision).toBe(false);
    expect(result.offer).toEqual(inserted);
  });

  it("returns isRevision=true when the returned row has revised_at set (conflict path)", async () => {
    // Mock-Db can't actually exercise ON CONFLICT DO UPDATE — we
    // simulate the post-conflict state by returning a row that
    // already has revised_at populated. The function should fold
    // that into isRevision=true.
    const revisedRow = makeOffer({
      pricePerTicketCents: 6000,
      revisedAt: new Date("2026-05-27T12:00:00Z"),
    });
    const db = makeMockDb<Offer>([revisedRow]);
    const result = await upsertOfferForUser(db, {
      ...baseInsert,
      pricePerTicketCents: 6000,
    });
    expect(result.isRevision).toBe(true);
    expect(result.offer.pricePerTicketCents).toBe(6000);
  });

  it("throws when the upsert returns no row (loud-fail rather than ambiguous)", async () => {
    const db = makeMockDb<Offer>([]);
    await expect(upsertOfferForUser(db, baseInsert)).rejects.toThrow(
      /no row returned/,
    );
  });

  it("has the expected return type", () => {
    expectTypeOf(upsertOfferForUser).returns.resolves.toEqualTypeOf<{
      offer: Offer;
      isRevision: boolean;
    }>();
  });
});

describe("listPoolOffersForShow", () => {
  it("returns an empty array when no offers are in the pool", async () => {
    const db = makeMockDb<Offer>([]);
    expect(
      await listPoolOffersForShow(
        db,
        "44444444-4444-4444-4444-444444444444",
      ),
    ).toEqual([]);
  });

  it("returns every pool offer for the show (driver doesn't filter; mock just hands back the rows)", async () => {
    // The mock-Db doesn't actually evaluate the WHERE clause, so this
    // test verifies the shape of the call, not the filter. The
    // status='pool' invariant is asserted in the repo function and
    // verified end-to-end by integration tests once the local DB
    // connection is unblocked.
    const a = makeOffer({ id: "11111111-1111-1111-1111-111111111111" });
    const b = makeOffer({
      id: "22222222-2222-2222-2222-222222222222",
      pricePerTicketCents: 6000,
    });
    const db = makeMockDb<Offer>([a, b]);
    const result = await listPoolOffersForShow(db, a.showId);
    expect(result).toHaveLength(2);
  });

  it("has the expected return type", () => {
    expectTypeOf(listPoolOffersForShow).returns.resolves.toEqualTypeOf<Offer[]>();
  });
});

describe("getOfferStatsForShow", () => {
  it("returns zero-stats for an empty pool", async () => {
    // Postgres returns one row with COUNT=0 and NULLs for the
    // aggregates when no rows match the WHERE clause. Mirror that
    // exactly so we exercise the parsing path the way prod will.
    const db = makeMockDb<{
      count: number;
      ticketsCount: number;
      medianCents: string | null;
      topCents: number | null;
    }>([{ count: 0, ticketsCount: 0, medianCents: null, topCents: null }]);
    const result = await getOfferStatsForShow(db, "44444444-4444-4444-4444-444444444444");
    expect(result).toEqual<OfferStats>({
      count: 0,
      ticketsCount: 0,
      medianCents: null,
      topCents: null,
    });
  });

  it("returns single-offer stats with median == that offer's price", async () => {
    const db = makeMockDb<{
      count: number;
      ticketsCount: number;
      medianCents: string | null;
      topCents: number | null;
    }>([{ count: 1, ticketsCount: 4, medianCents: "4200", topCents: 4200 }]);
    const result = await getOfferStatsForShow(db, "44444444-4444-4444-4444-444444444444");
    expect(result).toEqual<OfferStats>({
      count: 1,
      ticketsCount: 4,
      medianCents: 4200,
      topCents: 4200,
    });
  });

  it("floors a non-integer median to an integer cents value", async () => {
    // percentile_cont can return a half-cent ("4250.5") for an even
    // count. We floor to keep the view layer strictly integer.
    const db = makeMockDb<{
      count: number;
      ticketsCount: number;
      medianCents: string | null;
      topCents: number | null;
    }>([{ count: 2, ticketsCount: 7, medianCents: "4250.5", topCents: 6000 }]);
    const result = await getOfferStatsForShow(db, "44444444-4444-4444-4444-444444444444");
    expect(result.medianCents).toBe(4250);
    expect(result.topCents).toBe(6000);
    expect(result.ticketsCount).toBe(7);
  });

  it("handles a numeric (non-string) median if the driver ever returns one", async () => {
    // Defensive — postgres-js returns numeric as string today, but the
    // contract is fragile and not worth depending on for type safety.
    const db = makeMockDb<{
      count: number;
      ticketsCount: number;
      medianCents: number | null;
      topCents: number | null;
    }>([{ count: 3, ticketsCount: 12, medianCents: 3500, topCents: 5000 }]);
    const result = await getOfferStatsForShow(db, "44444444-4444-4444-4444-444444444444");
    expect(result.medianCents).toBe(3500);
  });

  it("has the expected return type", () => {
    expectTypeOf(getOfferStatsForShow).returns.resolves.toEqualTypeOf<OfferStats>();
  });
});

describe("getOfferStatsByShowIds", () => {
  it("returns an empty map when no show IDs are passed (skips the query entirely)", async () => {
    // Important: do NOT call the DB for an empty input. Otherwise we
    // emit `WHERE show_id IN ()` which Postgres rejects.
    const db = makeMockDb<{
      showId: string;
      count: number;
      ticketsCount: number;
      medianCents: string | null;
      topCents: number | null;
    }>([]);
    const result = await getOfferStatsByShowIds(db, []);
    expect(result.size).toBe(0);
  });

  it("backfills shows that have no matching offers with zero-stats", async () => {
    // Two requested shows, only one has rows in the GROUP BY result.
    // The other must still show up in the map (with zeros) so the
    // route handler can map every show without branching on missing
    // keys.
    const db = makeMockDb<{
      showId: string;
      count: number;
      ticketsCount: number;
      medianCents: string | null;
      topCents: number | null;
    }>([
      { showId: "show-a", count: 3, ticketsCount: 11, medianCents: "3500", topCents: 6000 },
    ]);
    const result = await getOfferStatsByShowIds(db, ["show-a", "show-b"]);
    expect(result.get("show-a")).toEqual<OfferStats>({
      count: 3,
      ticketsCount: 11,
      medianCents: 3500,
      topCents: 6000,
    });
    expect(result.get("show-b")).toEqual<OfferStats>({
      count: 0,
      ticketsCount: 0,
      medianCents: null,
      topCents: null,
    });
  });

  it("returns one entry per show ID even when the DB returns multiple groups", async () => {
    const db = makeMockDb<{
      showId: string;
      count: number;
      ticketsCount: number;
      medianCents: string | null;
      topCents: number | null;
    }>([
      { showId: "show-a", count: 2, ticketsCount: 6, medianCents: "4000", topCents: 5000 },
      { showId: "show-b", count: 5, ticketsCount: 18, medianCents: "2200", topCents: 8500 },
    ]);
    const result = await getOfferStatsByShowIds(db, ["show-a", "show-b"]);
    expect(result.size).toBe(2);
    expect(result.get("show-a")?.count).toBe(2);
    expect(result.get("show-a")?.ticketsCount).toBe(6);
    expect(result.get("show-b")?.count).toBe(5);
    expect(result.get("show-b")?.ticketsCount).toBe(18);
  });

  it("has the expected return type", () => {
    expectTypeOf(getOfferStatsByShowIds).returns.resolves.toEqualTypeOf<
      Map<string, OfferStats>
    >();
  });
});

describe("getOfferStatsForArtist", () => {
  it("returns zero-stats when the artist has no open shows / no pool", async () => {
    const db = makeMockDb<{
      count: number;
      ticketsCount: number;
      medianCents: string | null;
      topCents: number | null;
    }>([{ count: 0, ticketsCount: 0, medianCents: null, topCents: null }]);
    const result = await getOfferStatsForArtist(
      db,
      "11111111-1111-1111-1111-111111111111",
    );
    expect(result).toEqual<OfferStats>({
      count: 0,
      ticketsCount: 0,
      medianCents: null,
      topCents: null,
    });
  });

  it("aggregates the cross-show snapshot", async () => {
    const db = makeMockDb<{
      count: number;
      ticketsCount: number;
      medianCents: string | null;
      topCents: number | null;
    }>([{ count: 180, ticketsCount: 612, medianCents: "2600", topCents: 12000 }]);
    const result = await getOfferStatsForArtist(
      db,
      "11111111-1111-1111-1111-111111111111",
    );
    expect(result).toEqual<OfferStats>({
      count: 180,
      ticketsCount: 612,
      medianCents: 2600,
      topCents: 12000,
    });
  });

  it("has the expected return type", () => {
    expectTypeOf(getOfferStatsForArtist).returns.resolves.toEqualTypeOf<OfferStats>();
  });
});

describe("getOfferStatsByTierForShow", () => {
  it("returns one bucket per (tier_preference, preferred_tier) pair", async () => {
    const db = makeMockDb<{
      tierPreference: "specific" | "this_or_better" | "this_or_worse" | "any";
      preferredTier: string | null;
      count: number;
      ticketsCount: number;
    }>([
      { tierPreference: "specific", preferredTier: "premium", count: 4, ticketsCount: 12 },
      { tierPreference: "this_or_worse", preferredTier: "premium", count: 7, ticketsCount: 28 },
      { tierPreference: "any", preferredTier: null, count: 11, ticketsCount: 41 },
    ]);
    const result = await getOfferStatsByTierForShow(
      db,
      "44444444-4444-4444-4444-444444444444",
    );
    expect(result).toEqual<OfferTierBucket[]>([
      { tierPreference: "specific", preferredTier: "premium", count: 4, ticketsCount: 12 },
      { tierPreference: "this_or_worse", preferredTier: "premium", count: 7, ticketsCount: 28 },
      { tierPreference: "any", preferredTier: null, count: 11, ticketsCount: 41 },
    ]);
  });

  it("returns an empty array when there are no offers", async () => {
    const db = makeMockDb<{
      tierPreference: "specific" | "this_or_better" | "this_or_worse" | "any";
      preferredTier: string | null;
      count: number;
      ticketsCount: number;
    }>([]);
    const result = await getOfferStatsByTierForShow(
      db,
      "44444444-4444-4444-4444-444444444444",
    );
    expect(result).toEqual<OfferTierBucket[]>([]);
  });

  it("has the expected return type", () => {
    expectTypeOf(getOfferStatsByTierForShow).returns.resolves.toEqualTypeOf<
      OfferTierBucket[]
    >();
  });
});

describe("listBidsForUser", () => {
  it("returns an empty array when the user has no bids", async () => {
    const db = makeMockDb<{
      offer: Offer;
      showId: string;
      showStatus: "open";
      doorsAt: Date;
      bindingAllocationAt: Date;
      pausedAt: Date | null;
      artistName: string;
      venueName: string;
      venueCity: string | null;
    }>([]);
    const result = await listBidsForUser(db, "user_2abc");
    expect(result).toEqual([]);
  });

  it("projects each row onto { offer, show: {...} } and preserves order", async () => {
    // Verifies the projection step — the mock-Db doesn't honor ORDER BY
    // (it returns rows in input order), so we hand them in the order
    // we expect the repo to surface them.
    const offerNewer = makeOffer({
      id: "00000000-0000-0000-0000-000000000001",
      submittedAt: new Date("2026-05-26T15:00:00Z"),
    });
    const offerOlder = makeOffer({
      id: "00000000-0000-0000-0000-000000000002",
      showId: "55555555-5555-5555-5555-555555555555",
      submittedAt: new Date("2026-05-20T15:00:00Z"),
    });
    const db = makeMockDb<{
      offer: Offer;
      showId: string;
      showStatus: "open" | "complete";
      doorsAt: Date;
      bindingAllocationAt: Date;
      pausedAt: Date | null;
      artistName: string;
      venueName: string;
      venueCity: string | null;
    }>([
      {
        offer: offerNewer,
        showId: "44444444-4444-4444-4444-444444444444",
        showStatus: "open",
        doorsAt: new Date("2026-06-25T13:27:42Z"),
        bindingAllocationAt: new Date("2026-06-24T13:27:42Z"),
        pausedAt: null,
        artistName: "Citizen Cope",
        venueName: "Cope's place",
        venueCity: "Brooklyn, NY",
      },
      {
        offer: offerOlder,
        showId: "55555555-5555-5555-5555-555555555555",
        showStatus: "complete",
        doorsAt: new Date("2026-05-20T20:00:00Z"),
        bindingAllocationAt: new Date("2026-05-19T20:00:00Z"),
        pausedAt: null,
        artistName: "Citizen Cope",
        venueName: "Lincoln Theatre",
        venueCity: "Washington, DC",
      },
    ]);
    const result = await listBidsForUser(db, "user_2abc");
    expect(result).toHaveLength(2);
    expect(result[0]?.offer.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(result[0]?.show.venueName).toBe("Cope's place");
    expect(result[0]?.show.status).toBe("open");
    expect(result[1]?.show.status).toBe("complete");
    expect(result[1]?.show.venueCity).toBe("Washington, DC");
  });

  it("has the expected return type", () => {
    expectTypeOf(listBidsForUser).returns.resolves.toEqualTypeOf<UserBidRow[]>();
  });
});
