CREATE TABLE "displacement_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "displacement_events" ADD CONSTRAINT "displacement_events_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "displacement_events" ADD CONSTRAINT "displacement_events_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "displacement_events" ADD CONSTRAINT "displacement_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "displacement_events_user_ack_idx" ON "displacement_events" USING btree ("user_id","acknowledged_at","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "displacement_events_offer_created_idx" ON "displacement_events" USING btree ("offer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- Deny-all RLS posture (CLAUDE.md / SECURITY.md rule 26): every public table
-- has RLS enabled with no policy, so a leaked anon key gets nothing via
-- PostgREST. The app reaches this table only through the server-side Drizzle
-- (owner) connection, which bypasses RLS. No policy is added — the
-- rls_enabled_no_policy advisor on this table is the intended state.
ALTER TABLE "displacement_events" ENABLE ROW LEVEL SECURITY;