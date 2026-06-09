ALTER TABLE "member_permissions" ALTER COLUMN "permission" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."permission";--> statement-breakpoint
CREATE TYPE "public"."permission" AS ENUM('cube.view', 'cube.create', 'cube.manage', 'billing.view', 'billing.manage', 'members.invite', 'members.manage');--> statement-breakpoint
DELETE FROM "member_permissions" WHERE "permission" IN ('deploy.view', 'deploy.create', 'deploy.manage');--> statement-breakpoint
UPDATE "invites" SET "permissions" = COALESCE((SELECT jsonb_agg(elem) FROM jsonb_array_elements_text("permissions") AS t(elem) WHERE elem NOT IN ('deploy.view', 'deploy.create', 'deploy.manage')), '[]'::jsonb) WHERE "permissions" ?| array['deploy.view', 'deploy.create', 'deploy.manage'];--> statement-breakpoint
ALTER TABLE "member_permissions" ALTER COLUMN "permission" SET DATA TYPE "public"."permission" USING "permission"::"public"."permission";
