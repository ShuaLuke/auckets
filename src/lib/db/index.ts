import { drizzle } from "drizzle-orm/postgres-js";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import * as schema from "../../../drizzle/schema";
import { createDeadlineClient } from "./deadline-client";

/**
 * Singleton Drizzle client. Per docs/CONVENTIONS.md: one client for the whole
 * app, imported from here. Never instantiate `postgres()` or `drizzle()`
 * elsewhere.
 *
 * `prepare: false` is required for transaction-pooler connections (Supabase
 * pgbouncer in transaction mode). If you're connecting to a session-pooler or
 * direct connection, prepared statements are fine and faster — revisit when
 * we have a clearer picture of which connection string we're using where.
 *
 * Serverless posture (Vercel): each warm lambda gets its own copy of this
 * module, so the pool size here is PER LAMBDA, not per app. postgres.js
 * defaults to max:10 — a handful of warm lambdas would quietly eat the
 * direct-connection limit (~60 on our Supabase tier) and new lambdas would
 * start failing to connect under load. So:
 *
 *   max: 1           — one connection per lambda. Vercel functions serve one
 *                      request at a time, and the app awaits queries
 *                      sequentially (no `db.` calls nested inside
 *                      `db.transaction` callbacks — keep it that way, that
 *                      pattern would deadlock a 1-connection pool). Queries
 *                      issued concurrently just queue. Integration tests run
 *                      with fileParallelism:false, so they're fine too.
 *   idle_timeout: 20 — (seconds) release the connection when a lambda goes
 *                      cold-ish instead of holding it until Postgres reaps it.
 *   connect_timeout: 10 — (seconds) fail fast with a clear error if the DB is
 *                      unreachable, instead of hanging a request to the
 *                      function timeout.
 *   max_lifetime: 300 — (seconds) no connection outlives 5 minutes. A warm
 *                      lambda can live for hours, and the longer a connection
 *                      sits across freeze/thaw cycles the better its odds of
 *                      ending up wedged (see below). Note this only recycles
 *                      BETWEEN queries — postgres.js defers the close while a
 *                      query is in flight — so it bounds connection age but
 *                      cannot unstick a wedge by itself.
 *
 * The wedge (prod, 2026-06-12, twice): a warm lambda's connection got stuck
 * mid-protocol — `pg_stat_activity` showed the Supavisor connection `active`
 * + `wait_event ClientRead` for minutes (the server waiting on bytes WE never
 * sent, almost certainly a lambda frozen with protocol bytes in flight).
 * Every route served by that lambda then hung with zero bytes until the
 * backend was killed by hand. No server-side timeout can fix that — the
 * server isn't executing anything, it's waiting on us — and postgres.js has
 * no built-in query timeout. So the client is wrapped with CLIENT-SIDE
 * deadlines (see ./deadline-client.ts):
 *
 *   - queries are issued strictly ONE AT A TIME per client — no pipelining.
 *     postgres.js otherwise writes concurrently-issued queries (a page's
 *     Promise.all) onto the wire while one is still in flight, and pipelined
 *     extended-protocol traffic through transaction-mode Supavisor is the
 *     suspected wedge trigger: the 2026-06-12 recurrence wedged on exactly
 *     the second query of /shows/new's Promise.all. Costs ~1-2ms per query
 *     (same-region pooler); removes the trigger instead of just surviving it;
 *   - every query rejects after 15s instead of hanging forever;
 *   - a whole transaction rejects after 60s (covers BEGIN/COMMIT, which
 *     postgres.js issues internally where the per-query wrap can't see them);
 *   - on any blown deadline we assume the connection is wedged: a fresh
 *     client is swapped in for subsequent requests and the old one is
 *     destroyed via `end({ timeout: 0 })`, which force-rejects anything still
 *     queued on it. The one stuck request fails fast; the lambda heals
 *     instead of staying pinned until someone runs `pg_terminate_backend`.
 *
 * The exported `db` is a thin proxy over the CURRENT Drizzle instance so the
 * heal can swap clients without anyone re-importing. Don't capture
 * `db.<method>` into long-lived variables; call through `db` each time.
 */

const PG_OPTIONS = {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 300,
};

function connect() {
  const { client, raw } = createDeadlineClient(env.DATABASE_URL, PG_OPTIONS, {
    onDeadline({ scope, ms }) {
      // Two queued queries can both blow their deadlines; only the first one
      // gets to heal — the second must not destroy the fresh client.
      if (active.raw !== raw) return;
      logger.error(
        { scope, deadlineMs: ms },
        "db deadline exceeded — replacing the postgres client (wedged socket suspected)",
      );
      active = connect();
      void raw.end({ timeout: 0 }).catch(() => {});
    },
  });
  return { raw, db: drizzle(client, { schema }) };
}

let active = connect();

type DrizzleDb = ReturnType<typeof connect>["db"];

export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    const value = Reflect.get(active.db, prop) as unknown;
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(active.db)
      : value;
  },
  has(_target, prop) {
    return Reflect.has(active.db, prop);
  },
});

export type Db = typeof db;
