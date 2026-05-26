// Test-only Db stub. The Drizzle query builder is Promise-like (it implements
// `.then`), so to mock it we return an object that satisfies the chain calls
// our repositories use (.from, .innerJoin, .where, .limit, .orderBy) and
// resolves to a fixed result on await.
//
// We deliberately don't try to interpret eq()/and() conditions — slice 2
// tests only verify shape transformation and null-on-empty. Real query
// behavior is verified later, once the local DB connection is unblocked.

import type { Db } from "@/lib/db";

export function makeMockDb<T>(result: T[]): Db {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: () => chain,
    orderBy: () => chain,
    then: (onResolve: (value: T[]) => unknown) =>
      Promise.resolve(onResolve(result)),
  };
  return {
    select: () => chain,
  } as unknown as Db;
}
