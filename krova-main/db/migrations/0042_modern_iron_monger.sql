DROP TABLE IF EXISTS "git_providers" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "git_repositories" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "github_installations" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "webhook_events" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "deployments" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "deploys" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "deploy_env_vars" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "deploy_health_events" CASCADE;--> statement-breakpoint
ALTER TABLE "cubes" DROP COLUMN IF EXISTS "is_deploy_managed";--> statement-breakpoint
ALTER TABLE "cubes" DROP COLUMN IF EXISTS "purpose";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."cube_purpose";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."git_provider_kind";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."github_account_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."webhook_processed_result";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."webhook_provider";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."deploy_build_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."deploy_source_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."deploy_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."deploy_trigger_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."deployment_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."deployment_trigger";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."deploy_env_availability";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."deploy_health_result";
