CREATE TABLE "allocation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"action" text NOT NULL,
	"offer_id" uuid,
	"venue_row_id" text,
	"seat_numbers" text[],
	"reason" text NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artist_members" (
	"artist_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"can_manage" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_members_artist_user_unique" UNIQUE("artist_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "artist_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"kind" text NOT NULL,
	"details" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"executed_by" text,
	"executed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"stripe_connect_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artists_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "bond_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"artist_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"show_id" uuid,
	"delta" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_idempotency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"show_id" uuid NOT NULL,
	"offer_id" uuid,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"channel" text DEFAULT 'market' NOT NULL,
	"group_size" integer NOT NULL,
	"price_per_ticket_cents" integer NOT NULL,
	"tier_preference" text NOT NULL,
	"preferred_tier" text,
	"rank_key" bigint GENERATED ALWAYS AS ((price_per_ticket_cents::bigint * 1000 + group_size)) STORED NOT NULL,
	"auto_bid_enabled" boolean DEFAULT false NOT NULL,
	"auto_bid_cap_cents" integer,
	"auto_bid_increment_cents" integer DEFAULT 500 NOT NULL,
	"private_threshold_cents" integer,
	"stripe_payment_method_id" text NOT NULL,
	"stripe_setup_intent_id" text NOT NULL,
	"status" text DEFAULT 'pool' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revised_at" timestamp with time zone,
	CONSTRAINT "offers_show_user_unique" UNIQUE("show_id","user_id"),
	CONSTRAINT "offers_group_size_check" CHECK ("offers"."group_size" BETWEEN 1 AND 10),
	CONSTRAINT "offers_price_positive_check" CHECK ("offers"."price_per_ticket_cents" > 0),
	CONSTRAINT "offers_auto_bid_cap_check" CHECK ("offers"."auto_bid_enabled" = false OR ("offers"."auto_bid_cap_cents" IS NOT NULL AND "offers"."auto_bid_cap_cents" >= "offers"."price_per_ticket_cents"))
);
--> statement-breakpoint
CREATE TABLE "resales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"original_offer_id" uuid NOT NULL,
	"new_offer_id" uuid,
	"original_price_cents" integer NOT NULL,
	"new_price_cents" integer,
	"artist_appreciation_cents" integer DEFAULT 0 NOT NULL,
	"kind" text NOT NULL,
	"recipient_email" text,
	"status" text DEFAULT 'listed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seat_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"show_id" uuid NOT NULL,
	"venue_row_id" text NOT NULL,
	"seat_numbers" text[] NOT NULL,
	"tier" text NOT NULL,
	"is_binding" boolean DEFAULT false NOT NULL,
	"stripe_payment_intent_id" text,
	"charged_amount_cents" integer,
	"card_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seat_assignments_offer_id_unique" UNIQUE("offer_id")
);
--> statement-breakpoint
CREATE TABLE "shows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artist_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"venue_architecture_id" uuid NOT NULL,
	"doors_at" timestamp with time zone NOT NULL,
	"offer_window_opens_at" timestamp with time zone NOT NULL,
	"binding_allocation_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"tier_floors_cents" jsonb NOT NULL,
	"max_group_size" integer DEFAULT 10 NOT NULL,
	"active_row_ids" jsonb NOT NULL,
	"bleacher_enabled" boolean DEFAULT false NOT NULL,
	"bleacher_capacity" integer DEFAULT 0 NOT NULL,
	"bleacher_price_cents" integer,
	"show_holds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email_customization" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid,
	"scanned_by_staff_id" text NOT NULL,
	"result" text NOT NULL,
	"reason" text,
	"distance_m" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seat_assignment_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"totp_secret" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"scanned_at" timestamp with time zone,
	"scanned_by_staff_id" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_seat_assignment_id_unique" UNIQUE("seat_assignment_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"stripe_customer_id" text,
	"card_last4" text,
	"card_brand" text,
	"role" text DEFAULT 'FAN' NOT NULL,
	"bond_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "venue_architectures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rows" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_architectures_venue_version_unique" UNIQUE("venue_id","version")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"geo_lat" numeric(9, 6),
	"geo_lon" numeric(9, 6),
	"geo_radius_m" integer DEFAULT 500 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocation_logs" ADD CONSTRAINT "allocation_logs_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_logs" ADD CONSTRAINT "allocation_logs_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_members" ADD CONSTRAINT "artist_members_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_members" ADD CONSTRAINT "artist_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_requests" ADD CONSTRAINT "artist_requests_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_requests" ADD CONSTRAINT "artist_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_requests" ADD CONSTRAINT "artist_requests_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_events" ADD CONSTRAINT "bond_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_events" ADD CONSTRAINT "bond_events_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_events" ADD CONSTRAINT "bond_events_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_idempotency_keys" ADD CONSTRAINT "offer_idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_idempotency_keys" ADD CONSTRAINT "offer_idempotency_keys_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_idempotency_keys" ADD CONSTRAINT "offer_idempotency_keys_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resales" ADD CONSTRAINT "resales_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resales" ADD CONSTRAINT "resales_original_offer_id_offers_id_fk" FOREIGN KEY ("original_offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resales" ADD CONSTRAINT "resales_new_offer_id_offers_id_fk" FOREIGN KEY ("new_offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_assignments" ADD CONSTRAINT "seat_assignments_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shows" ADD CONSTRAINT "shows_venue_architecture_id_venue_architectures_id_fk" FOREIGN KEY ("venue_architecture_id") REFERENCES "public"."venue_architectures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_scans" ADD CONSTRAINT "ticket_scans_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_scans" ADD CONSTRAINT "ticket_scans_scanned_by_staff_id_users_id_fk" FOREIGN KEY ("scanned_by_staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_seat_assignment_id_seat_assignments_id_fk" FOREIGN KEY ("seat_assignment_id") REFERENCES "public"."seat_assignments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_scanned_by_staff_id_users_id_fk" FOREIGN KEY ("scanned_by_staff_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_architectures" ADD CONSTRAINT "venue_architectures_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocation_logs_show_created_idx" ON "allocation_logs" USING btree ("show_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "artist_requests_status_created_idx" ON "artist_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "artist_requests_show_idx" ON "artist_requests" USING btree ("show_id");--> statement-breakpoint
CREATE INDEX "bond_events_user_artist_idx" ON "bond_events" USING btree ("user_id","artist_id");--> statement-breakpoint
CREATE INDEX "bond_events_user_created_idx" ON "bond_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "offer_idempotency_keys_expires_idx" ON "offer_idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "offers_pool_idx" ON "offers" USING btree ("show_id","status","rank_key" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "seat_assignments_show_binding_idx" ON "seat_assignments" USING btree ("show_id","is_binding");--> statement-breakpoint
CREATE INDEX "shows_artist_doors_idx" ON "shows" USING btree ("artist_id","doors_at");--> statement-breakpoint
CREATE INDEX "shows_status_idx" ON "shows" USING btree ("status");--> statement-breakpoint
CREATE INDEX "shows_binding_at_idx" ON "shows" USING btree ("binding_allocation_at");--> statement-breakpoint
CREATE INDEX "ticket_scans_ticket_idx" ON "ticket_scans" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_scans_staff_created_idx" ON "ticket_scans" USING btree ("scanned_by_staff_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_user_status_idx" ON "tickets" USING btree ("user_id","status");