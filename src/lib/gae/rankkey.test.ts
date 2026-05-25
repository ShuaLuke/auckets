import { describe, expect, it } from "vitest";

import {
  RANK_KEY_GROUP_SIZE_MULTIPLIER,
  compareRankedOffers,
  computeRankKey,
  sortRankedOffers,
} from "./rankkey";
import type { RankedOffer } from "./types";

function makeOffer(overrides: Partial<RankedOffer> = {}): RankedOffer {
  const pricePerTicketCents = overrides.pricePerTicketCents ?? 5000;
  const groupSize = overrides.groupSize ?? 2;
  return {
    id: overrides.id ?? "offer-1",
    userId: overrides.userId ?? "user-1",
    showId: overrides.showId ?? "show-1",
    groupSize,
    pricePerTicketCents,
    rankKey:
      overrides.rankKey ?? computeRankKey(pricePerTicketCents, groupSize),
    submittedAt: overrides.submittedAt ?? new Date("2026-01-01T00:00:00Z"),
    tierPreference: overrides.tierPreference ?? { type: "any" },
    ...(overrides.acceptSplit !== undefined && {
      acceptSplit: overrides.acceptSplit,
    }),
  };
}

describe("computeRankKey", () => {
  it("applies the documented formula", () => {
    // $50.00 × 2 tickets: 5000 cents × 1000 + 2 = 5_000_002
    expect(computeRankKey(5000, 2)).toBe(5_000_002);
    expect(computeRankKey(4999, 8)).toBe(4_999_008);
    expect(computeRankKey(0, 1)).toBe(1);
  });

  it("pins the multiplier so group size up to 999 cannot bleed into price", () => {
    expect(RANK_KEY_GROUP_SIZE_MULTIPLIER).toBe(1000);
    // Largest possible group-size contribution at the multiplier ceiling
    // must still be strictly less than a one-cent price bump.
    const onePennyMore = computeRankKey(5001, 1);
    const maxGroupAtLowerPrice = computeRankKey(5000, 999);
    expect(onePennyMore).toBeGreaterThan(maxGroupAtLowerPrice);
  });
});

describe("compareRankedOffers", () => {
  it("ranks higher price ahead of lower price regardless of group size", () => {
    // $50 × 1 ticket beats $49.99 × 8 tickets.
    const expensive = makeOffer({
      id: "expensive",
      pricePerTicketCents: 5000,
      groupSize: 1,
    });
    const cheaper = makeOffer({
      id: "cheaper",
      pricePerTicketCents: 4999,
      groupSize: 8,
    });
    expect(compareRankedOffers(expensive, cheaper)).toBeLessThan(0);
    expect(compareRankedOffers(cheaper, expensive)).toBeGreaterThan(0);
  });

  it("at equal price, ranks the larger group first", () => {
    const big = makeOffer({
      id: "big",
      pricePerTicketCents: 5000,
      groupSize: 4,
    });
    const small = makeOffer({
      id: "small",
      pricePerTicketCents: 5000,
      groupSize: 2,
    });
    expect(compareRankedOffers(big, small)).toBeLessThan(0);
  });

  it("at equal rankKey, ranks the earlier submission first", () => {
    const earlier = makeOffer({
      id: "earlier",
      submittedAt: new Date("2026-01-01T10:00:00Z"),
    });
    const later = makeOffer({
      id: "later",
      submittedAt: new Date("2026-01-01T10:00:01Z"),
    });
    expect(compareRankedOffers(earlier, later)).toBeLessThan(0);
    expect(compareRankedOffers(later, earlier)).toBeGreaterThan(0);
  });

  it("at equal rankKey and submittedAt, falls back to lexicographic id", () => {
    const sameMoment = new Date("2026-01-01T10:00:00Z");
    const a = makeOffer({ id: "offer-a", submittedAt: sameMoment });
    const b = makeOffer({ id: "offer-b", submittedAt: sameMoment });
    expect(compareRankedOffers(a, b)).toBeLessThan(0);
    expect(compareRankedOffers(b, a)).toBeGreaterThan(0);
  });

  it("returns 0 only when id, time, and rankKey all match", () => {
    const a = makeOffer({ id: "same" });
    const b = makeOffer({ id: "same" });
    expect(compareRankedOffers(a, b)).toBe(0);
  });
});

describe("sortRankedOffers", () => {
  it("orders best-to-worst across all four tiebreaker tiers", () => {
    const sameMoment = new Date("2026-01-01T10:00:00Z");
    const inputs: RankedOffer[] = [
      // worst rankKey
      makeOffer({ id: "low-price", pricePerTicketCents: 3000, groupSize: 2 }),
      // tied with later one, but earlier id (lex tiebreak)
      makeOffer({
        id: "tied-a",
        pricePerTicketCents: 4000,
        groupSize: 4,
        submittedAt: sameMoment,
      }),
      // tied price+group, same instant — loses on id
      makeOffer({
        id: "tied-b",
        pricePerTicketCents: 4000,
        groupSize: 4,
        submittedAt: sameMoment,
      }),
      // same price, smaller group than the tied pair — ranks below them
      makeOffer({
        id: "smaller-group",
        pricePerTicketCents: 4000,
        groupSize: 2,
      }),
      // best rankKey
      makeOffer({ id: "top", pricePerTicketCents: 6000, groupSize: 2 }),
    ];

    const sorted = sortRankedOffers(inputs).map((o) => o.id);
    expect(sorted).toEqual([
      "top",
      "tied-a",
      "tied-b",
      "smaller-group",
      "low-price",
    ]);
  });

  it("does not mutate the input array", () => {
    const inputs: RankedOffer[] = [
      makeOffer({ id: "second", pricePerTicketCents: 3000 }),
      makeOffer({ id: "first", pricePerTicketCents: 5000 }),
    ];
    const snapshot = inputs.map((o) => o.id);
    sortRankedOffers(inputs);
    expect(inputs.map((o) => o.id)).toEqual(snapshot);
  });
});
