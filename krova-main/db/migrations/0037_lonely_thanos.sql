DO $$ BEGIN
 CREATE TYPE "public"."plan_visibility" AS ENUM('public', 'custom');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"price_usd" numeric(12, 4) NOT NULL,
	"included_credit_usd" numeric(12, 4) NOT NULL,
	"max_concurrent_cubes" integer,
	"max_vcpus" integer NOT NULL,
	"max_ram_mb" integer NOT NULL,
	"max_disk_gb" integer NOT NULL,
	"max_seats" integer,
	"max_backups" integer,
	"max_domains" integer,
	"allow_topup" boolean DEFAULT true NOT NULL,
	"allow_overage" boolean DEFAULT true NOT NULL,
	"visibility" "plan_visibility" DEFAULT 'public' NOT NULL,
	"is_default_for_new_spaces" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"polar_product_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_space_visibility" (
	"plan_id" text NOT NULL,
	"space_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_space_visibility_plan_id_space_id_pk" PRIMARY KEY("plan_id","space_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"payment_fee_percent" numeric(6, 5) DEFAULT '0.04' NOT NULL,
	"payment_fee_flat_usd" numeric(12, 4) DEFAULT '0.40' NOT NULL,
	"credit_topup_min_usd" numeric(12, 4) DEFAULT '10' NOT NULL,
	"credit_topup_max_usd" numeric(12, 4) DEFAULT '1000' NOT NULL,
	"credit_topup_default_usd" numeric(12, 4) DEFAULT '50' NOT NULL,
	"overage_cap_min_usd" numeric(12, 4) DEFAULT '5' NOT NULL,
	"overage_cap_max_usd" numeric(12, 4) DEFAULT '1000' NOT NULL,
	"overage_default_cap_multiplier" numeric(6, 4) DEFAULT '2' NOT NULL,
	"plan_credit_grant_cooldown_days" integer DEFAULT 30 NOT NULL,
	"low_balance_threshold_default_usd" numeric(12, 4) DEFAULT '5' NOT NULL,
	"low_balance_threshold_min_usd" numeric(12, 4) DEFAULT '5' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "plan_id" text;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "override_max_concurrent_cubes" integer;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "override_max_vcpus" integer;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "override_max_ram_mb" integer;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "override_max_disk_gb" integer;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "override_max_seats" integer;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "override_max_backups" integer;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "override_max_domains" integer;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "override_included_credit_usd" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "override_allow_topup" boolean;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "override_allow_overage" boolean;--> statement-breakpoint
ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "override_overage_cap_max_usd" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "subscription_credit_grants" ADD COLUMN IF NOT EXISTS "plan_id" text;--> statement-breakpoint
ALTER TABLE "subscription_intents" ADD COLUMN IF NOT EXISTS "plan_id" text;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "plan_space_visibility" ADD CONSTRAINT "plan_space_visibility_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "plan_space_visibility" ADD CONSTRAINT "plan_space_visibility_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plans_slug_unique" ON "plans" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plans_polar_product_id_unique" ON "plans" USING btree ("polar_product_id") WHERE "plans"."polar_product_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plans_default_unique" ON "plans" USING btree ("is_default_for_new_spaces") WHERE "plans"."is_default_for_new_spaces" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plans_visibility_idx" ON "plans" USING btree ("visibility");--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "spaces" ADD CONSTRAINT "spaces_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "subscription_credit_grants" ADD CONSTRAINT "subscription_credit_grants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "subscription_intents" ADD CONSTRAINT "subscription_intents_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_singleton" CHECK (id = 1);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
INSERT INTO "platform_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Bootstrap the four public plans with stable text IDs (Trial / Starter /
-- Pro / Business). After the rows exist the backfill below populates
-- `spaces.plan_id` from the legacy enum, and migration 0038's
-- `SET NOT NULL` on `spaces.plan_id` succeeds. Polar product ids on the
-- paid plans are filled in later by `pnpm setup:polar` (operator-run, once
-- per Polar org).
-- ON CONFLICT (slug) DO NOTHING keeps this idempotent — re-running the
-- migration after an operator has edited a plan in Orbit will not clobber.
INSERT INTO "plans" ("id", "name", "slug", "price_usd", "included_credit_usd",
  "max_concurrent_cubes", "max_vcpus", "max_ram_mb", "max_disk_gb",
  "max_seats", "max_backups", "max_domains",
  "allow_topup", "allow_overage",
  "visibility", "is_default_for_new_spaces", "sort_order")
VALUES
  ('plan_trial',    'Trial',    'trial',    '0',   '5',   1,    2,  4096,  20, 1,    0,    0,    false, false, 'public', true,  0),
  ('plan_starter',  'Starter',  'starter',  '10',  '10',  2,    4,  8192,  40, 3,    3,    1,    true,  true,  'public', false, 10),
  ('plan_pro',      'Pro',      'pro',      '30',  '30',  6,    8,  16384, 100, 10,   15,   5,    true,  true,  'public', false, 20),
  ('plan_business', 'Business', 'business', '100', '100', NULL, 16, 32768, 100, NULL, NULL, NULL, true,  true,  'public', false, 30)
ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint

-- Backfill `spaces.plan_id` from the legacy `plan` pgEnum on every existing
-- space. Idempotent via `plan_id IS NULL`. Matches by slug (the enum's text
-- value === the plan's slug). Without this, migration 0038's
-- `SET NOT NULL` would throw on every existing row.
UPDATE "spaces" SET "plan_id" = "plans"."id"
FROM "plans"
WHERE "plans"."slug" = "spaces"."plan"::text
  AND "spaces"."plan_id" IS NULL;--> statement-breakpoint

-- Same backfill for the two subscription tables. These are typically empty
-- on a first Phase-5 deploy (subscriptions weren't wired yet), but the
-- migration is still correct if rows exist from QA/staging seeding.
UPDATE "subscription_credit_grants" SET "plan_id" = "plans"."id"
FROM "plans"
WHERE "plans"."slug" = "subscription_credit_grants"."plan"::text
  AND "subscription_credit_grants"."plan_id" IS NULL;--> statement-breakpoint

UPDATE "subscription_intents" SET "plan_id" = "plans"."id"
FROM "plans"
WHERE "plans"."slug" = "subscription_intents"."plan"::text
  AND "subscription_intents"."plan_id" IS NULL;
