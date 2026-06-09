DO $$ BEGIN
  CREATE TYPE "public"."cube_terminal_session_status" AS ENUM('pending', 'running', 'ended', 'failed', 'expired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cube_terminal_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"cube_id" text NOT NULL,
	"space_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "cube_terminal_session_status" DEFAULT 'pending' NOT NULL,
	"initial_cols" integer DEFAULT 80 NOT NULL,
	"initial_rows" integer DEFAULT 24 NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cube_terminal_sessions" ADD CONSTRAINT "cube_terminal_sessions_cube_id_cubes_id_fk" FOREIGN KEY ("cube_id") REFERENCES "public"."cubes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cube_terminal_sessions" ADD CONSTRAINT "cube_terminal_sessions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cube_terminal_sessions" ADD CONSTRAINT "cube_terminal_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cube_terminal_sessions_cube_id_idx" ON "cube_terminal_sessions" USING btree ("cube_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cube_terminal_sessions_user_id_idx" ON "cube_terminal_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cube_terminal_sessions_status_idx" ON "cube_terminal_sessions" USING btree ("status");
