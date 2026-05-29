// Read-path + acknowledge queries for displacement_events — the per-fan
// alert log written by the displacement engine (ADR-0018 §4). Rows are
// written by run-preview / run-binding inside their allocation transaction;
// this module only reads them and stamps acknowledged_at when a fan dismisses
// an in-app alert. Repository returns raw DB shapes; copy lives in a presenter.

import { and, desc, eq, isNull } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { displacementEvents } from "../../../../drizzle/schema";

export type DisplacementEvent = typeof displacementEvents.$inferSelect;

// The fan's in-app inbox: their unacknowledged alerts, newest first. The
// toast/banner renders from this.
export async function listUnacknowledgedDisplacementEventsForUser(
  db: Db,
  userId: string,
  limit = 20,
): Promise<DisplacementEvent[]> {
  return db
    .select()
    .from(displacementEvents)
    .where(
      and(
        eq(displacementEvents.userId, userId),
        isNull(displacementEvents.acknowledgedAt),
      ),
    )
    .orderBy(desc(displacementEvents.createdAt))
    .limit(limit);
}

// Dedup input for run-preview: the most-recent auto_bid_raise target
// (detail.toCents) per offer for a show, so a re-run that recomputes the same
// raise doesn't re-alert. Reads the auto_bid_raise rows newest-first and keeps
// the first (latest) seen per offer.
export async function getLatestRaiseTargetsByOfferForShow(
  db: Db,
  showId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      offerId: displacementEvents.offerId,
      detail: displacementEvents.detail,
    })
    .from(displacementEvents)
    .where(
      and(
        eq(displacementEvents.showId, showId),
        eq(displacementEvents.kind, "auto_bid_raise"),
      ),
    )
    .orderBy(desc(displacementEvents.createdAt));

  const byOffer = new Map<string, number>();
  for (const row of rows) {
    if (byOffer.has(row.offerId)) continue; // first seen = latest (desc order)
    const toCents = (row.detail as { toCents?: unknown }).toCents;
    if (typeof toCents === "number") byOffer.set(row.offerId, toCents);
  }
  return byOffer;
}

// Dismiss an in-app alert. Scoped to the owning user so one fan can't
// acknowledge another's alert. Returns the number of rows updated (0 = not
// found or not theirs). Idempotent: re-acknowledging an already-acknowledged
// row is a no-op match (acknowledged_at stays its original value via the
// isNull guard) — callers treat 0-or-1 as success.
export async function acknowledgeDisplacementEvent(
  db: Db,
  eventId: string,
  userId: string,
): Promise<number> {
  const updated = await db
    .update(displacementEvents)
    .set({ acknowledgedAt: new Date() })
    .where(
      and(
        eq(displacementEvents.id, eventId),
        eq(displacementEvents.userId, userId),
        isNull(displacementEvents.acknowledgedAt),
      ),
    )
    .returning({ id: displacementEvents.id });
  return updated.length;
}
