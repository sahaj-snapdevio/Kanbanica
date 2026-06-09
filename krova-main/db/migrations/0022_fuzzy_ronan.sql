DO $$ BEGIN
 CREATE TYPE "public"."cube_transfer_state" AS ENUM('idle', 'snapshotting', 'restoring', 'finalizing', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN IF NOT EXISTS "transfer_state" "cube_transfer_state" DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN IF NOT EXISTS "transfer_destination_server_id" text;--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN IF NOT EXISTS "transfer_started_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cubes" ADD CONSTRAINT "cubes_transfer_destination_server_id_servers_id_fk" FOREIGN KEY ("transfer_destination_server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
