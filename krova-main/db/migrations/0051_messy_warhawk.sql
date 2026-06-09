DO $$ BEGIN
  CREATE TYPE "public"."cube_import_status" AS ENUM('uploading', 'finalizing', 'provisioning', 'complete', 'failed', 'expired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cube_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "cube_import_status" DEFAULT 'uploading' NOT NULL,
	"storage_backend_id" text NOT NULL,
	"s3_key" text NOT NULL,
	"s3_upload_id" text NOT NULL,
	"expected_size_bytes" bigint NOT NULL,
	"chunk_size_bytes" integer NOT NULL,
	"ssh_key_mode" text DEFAULT 'replace' NOT NULL,
	"ssh_public_key" text,
	"region_id" text,
	"user_data" text,
	"vcpus_override" integer,
	"ram_mb_override" integer,
	"disk_gb_override" integer,
	"cube_id" text,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cube_imports" ADD CONSTRAINT "cube_imports_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cube_imports" ADD CONSTRAINT "cube_imports_storage_backend_id_storage_backends_id_fk" FOREIGN KEY ("storage_backend_id") REFERENCES "public"."storage_backends"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cube_imports" ADD CONSTRAINT "cube_imports_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cube_imports" ADD CONSTRAINT "cube_imports_cube_id_cubes_id_fk" FOREIGN KEY ("cube_id") REFERENCES "public"."cubes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cube_imports" ADD CONSTRAINT "cube_imports_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cube_imports" ADD CONSTRAINT "cube_imports_ssh_key_mode_check" CHECK ("ssh_key_mode" IN ('replace', 'keep'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cube_imports_space_id_idx" ON "cube_imports" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cube_imports_status_idx" ON "cube_imports" USING btree ("status","created_at");
