CREATE TYPE "public"."incomplete_strategy" AS ENUM('move_to_backlog', 'move_to_next_sprint', 'leave_as_is');--> statement-breakpoint
ALTER TABLE "sprint" ADD COLUMN "duration_weeks" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "sprint" ADD COLUMN "auto_create_next" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sprint" ADD COLUMN "auto_close_on_next" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sprint" ADD COLUMN "auto_incomplete_strategy" "incomplete_strategy" DEFAULT 'move_to_backlog' NOT NULL;--> statement-breakpoint
ALTER TABLE "sprint" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sprint" ADD COLUMN "closed_at" timestamp with time zone;