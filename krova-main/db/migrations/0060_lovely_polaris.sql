ALTER TABLE "outbound_webhook_endpoints" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "outbound_webhook_endpoints" ADD COLUMN IF NOT EXISTS "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "outbound_webhook_endpoints" ADD COLUMN IF NOT EXISTS "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_webhook_endpoints" ADD COLUMN IF NOT EXISTS "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_webhook_endpoints" ADD COLUMN IF NOT EXISTS "last_failure_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "owhd_created_at_idx" ON "outbound_webhook_deliveries" USING btree ("created_at");
