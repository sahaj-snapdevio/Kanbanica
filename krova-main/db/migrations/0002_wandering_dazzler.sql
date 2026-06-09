CREATE TYPE "public"."job_log_entity_type" AS ENUM('server', 'cube', 'snapshot', 'backup');--> statement-breakpoint
CREATE TYPE "public"."job_log_level" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TABLE "job_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"job_name" text NOT NULL,
	"entity_type" "job_log_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"level" "job_log_level" DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"stdout" text,
	"stderr" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "job_logs_job_id_seq_idx" ON "job_logs" USING btree ("job_id","sequence");--> statement-breakpoint
CREATE INDEX "job_logs_entity_idx" ON "job_logs" USING btree ("entity_type","entity_id","created_at");