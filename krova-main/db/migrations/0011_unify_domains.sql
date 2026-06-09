-- Domain unification (Phase 7).
--
-- Cube is the source of truth for every cube-attached hostname. Deploy is
-- a procedure that targets a cube, so deploy domains live on the cube too.
-- Drops the parallel `deploy_domains` table and its enums; extends
-- `domain_mappings` with verification + kind + tls columns.
--
-- Safe in dev (data loss for any in-flight deploy_domains rows). For prod
-- this would need a data-copy step before the table drop — leaving as a
-- TODO for the operator since the deploy feature has not yet shipped to
-- prod with customer data.

-- ── Drop deploy_domains ───────────────────────────────────────────────
DROP TABLE IF EXISTS "deploy_domains";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."deploy_domain_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."deploy_domain_verification_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."deploy_domain_tls_status";--> statement-breakpoint

-- ── Cube-level domain enums ──────────────────────────────────────────
CREATE TYPE "public"."domain_kind" AS ENUM('default', 'custom');--> statement-breakpoint
CREATE TYPE "public"."domain_verification_status" AS ENUM('pending_dns', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."domain_tls_status" AS ENUM('none', 'pending', 'ready', 'failed');--> statement-breakpoint

-- ── Extend domain_mappings ────────────────────────────────────────────
-- Existing rows are pre-unification raw-cube custom domains; they were
-- routed without a verification step, so backfill them as already-
-- verified to preserve their current routing behavior. Going forward the
-- API route writes verification_status='verified' explicitly for raw
-- cubes; deploy custom domains start at 'pending_dns'.
ALTER TABLE "domain_mappings" ALTER COLUMN "port" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "domain_mappings"
  ADD COLUMN "kind" "domain_kind" NOT NULL DEFAULT 'custom';--> statement-breakpoint

ALTER TABLE "domain_mappings"
  ADD COLUMN "verification_status" "domain_verification_status" NOT NULL DEFAULT 'pending_dns';--> statement-breakpoint

ALTER TABLE "domain_mappings"
  ADD COLUMN "verification_checked_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "domain_mappings"
  ADD COLUMN "verify_attempts" integer NOT NULL DEFAULT 0;--> statement-breakpoint

ALTER TABLE "domain_mappings"
  ADD COLUMN "verification_error" text;--> statement-breakpoint

ALTER TABLE "domain_mappings"
  ADD COLUMN "tls_status" "domain_tls_status" NOT NULL DEFAULT 'none';--> statement-breakpoint

ALTER TABLE "domain_mappings"
  ADD COLUMN "tls_cert_resolver" text NOT NULL DEFAULT 'letsencrypt';--> statement-breakpoint

ALTER TABLE "domain_mappings"
  ADD COLUMN "redirect_to_primary" boolean NOT NULL DEFAULT false;--> statement-breakpoint

-- Backfill: existing raw-cube rows were always direct-routed, so mark
-- them as verified to keep them serving traffic and TLS-issued.
UPDATE "domain_mappings" SET "verification_status" = 'verified';--> statement-breakpoint

-- Drop the old global-unique constraint on `domain` — replaced below with
-- a per-cube unique + a partial unique on verified rows. Multiple cubes
-- may have pending claims on the same hostname (only one verifies).
ALTER TABLE "domain_mappings" DROP CONSTRAINT IF EXISTS "domain_mappings_domain_unique";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "domain_mappings_cube_domain_unique"
  ON "domain_mappings" USING btree ("cube_id","domain");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "domain_mappings_domain_verified_unique"
  ON "domain_mappings" USING btree ("domain")
  WHERE verification_status = 'verified';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "domain_mappings_pending_verify_idx"
  ON "domain_mappings" USING btree ("verification_status","verification_checked_at")
  WHERE verification_status = 'pending_dns';
