import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "../../../drizzle/schema";

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
 */
const client = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

export type Db = typeof db;
