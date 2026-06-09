CREATE TABLE "storage_backends" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"endpoint" text NOT NULL,
	"region" text NOT NULL,
	"bucket" text NOT NULL,
	"access_key_id_enc" text NOT NULL,
	"secret_access_key_enc" text NOT NULL,
	"capacity_gb" integer,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_health_check" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- `DROP TABLE ... CASCADE` below already removes the FK constraints from
-- cube_snapshots and cube_backups that reference storage_boxes, so the
-- explicit `DROP CONSTRAINT` statements drizzle emits afterwards need
-- `IF EXISTS` to survive a fresh apply (otherwise they error with
-- "constraint does not exist"). Guards added per CLAUDE.md Rule 6.
ALTER TABLE "storage_boxes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "storage_boxes" CASCADE;--> statement-breakpoint
ALTER TABLE "cube_snapshots" DROP CONSTRAINT IF EXISTS "cube_snapshots_storage_box_id_storage_boxes_id_fk";
--> statement-breakpoint
ALTER TABLE "cube_backups" DROP CONSTRAINT IF EXISTS "cube_backups_storage_box_id_storage_boxes_id_fk";
--> statement-breakpoint
ALTER TABLE "cube_snapshots" ADD COLUMN "storage_backend_id" text;--> statement-breakpoint
ALTER TABLE "cube_backups" ADD COLUMN "storage_backend_id" text;--> statement-breakpoint
CREATE INDEX "storage_backends_is_active_idx" ON "storage_backends" USING btree ("is_active");--> statement-breakpoint
ALTER TABLE "cube_snapshots" ADD CONSTRAINT "cube_snapshots_storage_backend_id_storage_backends_id_fk" FOREIGN KEY ("storage_backend_id") REFERENCES "public"."storage_backends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_backups" ADD CONSTRAINT "cube_backups_storage_backend_id_storage_backends_id_fk" FOREIGN KEY ("storage_backend_id") REFERENCES "public"."storage_backends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_snapshots" DROP COLUMN "storage_box_id";--> statement-breakpoint
ALTER TABLE "cube_backups" DROP COLUMN "storage_box_id";