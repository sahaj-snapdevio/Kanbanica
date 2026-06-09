CREATE TYPE "public"."snapshot_kind" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."snapshot_export_status" AS ENUM('pending', 'materializing', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "snapshot_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"space_id" text NOT NULL,
	"status" "snapshot_export_status" DEFAULT 'pending' NOT NULL,
	"storage_path" text,
	"storage_backend_id" text,
	"size_bytes" bigint,
	"presigned_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"requested_by" text,
	"failure_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN "last_auto_snapshot_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN "snapshotted_since_sleep" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cube_snapshots" ADD COLUMN "kind" "snapshot_kind" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "auto_snapshot_cadence_hours" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "auto_snapshot_keep_last" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "auto_snapshot_keep_daily" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "auto_snapshot_keep_weekly" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_manual_snapshots_per_cube" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD COLUMN "backup_storage_rate_per_gb_per_month" numeric(12, 6) DEFAULT '0.01' NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_exports" ADD CONSTRAINT "snapshot_exports_snapshot_id_cube_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."cube_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_exports" ADD CONSTRAINT "snapshot_exports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_exports" ADD CONSTRAINT "snapshot_exports_storage_backend_id_storage_backends_id_fk" FOREIGN KEY ("storage_backend_id") REFERENCES "public"."storage_backends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_exports" ADD CONSTRAINT "snapshot_exports_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "snapshot_exports_status_expires_idx" ON "snapshot_exports" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "snapshot_exports_snapshot_id_idx" ON "snapshot_exports" USING btree ("snapshot_id");--> statement-breakpoint
CREATE INDEX "cube_snapshots_cube_id_kind_status_idx" ON "cube_snapshots" USING btree ("cube_id","kind","status");--> statement-breakpoint
-- Seed snapshot cadence / retention / manual cap on the four bundled plans.
-- Idempotent: WHERE id = '...' touches each row only once. The four seeded
-- ids come from migration 0037 which originally inserted them.
-- Trial: no snapshots at all (cadence NULL, all buckets + manual cap 0).
-- Starter: every 12h, keep 4 recent + 7 daily + 1 weekly, 1 manual.
-- Pro: every 6h, keep 8 recent + 7 daily + 2 weekly, 2 manual.
-- Business: every 4h, keep 12 recent + 14 daily + 4 weekly, 4 manual.
UPDATE "plans" SET
  "auto_snapshot_cadence_hours" = NULL,
  "auto_snapshot_keep_last" = 0,
  "auto_snapshot_keep_daily" = 0,
  "auto_snapshot_keep_weekly" = 0,
  "max_manual_snapshots_per_cube" = 0
WHERE "id" = 'plan_trial';--> statement-breakpoint
UPDATE "plans" SET
  "auto_snapshot_cadence_hours" = 12,
  "auto_snapshot_keep_last" = 4,
  "auto_snapshot_keep_daily" = 7,
  "auto_snapshot_keep_weekly" = 1,
  "max_manual_snapshots_per_cube" = 1
WHERE "id" = 'plan_starter';--> statement-breakpoint
UPDATE "plans" SET
  "auto_snapshot_cadence_hours" = 6,
  "auto_snapshot_keep_last" = 8,
  "auto_snapshot_keep_daily" = 7,
  "auto_snapshot_keep_weekly" = 2,
  "max_manual_snapshots_per_cube" = 2
WHERE "id" = 'plan_pro';--> statement-breakpoint
UPDATE "plans" SET
  "auto_snapshot_cadence_hours" = 4,
  "auto_snapshot_keep_last" = 12,
  "auto_snapshot_keep_daily" = 14,
  "auto_snapshot_keep_weekly" = 4,
  "max_manual_snapshots_per_cube" = 4
WHERE "id" = 'plan_business';--> statement-breakpoint
-- Backfill cube_snapshots.kind from the legacy is_automatic boolean. The
-- new column defaults to 'manual'; flip rows that were system-created to
-- 'auto' so the auto-prune handler can reason about them correctly.
-- Idempotent: only touches rows still on the default. Per the user's
-- spec, no production rows currently need migrating; this is here for
-- forward-safety if the assumption ever changes.
UPDATE "cube_snapshots" SET "kind" = 'auto'
WHERE "is_automatic" = true AND "kind" = 'manual';