import { describe, expect, expectTypeOf, it } from "vitest";

import { users } from "../../../../drizzle/schema";
import { ensureUserMirror } from "./users";
import { makeQueuedMockDb } from "./_mock-db";

type User = typeof users.$inferSelect;

const COPE_USER: User = {
  id: "user_2abc",
  email: "cope@example.com",
  phone: null,
  stripeCustomerId: null,
  cardLast4: null,
  cardBrand: null,
  role: "FAN",
  bondScore: 0,
  createdAt: new Date("2026-05-01T00:00:00Z"),
};

describe("ensureUserMirror", () => {
  it("returns the canonical row after upsert (read-after-write pattern)", async () => {
    // The mock-Db doesn't actually evaluate ON CONFLICT DO NOTHING,
    // but the shape contract is: insert (or no-op) followed by a
    // fresh SELECT. We pre-populate the SELECT result so the function
    // returns the queued row regardless of whether the row was newly
    // inserted or pre-existing.
    const db = makeQueuedMockDb<User>([
      // Insert-result slot — Drizzle's insert() chain doesn't await a
      // value array via the mock; the mock just resolves to whatever
      // we queue. Empty is fine here.
      [],
      // Select-result slot — the row the function returns to the
      // caller.
      [COPE_USER],
    ]);
    const result = await ensureUserMirror(db, {
      id: "user_2abc",
      email: "cope@example.com",
    });
    expect(result).toEqual(COPE_USER);
  });

  it("throws when the post-upsert read returns no row (shouldn't happen, but loud-fail)", async () => {
    const db = makeQueuedMockDb<User>([[], []]);
    await expect(
      ensureUserMirror(db, { id: "user_missing", email: "x@example.com" }),
    ).rejects.toThrow(/row missing after upsert/);
  });

  it("has the expected return type", () => {
    expectTypeOf(ensureUserMirror).returns.resolves.toEqualTypeOf<User>();
  });
});
