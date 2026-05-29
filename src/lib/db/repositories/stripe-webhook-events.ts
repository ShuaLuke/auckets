// Receipt log for Stripe webhooks (stripe_webhook_events). Used by the
// webhook handler for idempotency + audit: Stripe can redeliver the same
// event, so we read the prior receipt, skip re-acting on one already in a
// terminal status, and record what we did. Repository returns raw rows.

import { eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { stripeWebhookEvents } from "../../../../drizzle/schema";

export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;

// Statuses we consider "done" — a redelivery in one of these is a no-op. A
// row left in 'received' or 'error' is reprocessed on Stripe's retry.
export const WEBHOOK_TERMINAL_STATUSES = ["processed", "ignored"] as const;

export async function getWebhookEvent(
  db: Db,
  eventId: string,
): Promise<StripeWebhookEvent | null> {
  const rows = await db
    .select()
    .from(stripeWebhookEvents)
    .where(eq(stripeWebhookEvents.eventId, eventId))
    .limit(1);
  return rows[0] ?? null;
}

// Claim an event for processing. Inserts a 'received' row; on a duplicate
// id (concurrent redelivery) the insert is a no-op. Returns true when this
// caller created the row (won the claim), false when it already existed.
export async function recordWebhookReceived(
  db: Db,
  params: { eventId: string; type: string; paymentIntentId: string | null },
): Promise<boolean> {
  const inserted = await db
    .insert(stripeWebhookEvents)
    .values({
      eventId: params.eventId,
      type: params.type,
      paymentIntentId: params.paymentIntentId,
      status: "received",
    })
    .onConflictDoNothing({ target: stripeWebhookEvents.eventId })
    .returning({ eventId: stripeWebhookEvents.eventId });
  return inserted.length > 0;
}

// Finalize an event's receipt with the outcome of processing.
export async function markWebhookEvent(
  db: Db,
  eventId: string,
  status: "processed" | "ignored" | "error",
  note?: string,
): Promise<void> {
  await db
    .update(stripeWebhookEvents)
    .set({
      status,
      note: note ?? null,
      processedAt: new Date(),
    })
    .where(eq(stripeWebhookEvents.eventId, eventId));
}
