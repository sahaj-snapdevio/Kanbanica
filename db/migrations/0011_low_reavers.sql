CREATE TYPE "public"."sprint_name_format" AS ENUM('Sprint {n}', 'Week {n}', 'Iteration {n}', '{project} Sprint {n}');--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "sprint_start_day" integer;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "sprint_default_duration_weeks" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "sprint_name_format" text DEFAULT 'Sprint {n}' NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "sprint_auto_mark_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "sprint_auto_create_next" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "sprint_auto_move_incomplete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "sprint_auto_archive_after_n" integer;