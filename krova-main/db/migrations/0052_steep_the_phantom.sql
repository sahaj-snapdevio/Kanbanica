ALTER TABLE "cubes" ADD COLUMN IF NOT EXISTS "last_reachability_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN IF NOT EXISTS "reachability_jsonb" jsonb;--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN IF NOT EXISTS "last_metrics_jsonb" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cubes_last_reachability_at_idx" ON "cubes" USING btree ("last_reachability_at");
