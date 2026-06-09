DO $$ BEGIN
 CREATE TYPE "public"."subscription_intent_status" AS ENUM('pending', 'completed', 'failed', 'orphaned');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "public"."billing_event_type" ADD VALUE IF NOT EXISTS 'plan_credit';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_credit_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"plan" "plan_tier" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"amount" numeric(12, 4) NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"plan" "plan_tier" NOT NULL,
	"payment_provider" text NOT NULL,
	"provider_checkout_id" text,
	"status" "subscription_intent_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "last_plan_credit_grant_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN IF NOT EXISTS "last_started_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "subscription_credit_grants" ADD CONSTRAINT "subscription_credit_grants_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "subscription_intents" ADD CONSTRAINT "subscription_intents_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_credit_grants_space_id_idx" ON "subscription_credit_grants" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_credit_grants_subscription_period_unique" ON "subscription_credit_grants" USING btree ("provider_subscription_id","period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_intents_space_id_created_at_idx" ON "subscription_intents" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_intents_provider_checkout_id_unique" ON "subscription_intents" USING btree ("provider_checkout_id");