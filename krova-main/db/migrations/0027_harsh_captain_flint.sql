ALTER TYPE "public"."server_snapshot_phase" ADD VALUE IF NOT EXISTS 'caddy';--> statement-breakpoint
ALTER TABLE "servers" DROP COLUMN IF EXISTS "server_domain";--> statement-breakpoint
ALTER TABLE "servers" DROP COLUMN IF EXISTS "cf_origin_hostname";
