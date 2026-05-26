// Test-only Db stub. The Drizzle query builder is Promise-like (it implements
// `.then`), so to mock it we return an object that satisfies the chain calls
// our repositories use (.from, .innerJoin, .where, .limit, .orderBy,
// .groupBy, .values, .onConflictDoNothing, .onConflictDoUpdate, .returning)
// and resolves to a fixed result on await.
//
// We deliberately don't try to interpret eq()/and() conditions or
// onConflict targets — these mocks verify shape transformations and
// the existence of the right calls, not query correctness. SQL is
// verified by integration tests once the local DB connection is
// unblocked.

import type { Db } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeChain<T>(result: T[]): any {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: () => chain,
    orderBy: () => chain,
    groupBy: () => chain,
    // Write-path chain methods. Drizzle's insert/delete/update return
    // Promise-like query builders too — same .then(...) trick.
    values: () => chain,
    onConflictDoNothing: () => chain,
    onConflictDoUpdate: () => chain,
    set: () => chain,
    returning: () => chain,
    then: (onResolve: (value: T[]) => unknown) =>
      Promise.resolve(onResolve(result)),
  };
  return chain;
}

export function makeMockDb<T>(result: T[]): Db {
  const chain = makeChain<T>(result);
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
  } as unknown as Db;
}

// Returns a different result per successive top-level call (select /
// insert / update / delete) — useful when one repository function
// issues multiple independent operations (e.g. insert-then-select for
// upsert, or admin-then-membership for userCanManageArtist) and the
// test needs to distinguish them by call order. Once the queue is
// drained, further calls resolve to [].
export function makeQueuedMockDb<T>(results: T[][]): Db {
  let i = 0;
  const next = () => {
    const result = results[i] ?? [];
    i++;
    return makeChain<T>(result);
  };
  return {
    select: next,
    insert: next,
    update: next,
    delete: next,
  } as unknown as Db;
}
