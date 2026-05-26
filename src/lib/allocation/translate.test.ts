import { describe, expect, it } from "vitest";

import type {
  VenueArchitecture as DbVenueArchitecture,
} from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import type { offers, shows } from "../../../drizzle/schema";

import {
  toGaeRankedOffer,
  toGaeTierPreference,
  toGaeVenueArchitecture,
} from "./translate";

type Offer = typeof offers.$inferSelect;
type Show = typeof shows.$inferSelect;

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    showId: "44444444-4444-4444-4444-444444444444",
    userId: "user_2abc",
    channel: "market",
    groupSize: 4,
    pricePerTicketCents: 4200,
    tierPreference: "this_or_worse",
    preferredTier: "premium",
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

describe("toGaeTierPreference", () => {
  it("maps 'any' to the bare-shape any variant (no tier field)", () => {
    const offer = makeOffer({ tierPreference: "any", preferredTier: null });
    expect(toGaeTierPreference(offer)).toEqual({ type: "any" });
  });

  it("maps 'specific' to { type, tier } when preferredTier is present", () => {
    const offer = makeOffer({
      tierPreference: "specific",
      preferredTier: "premium",
    });
    expect(toGaeTierPreference(offer)).toEqual({
      type: "specific",
      tier: "premium",
    });
  });

  it("maps 'this_or_better' through correctly", () => {
    const offer = makeOffer({
      tierPreference: "this_or_better",
      preferredTier: "mid",
    });
    expect(toGaeTierPreference(offer)).toEqual({
      type: "this_or_better",
      tier: "mid",
    });
  });

  it("maps 'this_or_worse' through correctly", () => {
    const offer = makeOffer({
      tierPreference: "this_or_worse",
      preferredTier: "premium",
    });
    expect(toGaeTierPreference(offer)).toEqual({
      type: "this_or_worse",
      tier: "premium",
    });
  });

  it("degrades to 'any' when a tier-bound row is missing preferredTier", () => {
    // Defensive: shouldn't happen with Zod-validated submission, but if
    // it does we'd rather place the offer (as 'any') than crash.
    const offer = makeOffer({
      tierPreference: "specific",
      preferredTier: null,
    });
    expect(toGaeTierPreference(offer)).toEqual({ type: "any" });
  });

  it("degrades to 'any' when tierPreference is an unknown string", () => {
    // Defensive against future enum drift.
    const offer = makeOffer({
      tierPreference: "unknown_future_value",
      preferredTier: "premium",
    });
    expect(toGaeTierPreference(offer)).toEqual({ type: "any" });
  });
});

describe("toGaeRankedOffer", () => {
  it("translates the offer into the GAE RankedOffer shape", () => {
    const offer = makeOffer();
    const ranked = toGaeRankedOffer(offer);
    expect(ranked).toEqual({
      id: offer.id,
      userId: offer.userId,
      showId: offer.showId,
      groupSize: 4,
      pricePerTicketCents: 4200,
      rankKey: 4200 * 1000 + 4,
      submittedAt: offer.submittedAt,
      tierPreference: { type: "this_or_worse", tier: "premium" },
    });
  });

  it("converts bigint rank_key to number (safe-int range for realistic offers)", () => {
    // Worst-case realistic offer: $1,000,000 × 10 seats → 100,000,000,010.
    // Number.MAX_SAFE_INTEGER is 2^53 - 1 ≈ 9e15, so we're 5 orders of
    // magnitude under. Test the conversion with a large but realistic
    // value.
    const offer = makeOffer({ rankKey: BigInt(100_000_000_010) });
    expect(toGaeRankedOffer(offer).rankKey).toBe(100_000_000_010);
  });

  it("does NOT leak private_threshold_cents or auto-bid fields into the GAE input", () => {
    // The GAE doesn't need to know about private offers or auto-bid —
    // both are post-allocation concerns (private affects what's
    // returned to other users; auto-bid affects displacement
    // resolution). Make sure we don't smuggle either into the input.
    const offer = makeOffer({
      privateThresholdCents: 5500,
      autoBidEnabled: true,
      autoBidCapCents: 8000,
    });
    const ranked = toGaeRankedOffer(offer);
    expect(ranked).not.toHaveProperty("privateThresholdCents");
    expect(ranked).not.toHaveProperty("autoBidEnabled");
    expect(ranked).not.toHaveProperty("autoBidCapCents");
  });
});

describe("toGaeVenueArchitecture", () => {
  function makeRow(overrides: Partial<VenueRow> = {}): VenueRow {
    return {
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
      ...overrides,
    };
  }

  function makeDbArch(
    overrides: Partial<DbVenueArchitecture> = {},
  ): DbVenueArchitecture {
    return {
      id: "33333333-3333-3333-3333-333333333333",
      venueId: "22222222-2222-2222-2222-222222222222",
      version: 1,
      rows: [makeRow()],
      createdAt: new Date("2026-05-01T00:00:00Z"),
      ...overrides,
    };
  }

  function makeShow(activeRowIds: string[]): Pick<Show, "activeRowIds"> {
    // shows.activeRowIds is jsonb (unknown in Drizzle); the repo narrows
    // to string[]. Tests pass the narrow type directly.
    return { activeRowIds } as unknown as Pick<Show, "activeRowIds">;
  }

  it("composes the GAE shape from the show + db architecture", () => {
    const arch = makeDbArch({
      venueId: "22222222-2222-2222-2222-222222222222",
      rows: [makeRow({ id: "row_a" }), makeRow({ id: "row_b" })],
    });
    const show = makeShow(["row_a", "row_b"]);
    const result = toGaeVenueArchitecture(show, arch);
    expect(result).toEqual({
      venueId: "22222222-2222-2222-2222-222222222222",
      rows: arch.rows,
      activeRowIds: ["row_a", "row_b"],
    });
  });

  it("carries the show's activeRowIds (not all architecture rows) for partial-venue shows", () => {
    // A 5-row venue used as a 2-row show — the GAE should only place
    // into the active subset (NEW-4).
    const arch = makeDbArch({
      rows: [
        makeRow({ id: "row_a" }),
        makeRow({ id: "row_b" }),
        makeRow({ id: "row_c" }),
        makeRow({ id: "row_d" }),
        makeRow({ id: "row_e" }),
      ],
    });
    const show = makeShow(["row_a", "row_b"]);
    const result = toGaeVenueArchitecture(show, arch);
    expect(result.activeRowIds).toEqual(["row_a", "row_b"]);
    expect(result.rows).toHaveLength(5);
  });
});
