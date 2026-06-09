ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "ban_expires" timestamp with time zone;
--> statement-breakpoint
UPDATE "user" SET "role" = 'admin' WHERE "is_admin" = TRUE AND "role" IS NULL;
--> statement-breakpoint
UPDATE "user" SET "role" = 'user' WHERE ("is_admin" = FALSE OR "is_admin" IS NULL) AND "role" IS NULL;
