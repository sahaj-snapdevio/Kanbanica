CREATE TYPE "public"."cube_launch_mode" AS ENUM('bare', 'jailed');--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN "launch_mode" "cube_launch_mode" DEFAULT 'bare' NOT NULL;--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN "jailer_uid" integer;