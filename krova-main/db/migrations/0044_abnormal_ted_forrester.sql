ALTER TABLE "lifecycle_logs" ALTER COLUMN "entity_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."entity_type";--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('cube', 'space');--> statement-breakpoint
DELETE FROM "lifecycle_logs" WHERE "entity_type" = 'deploy';--> statement-breakpoint
ALTER TABLE "lifecycle_logs" ALTER COLUMN "entity_type" SET DATA TYPE "public"."entity_type" USING "entity_type"::"public"."entity_type";--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "category" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."audit_category";--> statement-breakpoint
CREATE TYPE "public"."audit_category" AS ENUM('auth', 'space', 'member', 'invite', 'cube', 'app', 'domain', 'tcp_mapping', 'ssh_key', 'billing', 'server', 'platform', 'webhook');--> statement-breakpoint
UPDATE "audit_logs" SET "category" = 'platform' WHERE "category" = 'deploy';--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "category" SET DATA TYPE "public"."audit_category" USING "category"::"public"."audit_category";
