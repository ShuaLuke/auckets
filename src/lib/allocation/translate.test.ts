import { describe, expect, it } from "vitest";

import type {
  VenueArchitecture as DbVenueArchitecture,
} from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import type { offers, shows } from "../../../drizzle/schema";

import {
  mergeShowHoldsIntoArchitecture,
  toGaeRankedOffer,
  toGaeTierPreference,
  toGaeVenueArchitecture,
  type ShowHoldSeats,
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
    stripePaymentIntentId: null,
    status: "pool",
    submittedAt: new Date("2026-05-26T12:00:00Z"),
    recoveringAt: null,
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

describe("mergeShowHoldsIntoArchitecture", () => {
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

  function makeDbArch(rows: VenueRow[]): DbVenueArchitecture {
    return {
      id: "33333333-3333-3333-3333-333333333333",
      venueId: "22222222-2222-2222-2222-222222222222",
      version: 1,
      rows,
      createdAt: new Date("2026-05-01T00:00:00Z"),
    };
  }

  function hold(venueRowId: string, seatNumbers: string[]): ShowHoldSeats {
    return { venueRowId, seatNumbers };
  }

  it("returns the architecture unchanged (same reference) when there are no per-show holds", () => {
    const arch = makeDbArch([makeRow({ holds: ["3"] })]);
    expect(mergeShowHoldsIntoArchitecture(arch, [])).toBe(arch);
  });

  it("adds per-show held seats to a row with no building holds", () => {
    const arch = makeDbArch([makeRow()]);
    const merged = mergeShowHoldsIntoArchitecture(arch, [
      hold("row_a", ["4", "5"]),
    ]);
    expect(merged.rows[0]?.holds).toEqual(["4", "5"]);
  });

  it("unions per-show holds with building holds — overlap does not duplicate", () => {
    // Building hold on 3+4, artist comp on 4+5: the merged holds must be
    // {3,4,5} exactly once each. A duplicate would corrupt the GAE's
    // available-capacity math (capacity - holds.length).
    const arch = makeDbArch([makeRow({ holds: ["3", "4"] })]);
    const merged = mergeShowHoldsIntoArchitecture(arch, [
      hold("row_a", ["4", "5"]),
    ]);
    expect(merged.rows[0]?.holds).toEqual(["3", "4", "5"]);
  });

  it("unions multiple per-show hold rows targeting the same venue row", () => {
    const arch = makeDbArch([makeRow()]);
    const merged = mergeShowHoldsIntoArchitecture(arch, [
      hold("row_a", ["2"]),
      hold("row_a", ["7", "2"]),
    ]);
    expect(merged.rows[0]?.holds).toEqual(["2", "7"]);
  });

  it("keeps merged holds a subset of seatNumbers — malformed seat references are dropped", () => {
    // A hold on a seat the row doesn't have (e.g. seat renumbered in a
    // newer architecture version) must not inflate holds.length, which
    // the GAE subtracts from capacity.
    const arch = makeDbArch([makeRow()]);
    const merged = mergeShowHoldsIntoArchitecture(arch, [
      hold("row_a", ["7", "99", ""]),
    ]);
    expect(merged.rows[0]?.holds).toEqual(["7"]);
  });

  it("ignores holds referencing a venueRowId not in the architecture", () => {
    const arch = makeDbArch([makeRow()]);
    const merged = mergeShowHoldsIntoArchitecture(arch, [
      hold("row_zz", ["1", "2"]),
    ]);
    expect(merged.rows[0]?.holds).toEqual([]);
  });

  it("leaves untouched rows reference-identical and other architecture fields intact", () => {
    const rowA = makeRow({ id: "row_a" });
    const rowB = makeRow({ id: "row_b" });
    const arch = makeDbArch([rowA, rowB]);
    const merged = mergeShowHoldsIntoArchitecture(arch, [
      hold("row_b", ["1"]),
    ]);
    expect(merged.rows[0]).toBe(rowA);
    expect(merged.id).toBe(arch.id);
    expect(merged.venueId).toBe(arch.venueId);
    expect(merged.version).toBe(arch.version);
  });

  it("does not mutate the input architecture or its rows", () => {
    const arch = makeDbArch([makeRow({ holds: ["3"] })]);
    mergeShowHoldsIntoArchitecture(arch, [hold("row_a", ["4"])]);
    expect(arch.rows[0]?.holds).toEqual(["3"]);
  });

  it("merges holds on rows regardless of activation — inactive rows are harmless", () => {
    // The function doesn't know about activeRowIds; a hold filed on a
    // row the show later deactivated should merge without error (the
    // GAE skips inactive rows entirely).
    const arch = makeDbArch([
      makeRow({ id: "row_a" }),
      makeRow({ id: "row_inactive" }),
    ]);
    const merged = mergeShowHoldsIntoArchitecture(arch, [
      hold("row_inactive", ["1"]),
    ]);
    expect(merged.rows[1]?.holds).toEqual(["1"]);
  });

  it("orders merged holds by the row's seat order, not hold-insertion order", () => {
    const arch = makeDbArch([makeRow({ holds: ["6"] })]);
    const merged = mergeShowHoldsIntoArchitecture(arch, [
      hold("row_a", ["8", "2"]),
    ]);
    expect(merged.rows[0]?.holds).toEqual(["2", "6", "8"]);
  });
});
