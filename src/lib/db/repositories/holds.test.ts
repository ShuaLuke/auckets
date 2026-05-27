import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createHold,
  deleteHoldById,
  getHoldById,
  listHoldsForShow,
  type Hold,
} from "./holds";
import { makeMockDb } from "./_mock-db";

const HOLD: Hold = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  showId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  source: "Artist comp",
  kind: "artist",
  venueRowId: "row_f",
  seatNumbers: ["5", "6", "7", "8"],
  notes: null,
  createdAt: new Date("2026-05-27T11:00:00Z"),
};

// Same mock-Db caveat as the other repo tests: these verify SHAPE,
// not SQL semantics. Real INSERT/DELETE … RETURNING behavior is
// exercised by the Vercel preview environment.

describe("listHoldsForShow", () => {
  it("returns the rows the query returns", async () => {
    const db = makeMockDb([HOLD]);
    expect(await listHoldsForShow(db, HOLD.showId)).toEqual([HOLD]);
  });

  it("has the expected return type", () => {
    expectTypeOf(listHoldsForShow).returns.resolves.toEqualTypeOf<Hold[]>();
  });
});

describe("getHoldById", () => {
  it("returns the row when found", async () => {
    const db = makeMockDb([HOLD]);
    expect(await getHoldById(db, HOLD.id)).toEqual(HOLD);
  });

  it("returns null when no row matches", async () => {
    const db = makeMockDb<Hold>([]);
    expect(await getHoldById(db, "missing")).toBeNull();
  });
});

describe("createHold", () => {
  it("returns the inserted row", async () => {
    const db = makeMockDb([HOLD]);
    const row = await createHold(db, {
      showId: HOLD.showId,
      source: HOLD.source,
      kind: "artist",
      venueRowId: HOLD.venueRowId,
      seatNumbers: HOLD.seatNumbers,
    });
    expect(row).toEqual(HOLD);
  });

  it("passes optional notes through", async () => {
    const withNotes: Hold = { ...HOLD, notes: "Family + 2" };
    const db = makeMockDb([withNotes]);
    const row = await createHold(db, {
      showId: HOLD.showId,
      source: HOLD.source,
      kind: "artist",
      venueRowId: HOLD.venueRowId,
      seatNumbers: HOLD.seatNumbers,
      notes: "Family + 2",
    });
    expect(row.notes).toBe("Family + 2");
  });

  it("throws when the INSERT … RETURNING comes back empty", async () => {
    const db = makeMockDb<Hold>([]);
    await expect(
      createHold(db, {
        showId: HOLD.showId,
        source: HOLD.source,
        kind: "artist",
        venueRowId: HOLD.venueRowId,
        seatNumbers: HOLD.seatNumbers,
      }),
    ).rejects.toThrow(/no row returned/);
  });
});

describe("deleteHoldById", () => {
  it("returns the deleted row when one matched", async () => {
    const db = makeMockDb([HOLD]);
    expect(await deleteHoldById(db, HOLD.id)).toEqual(HOLD);
  });

  it("returns null when no row matched (already deleted or bogus id)", async () => {
    const db = makeMockDb<Hold>([]);
    expect(await deleteHoldById(db, "missing")).toBeNull();
  });

  it("has the expected return type", () => {
    expectTypeOf(deleteHoldById).returns.resolves.toEqualTypeOf<Hold | null>();
  });
});
