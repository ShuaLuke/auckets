CREATE TABLE "holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"show_id" uuid NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"venue_row_id" text NOT NULL,
	"seat_numbers" text[] NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_show_id_shows_id_fk" FOREIGN KEY ("show_id") REFERENCES "public"."shows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holds_show_idx" ON "holds" USING btree ("show_id");