DO $$ BEGIN
 CREATE TYPE "public"."plan_tier" AS ENUM('trial', 'starter', 'pro', 'business');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."credit_purchase_status" AS ENUM('pending', 'paid', 'partially_refunded', 'refunded', 'failed', 'orphaned');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "public"."billing_event_type" ADD VALUE IF NOT EXISTS 'credit_refund';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"initiated_by_user_id" text,
	"payment_provider" text NOT NULL,
	"provider_checkout_id" text,
	"provider_order_id" text,
	"amount" numeric(12, 4) NOT NULL,
	"surcharge_amount" numeric(12, 4) NOT NULL,
	"refunded_amount" numeric(12, 4) DEFAULT '0' NOT NULL,
	"status" "credit_purchase_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "low_balance_threshold" numeric(12, 4) DEFAULT '5' NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "plan" "plan_tier" DEFAULT 'trial' NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "payment_provider" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "provider_subscription_id" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "subscription_status" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "current_period_end" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "credit_purchases" ADD CONSTRAINT "credit_purchases_initiated_by_user_id_user_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_purchases_space_id_created_at_idx" ON "credit_purchases" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_purchases_provider_order_id_unique" ON "credit_purchases" USING btree ("provider_order_id");