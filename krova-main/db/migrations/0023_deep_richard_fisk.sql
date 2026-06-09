DO $$ BEGIN
 ALTER TABLE "cubes" DROP CONSTRAINT "cubes_transfer_destination_server_id_servers_id_fk";
EXCEPTION
 WHEN undefined_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cubes" ADD CONSTRAINT "cubes_transfer_destination_server_id_servers_id_fk" FOREIGN KEY ("transfer_destination_server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cubes_transfer_state_idx" ON "cubes" USING btree ("transfer_state");
