ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "marketing_opt_in" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "emailit_contact_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "emailit_synced_at" timestamp with time zone;