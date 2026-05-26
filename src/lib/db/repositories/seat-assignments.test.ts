import { describe, expect, expectTypeOf, it } from "vitest";

import {
  getProvisionalFilledByShow,
  getProvisionalFilledByShowIds,
  getSeatAssignmentByOfferId,
  listSeatAssignmentsByOfferIds,
  type SeatAssignment,
} from "./seat-assignments";
import { makeMockDb } from "./_mock-db";

function makeAssignment(overrides: Partial<SeatAssignment> = {}): SeatAssignment {
  return {
    id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    offerId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    showId: "44444444-4444-4444-4444-444444444444",
    venueRowId: "row_a",
    seatNumbers: ["7", "9", "11", "13"],
    tier: "premium",
    isBinding: false,
    stripePaymentIntentId: null,
    chargedAmountCents: null,
    cardFailureAt: null,
    createdAt: new Date("2026-05-26T12:00:00Z"),
    ...overrides,
  };
}

describe("getSeatAssignmentByOfferId", () => {
  it("returns null when the offer has no assignment", async () => {
    const db = makeMockDb<SeatAssignment>([]);
    expect(
      await getSeatAssignmentByOfferId(
        db,
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      ),
    ).toBeNull();
  });

  it("returns the assignment row when one exists", async () => {
    const assignment = makeAssignment();
    const db = makeMockDb<SeatAssignment>([assignment]);
    const result = await getSeatAssignmentByOfferId(db, assignment.offerId);
    expect(result).toEqual(assignment);
    expect(result?.seatNumbers).toEqual(["7", "9", "11", "13"]);
    // Raw enum/string; no formatting.
    expect(result?.tier).toBe("premium");
  });

  it("has the expected return type", () => {
    expectTypeOf(getSeatAssignmentByOfferId).returns.resolves.toEqualTypeOf<
      SeatAssignment | null
    >();
  });
});

describe("listSeatAssignmentsByOfferIds", () => {
  it("short-circuits to an empty map when no IDs are passed (skips the query)", async () => {
    // Without the short-circuit we'd emit `WHERE offer_id IN ()` which
    // Postgres rejects.
    const db = makeMockDb<SeatAssignment>([]);
    const result = await listSeatAssignmentsByOfferIds(db, []);
    expect(result.size).toBe(0);
  });

  it("returns a map keyed by offer_id when rows exist", async () => {
    const a = makeAssignment({
      offerId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
      venueRowId: "row_a",
    });
    const b = makeAssignment({
      offerId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
      venueRowId: "row_b",
    });
    const db = makeMockDb<SeatAssignment>([a, b]);
    const result = await listSeatAssignmentsByOfferIds(db, [a.offerId, b.offerId]);
    expect(result.size).toBe(2);
    expect(result.get(a.offerId)?.venueRowId).toBe("row_a");
    expect(result.get(b.offerId)?.venueRowId).toBe("row_b");
  });

  it("omits offers without an assignment (caller distinguishes unplaced vs placed)", async () => {
    // A's offer has an assignment; B's doesn't. The map only has A —
    // the route handler reads `map.get(offerId) ?? null` to fold the
    // missing case into the same shape as "no assignment yet."
    const a = makeAssignment({
      offerId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1",
    });
    const db = makeMockDb<SeatAssignment>([a]);
    const result = await listSeatAssignmentsByOfferIds(db, [
      a.offerId,
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2",
    ]);
    expect(result.size).toBe(1);
    expect(result.has(a.offerId)).toBe(true);
  });

  it("has the expected return type", () => {
    expectTypeOf(listSeatAssignmentsByOfferIds).returns.resolves.toEqualTypeOf<
      Map<string, SeatAssignment>
    >();
  });
});

describe("getProvisionalFilledByShow", () => {
  it("returns 0 when no seats are placed", async () => {
    // COALESCE in the SQL turns the SUM-of-empty NULL into 0.
    const db = makeMockDb<{ filled: number }>([{ filled: 0 }]);
    const result = await getProvisionalFilledByShow(
      db,
      "44444444-4444-4444-4444-444444444444",
    );
    expect(result).toBe(0);
  });

  it("returns the seat-level count when assignments exist", async () => {
    // 142 placed assignments × varying group sizes → 487 seats.
    const db = makeMockDb<{ filled: number }>([{ filled: 487 }]);
    const result = await getProvisionalFilledByShow(
      db,
      "44444444-4444-4444-4444-444444444444",
    );
    expect(result).toBe(487);
  });

  it("handles the no-row edge case (db returns []) without throwing", async () => {
    // Postgres normally returns one row with the aggregate. Defensive
    // path for a driver that ever returns no rows at all.
    const db = makeMockDb<{ filled: number }>([]);
    const result = await getProvisionalFilledByShow(
      db,
      "44444444-4444-4444-4444-444444444444",
    );
    expect(result).toBe(0);
  });

  it("has the expected return type", () => {
    expectTypeOf(getProvisionalFilledByShow).returns.resolves.toEqualTypeOf<number>();
  });
});

describe("getProvisionalFilledByShowIds", () => {
  it("returns an empty map when no IDs are passed", async () => {
    const db = makeMockDb<{ showId: string; filled: number }>([]);
    const result = await getProvisionalFilledByShowIds(db, []);
    expect(result.size).toBe(0);
  });

  it("backfills shows with no assignments to 0", async () => {
    // Only show-a has rows. show-b is requested but missing from the
    // GROUP BY result; backfill to 0 so the caller can map without
    // branching on missing keys.
    const db = makeMockDb<{ showId: string; filled: number }>([
      { showId: "show-a", filled: 487 },
    ]);
    const result = await getProvisionalFilledByShowIds(db, ["show-a", "show-b"]);
    expect(result.get("show-a")).toBe(487);
    expect(result.get("show-b")).toBe(0);
  });

  it("returns one entry per show when the DB returns multiple groups", async () => {
    const db = makeMockDb<{ showId: string; filled: number }>([
      { showId: "show-a", filled: 487 },
      { showId: "show-b", filled: 142 },
    ]);
    const result = await getProvisionalFilledByShowIds(db, ["show-a", "show-b"]);
    expect(result.size).toBe(2);
    expect(result.get("show-a")).toBe(487);
    expect(result.get("show-b")).toBe(142);
  });

  it("has the expected return type", () => {
    expectTypeOf(getProvisionalFilledByShowIds).returns.resolves.toEqualTypeOf<
      Map<string, number>
    >();
  });
});
