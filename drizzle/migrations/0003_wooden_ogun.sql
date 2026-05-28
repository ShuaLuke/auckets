ALTER TABLE "offers" ALTER COLUMN "stripe_setup_intent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_stripe_intent_check" CHECK ("offers"."stripe_setup_intent_id" IS NOT NULL OR "offers"."stripe_payment_intent_id" IS NOT NULL);