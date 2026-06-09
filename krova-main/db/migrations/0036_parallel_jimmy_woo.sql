ALTER TYPE "public"."billing_event_type" ADD VALUE IF NOT EXISTS 'overage_charge';--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "overage_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "overage_cap_usd" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "this_period_overage_usd" numeric(12, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_events" ADD COLUMN IF NOT EXISTS "polar_meter_reported_at" timestamp with time zone;