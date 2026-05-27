CREATE TABLE "offer_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"offer_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offer_revisions" ADD CONSTRAINT "offer_revisions_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offer_revisions_offer_recorded_idx" ON "offer_revisions" USING btree ("offer_id","recorded_at" DESC NULLS LAST);