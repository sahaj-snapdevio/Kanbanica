-- Hard-delete any soft-deleted / failed rows so the enum recast below does not error.
-- These statuses are no longer part of the enum; affected rows have no functional purpose.
DELETE FROM "domain_mappings" WHERE "status" IN ('deleted', 'failed');--> statement-breakpoint
-- Drop the partial unique index FIRST. Its predicate (status IN ('pending','active'))
-- is bound to the old enum type, so changing the column to text would re-evaluate the
-- predicate against text and fail with: "operator does not exist: text = domain_status".
DROP INDEX "domain_mappings_domain_active_unique";--> statement-breakpoint
ALTER TABLE "domain_mappings" DROP CONSTRAINT "domain_mappings_cube_domain_unique";--> statement-breakpoint
ALTER TABLE "domain_mappings" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "domain_mappings" ALTER COLUMN "status" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."domain_status";--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'active', 'stopping');--> statement-breakpoint
ALTER TABLE "domain_mappings" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."domain_status";--> statement-breakpoint
ALTER TABLE "domain_mappings" ALTER COLUMN "status" SET DATA TYPE "public"."domain_status" USING "status"::"public"."domain_status";--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD CONSTRAINT "domain_mappings_domain_unique" UNIQUE("domain");