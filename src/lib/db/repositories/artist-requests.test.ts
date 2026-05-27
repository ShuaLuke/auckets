import { describe, expect, expectTypeOf, it } from "vitest";

import { artistRequests } from "../../../../drizzle/schema";
import {
  createArtistRequest,
  denyArtistRequest,
  executeArtistRequest,
  isArtistRequestFiledBy,
  listArtistRequestsForAdminInbox,
  listArtistRequestsForShow,
  listOpenArtistRequests,
  type ArtistRequest,
  type ArtistRequestInboxRow,
} from "./artist-requests";
import { makeMockDb } from "./_mock-db";

const REQUEST: ArtistRequest = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  showId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  requestedBy: "user_2abc",
  kind: "comp",
  details: "Comp 4 to Cope's manager",
  status: "open",
  executedBy: null,
  executedAt: null,
  notes: null,
  createdAt: new Date("2026-05-27T11:00:00Z"),
};

// Mock-db caveat (per CLAUDE.md): these tests verify SHAPE — that each
// function calls the expected chain and returns the right type — not
// SQL semantics. Conditional updates, joins, and ordering are exercised
// by the real DB in CI integration tests once the local pooler is
// unblocked.

describe("createArtistRequest", () => {
  it("returns the inserted row", async () => {
    const db = makeMockDb([REQUEST]);
    const row = await createArtistRequest(db, {
      showId: REQUEST.showId,
      requestedBy: REQUEST.requestedBy,
      kind: "comp",
      details: REQUEST.details,
    });
    expect(row).toEqual(REQUEST);
  });

  it("throws when the INSERT … RETURNING comes back empty", async () => {
    const db = makeMockDb<typeof artistRequests.$inferSelect>([]);
    await expect(
      createArtistRequest(db, {
        showId: REQUEST.showId,
        requestedBy: REQUEST.requestedBy,
        kind: "comp",
        details: REQUEST.details,
      }),
    ).rejects.toThrow(/no row returned/);
  });
});

describe("listArtistRequestsForShow", () => {
  it("returns the rows the query returns", async () => {
    const db = makeMockDb([REQUEST]);
    expect(await listArtistRequestsForShow(db, REQUEST.showId)).toEqual([REQUEST]);
  });

  it("has the expected return type", () => {
    expectTypeOf(listArtistRequestsForShow).returns.resolves.toEqualTypeOf<
      ArtistRequest[]
    >();
  });
});

describe("listOpenArtistRequests", () => {
  it("returns the rows the query returns", async () => {
    const db = makeMockDb([REQUEST]);
    expect(await listOpenArtistRequests(db)).toEqual([REQUEST]);
  });
});

describe("isArtistRequestFiledBy", () => {
  it("returns true when the row matches", async () => {
    const db = makeMockDb([{ id: REQUEST.id }]);
    expect(await isArtistRequestFiledBy(db, REQUEST.id, REQUEST.requestedBy)).toBe(
      true,
    );
  });

  it("returns false when no row matches", async () => {
    const db = makeMockDb([]);
    expect(await isArtistRequestFiledBy(db, REQUEST.id, "someone-else")).toBe(
      false,
    );
  });
});

describe("listArtistRequestsForAdminInbox", () => {
  const INBOX_ROW: ArtistRequestInboxRow = {
    ...REQUEST,
    filerEmail: "cope@auckets.com",
    showVenueName: "Lincoln Theatre",
    showVenueCity: "Washington, DC",
    showDoorsAt: new Date("2026-06-15T23:00:00Z"),
    artistId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    artistName: "Citizen Cope",
  };

  it("returns the joined rows the query returns", async () => {
    const db = makeMockDb([INBOX_ROW]);
    expect(await listArtistRequestsForAdminInbox(db, "open")).toEqual([
      INBOX_ROW,
    ]);
  });

  it("has the expected return type", () => {
    expectTypeOf(listArtistRequestsForAdminInbox).returns.resolves.toEqualTypeOf<
      ArtistRequestInboxRow[]
    >();
  });
});

describe("executeArtistRequest", () => {
  it("returns the updated row when the conditional UPDATE hits", async () => {
    const updated: ArtistRequest = {
      ...REQUEST,
      status: "executed",
      executedBy: "user_2admin",
      executedAt: new Date("2026-05-27T11:15:00Z"),
      notes: "Comped row F seats 5-8.",
    };
    const db = makeMockDb([updated]);
    const row = await executeArtistRequest(db, {
      requestId: REQUEST.id,
      executorId: "user_2admin",
      notes: "Comped row F seats 5-8.",
    });
    expect(row).toEqual(updated);
  });

  it("returns null when the conditional UPDATE matched no row (already actioned or missing)", async () => {
    const db = makeMockDb<ArtistRequest>([]);
    const row = await executeArtistRequest(db, {
      requestId: REQUEST.id,
      executorId: "user_2admin",
    });
    expect(row).toBeNull();
  });

  it("has the expected return type", () => {
    expectTypeOf(executeArtistRequest).returns.resolves.toEqualTypeOf<
      ArtistRequest | null
    >();
  });
});

describe("denyArtistRequest", () => {
  it("returns the updated row when the conditional UPDATE hits", async () => {
    const updated: ArtistRequest = {
      ...REQUEST,
      status: "denied",
      executedBy: "user_2admin",
      executedAt: new Date("2026-05-27T11:15:00Z"),
      notes: "Can't comp inside the binding window.",
    };
    const db = makeMockDb([updated]);
    const row = await denyArtistRequest(db, {
      requestId: REQUEST.id,
      executorId: "user_2admin",
      notes: "Can't comp inside the binding window.",
    });
    expect(row).toEqual(updated);
  });

  it("returns null when the conditional UPDATE matched no row", async () => {
    const db = makeMockDb<ArtistRequest>([]);
    const row = await denyArtistRequest(db, {
      requestId: REQUEST.id,
      executorId: "user_2admin",
      notes: "n/a",
    });
    expect(row).toBeNull();
  });
});
