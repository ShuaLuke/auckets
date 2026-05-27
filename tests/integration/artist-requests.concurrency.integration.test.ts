// Integration coverage for the conditional-UPDATE concurrency guard in
// executeArtistRequest and denyArtistRequest. PR #46 documents these as
// safe under concurrent admin clicks via WHERE status='open'; mock-DB
// tests can't exercise that — the chain ignores the .where() entirely.
//
// What we prove here:
//   - A single execute on an open request returns the row.
//   - A second execute on the now-executed request returns null (status
//     is no longer 'open', so the UPDATE matches zero rows).
//   - Two concurrent executes against the same open request: exactly one
//     wins and gets the row, the other gets null. This is the race the
//     guard is designed to prevent.
//   - Same shape for deny.
//   - execute on a denied request returns null (and vice versa) — neither
//     terminal state can be retroactively flipped.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  createArtistRequest,
  denyArtistRequest,
  executeArtistRequest,
} from "@/lib/db/repositories/artist-requests";
import { artistRequests } from "../../drizzle/schema";

import { seedShow, seedUser } from "./helpers";

async function seedOpenRequest(): Promise<{ requestId: string; operatorId: string }> {
  const requester = await seedUser({ role: "ARTIST" });
  const operator = await seedUser({ role: "AUCKETS_ADMIN" });
  const { show } = await seedShow();

  const request = await createArtistRequest(db, {
    showId: show.id,
    requestedBy: requester.id,
    kind: "pause",
    details: "Smoke alarm sweep at the venue, pause through 8pm.",
  });

  return { requestId: request.id, operatorId: operator.id };
}

describe("artist-requests concurrency guard (integration)", () => {
  it("executeArtistRequest on an open request returns the executed row", async () => {
    const { requestId, operatorId } = await seedOpenRequest();

    const result = await executeArtistRequest(db, {
      requestId,
      executorId: operatorId,
    });

    expect(result?.id).toBe(requestId);
    expect(result?.status).toBe("executed");
    expect(result?.executedBy).toBe(operatorId);
    expect(result?.executedAt).toBeInstanceOf(Date);
  });

  it("executeArtistRequest on an already-executed request returns null (the WHERE status='open' guard fires)", async () => {
    const { requestId, operatorId } = await seedOpenRequest();

    const first = await executeArtistRequest(db, { requestId, executorId: operatorId });
    expect(first).not.toBeNull();

    const second = await executeArtistRequest(db, {
      requestId,
      executorId: operatorId,
      notes: "second click",
    });
    expect(second).toBeNull();

    // And the row didn't get re-stamped — original executedAt + null notes
    // (the second call set notes:"second click" in its SET clause but the
    // WHERE matched zero rows, so nothing was written).
    const rows = await db
      .select()
      .from(artistRequests)
      .where(eq(artistRequests.id, requestId));
    expect(rows[0]?.notes).toBeNull();
  });

  it("two concurrent executeArtistRequest calls: exactly one wins, the other returns null", async () => {
    const { requestId, operatorId } = await seedOpenRequest();

    // Fire both updates in parallel against the same open request. The
    // conditional WHERE serializes them — Postgres row-level locks
    // (acquired by UPDATE) make the second one re-read the row after the
    // first commits, see status='executed', and match zero rows.
    const [a, b] = await Promise.all([
      executeArtistRequest(db, { requestId, executorId: operatorId, notes: "A" }),
      executeArtistRequest(db, { requestId, executorId: operatorId, notes: "B" }),
    ]);

    const winners = [a, b].filter((r) => r !== null);
    const losers = [a, b].filter((r) => r === null);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(winners[0]?.status).toBe("executed");
  });

  it("denyArtistRequest on an open request returns the denied row, and a second deny returns null", async () => {
    const { requestId, operatorId } = await seedOpenRequest();

    const first = await denyArtistRequest(db, {
      requestId,
      executorId: operatorId,
      notes: "duplicate of #1234",
    });
    expect(first?.status).toBe("denied");
    expect(first?.notes).toBe("duplicate of #1234");

    const second = await denyArtistRequest(db, {
      requestId,
      executorId: operatorId,
      notes: "second click",
    });
    expect(second).toBeNull();
  });

  it("executeArtistRequest cannot flip a denied request, and denyArtistRequest cannot flip an executed one", async () => {
    const { requestId: executedId, operatorId } = await seedOpenRequest();
    await executeArtistRequest(db, { requestId: executedId, executorId: operatorId });

    const flipDenied = await denyArtistRequest(db, {
      requestId: executedId,
      executorId: operatorId,
      notes: "trying to deny after execute",
    });
    expect(flipDenied).toBeNull();

    const { requestId: deniedId } = await seedOpenRequest();
    await denyArtistRequest(db, {
      requestId: deniedId,
      executorId: operatorId,
      notes: "denied first",
    });

    const flipExecuted = await executeArtistRequest(db, {
      requestId: deniedId,
      executorId: operatorId,
    });
    expect(flipExecuted).toBeNull();
  });
});
