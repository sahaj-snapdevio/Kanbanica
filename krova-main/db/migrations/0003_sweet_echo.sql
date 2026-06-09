CREATE TYPE "public"."server_snapshot_phase" AS ENUM('install', 'pull_images', 'network', 'verify');--> statement-breakpoint
CREATE TABLE "server_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"phase" "server_snapshot_phase" NOT NULL,
	"timeshift_name" text NOT NULL,
	"comment" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "server_snapshots" ADD CONSTRAINT "server_snapshots_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "server_snapshots_server_phase_idx" ON "server_snapshots" USING btree ("server_id","phase");--> statement-breakpoint
CREATE INDEX "server_snapshots_server_idx" ON "server_snapshots" USING btree ("server_id");