// Read + lazy-write queries for the local users table.
//
// Most user data is owned by Clerk; the local mirror exists for FK
// targets (offers.user_id, etc.) and for the role field used in
// authorization. See drizzle/schema.ts §1.
//
// Mirror strategy: lazy. The first time a user takes an action that
// needs a local row (e.g. submitting an offer), the route handler
// calls ensureUserMirror with their Clerk user_id + email. This avoids
// requiring a webhook tunnel for local dev. The Clerk webhook
// alternative is the right long-term design — it keeps the email
// fresh on change — and replaces this lazy path when it lands.

import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { users } from "../../../../drizzle/schema";

type User = typeof users.$inferSelect;

// Upsert the local users row for a Clerk-authenticated user.
//
// On conflict (id), DO NOTHING — never overwrite the existing email or
// role. Stale emails are a Clerk-webhook concern; this helper's only
// job is "make sure the row exists so the FK doesn't fail."
//
// Returns the resulting row (the inserted one OR the pre-existing one
// if there was a conflict).
export async function ensureUserMirror(
  db: Db,
  params: { id: string; email: string },
): Promise<User> {
  await db
    .insert(users)
    .values({ id: params.id, email: params.email })
    .onConflictDoNothing({ target: users.id });

  // Re-read so the caller gets the canonical row, including any
  // server-defaulted fields (role default 'FAN', bond_score default 0,
  // created_at, etc.). One extra read keeps the function's return type
  // simple — Drizzle's RETURNING is supported but skipping it keeps
  // the function shape symmetric with the rest of the repo layer
  // (read functions all hand back the row from a fresh SELECT).
  const rows = await db.select().from(users).where(eq(users.id, params.id)).limit(1);
  const row = rows[0];
  if (!row) {
    // Shouldn't happen — we just inserted (or no-oped on conflict with
    // an existing row). Surface loudly rather than returning a wrong
    // shape.
    throw new Error(`ensureUserMirror: row missing after upsert for id=${params.id}`);
  }
  return row;
}

// Persist a freshly-created Stripe Customer ID onto the user's row.
// Called once, right after ensureStripeCustomer creates a new Customer
// on the fan's first real-path offer. The UPDATE is unconditional so a
// re-call just rewrites the same value (harmless).
export async function setStripeCustomerId(
  db: Db,
  userId: string,
  stripeCustomerId: string,
): Promise<void> {
  await db.update(users).set({ stripeCustomerId }).where(eq(users.id, userId));
}

// Authorization helper for AUCKETS-only endpoints (allocation,
// admin-triggered pause/end-early per ADR-0013, etc.). Returns true
// IFF the user exists AND has role AUCKETS_ADMIN — a missing user row
// is implicitly "not admin" rather than an error, because callers are
// already responsible for checking auth() first.
//
// This is distinct from userCanManageArtist (artists repo), which adds
// the artist-member path. Admins pass that helper too, but if you only
// need the platform-wide admin check, this is the lighter query.
export async function userIsAdmin(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.role, "AUCKETS_ADMIN")))
    .limit(1);
  return rows.length > 0;
}

// Batch email lookup keyed by Clerk user_id. Used by the admin inbox
// presenter to resolve the executor's email without growing the inbox
// query into a second users-self-join. Empty input short-circuits to
// an empty map — Postgres rejects `WHERE id IN ()`.
export async function getEmailsByUserIds(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, [...ids]));
  for (const row of rows) out.set(row.id, row.email);
  return out;
}
