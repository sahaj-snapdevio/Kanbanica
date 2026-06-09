ALTER TABLE "job_logs" ALTER COLUMN "entity_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."job_log_entity_type";--> statement-breakpoint
CREATE TYPE "public"."job_log_entity_type" AS ENUM('server', 'cube', 'snapshot', 'backup');--> statement-breakpoint
DELETE FROM "job_logs" WHERE "entity_type" = 'deploy';--> statement-breakpoint
ALTER TABLE "job_logs" ALTER COLUMN "entity_type" SET DATA TYPE "public"."job_log_entity_type" USING "entity_type"::"public"."job_log_entity_type";
