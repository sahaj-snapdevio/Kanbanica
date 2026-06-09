-- Drop the legacy plan_tier enum + the dual-written `plan` columns.
-- Migration 0037 inserts the public plans and backfills `spaces.plan_id` from
-- the old enum (and the two subscription tables), so `SET NOT NULL` below
-- succeeds on a clean migration run. If any plan_id is still null (eg the
-- backfill was skipped on a partial run), this migration throws — the right
-- failure mode (loud, not silent).
-- All statements are guarded so re-runs and partially-applied state are safe.

ALTER TABLE "spaces" ALTER COLUMN "plan_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_credit_grants" ALTER COLUMN "plan_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_intents" ALTER COLUMN "plan_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "spaces" DROP COLUMN IF EXISTS "plan";--> statement-breakpoint
ALTER TABLE "subscription_credit_grants" DROP COLUMN IF EXISTS "plan";--> statement-breakpoint
ALTER TABLE "subscription_intents" DROP COLUMN IF EXISTS "plan";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."plan_tier";
