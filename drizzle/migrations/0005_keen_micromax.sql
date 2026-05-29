CREATE TABLE "stripe_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payment_intent_id" text,
	"status" text DEFAULT 'received' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_pi_idx" ON "stripe_webhook_events" USING btree ("payment_intent_id");--> statement-breakpoint
-- Deny-all RLS posture (CLAUDE.md / SECURITY.md rule 26): RLS enabled, no
-- policy, so PostgREST/anon gets nothing. The app reaches this table only
-- through the server-side Drizzle (owner) connection, which bypasses RLS.
ALTER TABLE "stripe_webhook_events" ENABLE ROW LEVEL SECURITY;