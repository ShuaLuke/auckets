import postgres from "postgres";

/**
 * A postgres.js client wrapped with CLIENT-SIDE deadlines on every query and
 * transaction that Drizzle issues.
 *
 * Why client-side: the prod failure mode this exists for (2026-06-12) is a
 * socket wedged mid-protocol — `pg_stat_activity` shows the backend `active` +
 * `wait_event = ClientRead`, i.e. the SERVER is waiting on US, so a
 * server-side `statement_timeout` never fires (and startup parameters are not
 * reliably honored through transaction-mode poolers like Supavisor anyway).
 * postgres.js itself has no per-query timeout: `idle_timeout`/`max_lifetime`
 * only recycle connections BETWEEN queries, and `query.cancel()` on an
 * in-flight query just sends a CancelRequest — the local promise keeps waiting
 * on the dead socket. The only thing that reliably unsticks a caller is a
 * deadline raced on the client, which is what this wrapper does.
 *
 * Coverage: Drizzle reaches postgres.js exclusively through `client.unsafe()`,
 * `client.begin(fn)` and (for nested transactions) `scoped.savepoint(fn)` —
 * see drizzle-orm/postgres-js/session. All three are wrapped here. The raw
 * template-tag form (sql`...`) is passed through untouched; app code never
 * uses it (docs/CONVENTIONS.md: everything goes through the Drizzle
 * singleton).
 *
 * On expiry the caller's promise rejects with `DbDeadlineError` and
 * `onDeadline` fires — the singleton in ./index.ts uses that hook to swap in a
 * fresh client and destroy the wedged one, so the lambda heals instead of
 * every subsequent request queueing behind the stuck max:1 connection.
 */

export class DbDeadlineError extends Error {
  constructor(scope: "query" | "transaction", ms: number) {
    super(
      `db ${scope} did not settle within ${ms}ms — failing fast instead of ` +
        `hanging the request (wedged socket suspected)`,
    );
    this.name = "DbDeadlineError";
  }
}

export interface DeadlineClientOptions {
  /** Per-query deadline, including queries inside transactions. Default 15s. */
  queryDeadlineMs?: number;
  /**
   * Whole-transaction deadline. Exists because BEGIN/COMMIT themselves are
   * issued by postgres.js internals (not via `unsafe`), so a wedge at either
   * end of a transaction is only caught by a deadline around the whole
   * `begin()` call. Default 60s — generous, it's a backstop.
   */
  transactionDeadlineMs?: number;
  /** Fires once per blown deadline, after the caller's promise rejects. */
  onDeadline?: (info: { scope: "query" | "transaction"; ms: number }) => void;
}

type AnyFn = (...args: unknown[]) => unknown;

export function createDeadlineClient(
  url: string,
  pgOptions: postgres.Options<Record<string, postgres.PostgresType>>,
  options: DeadlineClientOptions = {},
) {
  const raw = postgres(url, pgOptions);
  const queryMs = options.queryDeadlineMs ?? 15_000;
  const txMs = options.transactionDeadlineMs ?? 60_000;
  const onDeadline = options.onDeadline;

  function withDeadline<T>(
    pending: PromiseLike<T>,
    scope: "query" | "transaction",
    ms: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new DbDeadlineError(scope, ms));
        onDeadline?.({ scope, ms });
      }, ms);
    });
    // The race keeps a handler attached to `pending`, so when the wedged
    // query is later force-rejected (client teardown) there's no unhandled
    // rejection.
    return Promise.race([Promise.resolve(pending), expiry]).finally(() =>
      clearTimeout(timer),
    );
  }

  /**
   * postgres.js queries are lazy — execution starts the first time `.then` is
   * invoked (i.e. when awaited). Start the deadline clock at that moment, not
   * at build time. Chainable modifiers (`.values()` — the one Drizzle uses)
   * are re-wrapped so the eventual await still goes through the deadline.
   */
  function wrapQuery<T extends PromiseLike<unknown>>(query: T): T {
    let raced: Promise<unknown> | undefined;
    const start = () => (raced ??= withDeadline(query, "query", queryMs));
    return new Proxy(query as object, {
      get(target, prop) {
        if (prop === "then")
          return (res?: AnyFn, rej?: AnyFn) => start().then(res, rej);
        if (prop === "catch") return (rej?: AnyFn) => start().catch(rej);
        if (prop === "finally")
          return (fn?: () => void) => start().finally(fn);
        const value = Reflect.get(target, prop) as unknown;
        if (prop === "values" || prop === "raw" || prop === "simple") {
          return (...args: unknown[]) =>
            wrapQuery(
              (value as AnyFn).apply(target, args) as PromiseLike<unknown>,
            );
        }
        return typeof value === "function"
          ? (value as AnyFn).bind(target)
          : value;
      },
    }) as T;
  }

  /** Wrap the scoped `sql` postgres.js hands to begin/savepoint callbacks. */
  function wrapTxSql<T extends object>(scoped: T): T {
    return new Proxy(scoped, {
      get(target, prop) {
        const value = Reflect.get(target, prop) as unknown;
        if (prop === "unsafe") {
          return (...args: unknown[]) =>
            wrapQuery(
              (value as AnyFn).apply(target, args) as PromiseLike<unknown>,
            );
        }
        if (prop === "savepoint") {
          return (...args: unknown[]) => {
            const fn = args[args.length - 1];
            if (typeof fn !== "function")
              return (value as AnyFn).apply(target, args);
            return (value as AnyFn).apply(target, [
              ...args.slice(0, -1),
              (sp: object) => (fn as AnyFn)(wrapTxSql(sp)),
            ]);
          };
        }
        return typeof value === "function"
          ? (value as AnyFn).bind(target)
          : value;
      },
    });
  }

  const client = new Proxy(raw, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (prop === "unsafe") {
        return (...args: unknown[]) =>
          wrapQuery(
            (value as AnyFn).apply(target, args) as PromiseLike<unknown>,
          );
      }
      if (prop === "begin") {
        return (...args: unknown[]) => {
          const fn = args[args.length - 1];
          if (typeof fn !== "function")
            return (value as AnyFn).apply(target, args);
          return withDeadline(
            (value as AnyFn).apply(target, [
              ...args.slice(0, -1),
              (scoped: object) => (fn as AnyFn)(wrapTxSql(scoped)),
            ]) as PromiseLike<unknown>,
            "transaction",
            txMs,
          );
        };
      }
      return typeof value === "function"
        ? (value as AnyFn).bind(target)
        : value;
    },
  });

  return { client, raw };
}
