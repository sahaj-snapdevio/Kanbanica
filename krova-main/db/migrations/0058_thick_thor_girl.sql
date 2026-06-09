-- Add sleep_storage_charge to billing_event_type enum. ADD VALUE IF NOT
-- EXISTS makes this re-run safe (Rule 40 production data safety policy);
-- a partial deploy that already added the value won't error on retry.
ALTER TYPE "public"."billing_event_type" ADD VALUE IF NOT EXISTS 'sleep_storage_charge' BEFORE 'credit_refund';--> statement-breakpoint
-- Per-GB-month rate for sleeping-cube disk storage. Default $0.01/GB/mo —
-- matches backup storage. Adding a nullable-with-default column on a small
-- config table is metadata-only in PG 11+ (no table rewrite).
ALTER TABLE "platform_settings" ADD COLUMN IF NOT EXISTS "sleep_storage_rate_per_gb_per_month" numeric(12, 6) DEFAULT '0.01' NOT NULL;
