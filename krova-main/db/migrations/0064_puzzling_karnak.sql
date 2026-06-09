ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "overhead_disk_gb" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "disk_measured_at" timestamp with time zone;
