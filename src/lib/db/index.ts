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
 */
const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });

export type Db = typeof db;
