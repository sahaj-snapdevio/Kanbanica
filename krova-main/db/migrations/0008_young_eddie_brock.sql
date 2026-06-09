CREATE TYPE "public"."cube_purpose" AS ENUM('runtime', 'build');--> statement-breakpoint
CREATE TYPE "public"."git_provider_kind" AS ENUM('github', 'gitlab', 'bitbucket', 'gitea', 'git', 'docker');--> statement-breakpoint
CREATE TYPE "public"."github_account_type" AS ENUM('User', 'Organization');--> statement-breakpoint
CREATE TYPE "public"."webhook_processed_result" AS ENUM('enqueued', 'skipped', 'error');--> statement-breakpoint
CREATE TYPE "public"."webhook_provider" AS ENUM('github', 'gitlab', 'bitbucket', 'gitea');--> statement-breakpoint
CREATE TYPE "public"."deploy_build_type" AS ENUM('dockerfile', 'railpack');--> statement-breakpoint
CREATE TYPE "public"."deploy_source_type" AS ENUM('github');--> statement-breakpoint
CREATE TYPE "public"."deploy_status" AS ENUM('drafting', 'building', 'releasing', 'running', 'crashed', 'sleeping', 'failed', 'stopped', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."deploy_trigger_type" AS ENUM('push', 'tag');--> statement-breakpoint
CREATE TYPE "public"."deployment_status" AS ENUM('queued', 'building', 'releasing', 'succeeded', 'failed', 'cancelled', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."deployment_trigger" AS ENUM('webhook', 'manual', 'redeploy', 'rollback');--> statement-breakpoint
CREATE TYPE "public"."deploy_env_availability" AS ENUM('runtime', 'build', 'both');--> statement-breakpoint
CREATE TYPE "public"."deploy_domain_kind" AS ENUM('default', 'custom');--> statement-breakpoint
CREATE TYPE "public"."deploy_domain_tls_status" AS ENUM('none', 'pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."deploy_domain_verification_status" AS ENUM('pending_dns', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."deploy_health_result" AS ENUM('pass', 'fail', 'timeout');--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'deploy.view';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'deploy.create';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'deploy.manage';--> statement-breakpoint
ALTER TYPE "public"."entity_type" ADD VALUE 'deploy';--> statement-breakpoint
ALTER TYPE "public"."audit_category" ADD VALUE 'deploy';--> statement-breakpoint
ALTER TYPE "public"."job_log_entity_type" ADD VALUE 'deploy';--> statement-breakpoint
CREATE TABLE "git_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"kind" "git_provider_kind" NOT NULL,
	"name" text NOT NULL,
	"gitlab_base_url" text,
	"gitea_base_url" text,
	"created_by_user_id" text NOT NULL,
	"shared_with_space" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"git_provider_id" text NOT NULL,
	"provider_repo_id" text NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"is_private" boolean NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "git_repositories_provider_repo_unique" UNIQUE("git_provider_id","provider_repo_id")
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"git_provider_id" text NOT NULL,
	"app_id" bigint NOT NULL,
	"app_slug" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"account_type" "github_account_type" NOT NULL,
	"client_id" text NOT NULL,
	"encrypted_client_secret" text NOT NULL,
	"encrypted_private_key_pem" text NOT NULL,
	"encrypted_webhook_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "webhook_provider" NOT NULL,
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"git_provider_id" text,
	"raw_headers" jsonb NOT NULL,
	"raw_body" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"processed_result" "webhook_processed_result",
	"processed_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_provider_delivery_unique" UNIQUE("provider","delivery_id")
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"deploy_id" text NOT NULL,
	"build_cube_id" text,
	"commit_sha" text,
	"commit_message" text,
	"commit_author_name" text,
	"commit_author_email" text,
	"triggered_by" "deployment_trigger" NOT NULL,
	"triggered_by_user_id" text,
	"image_tag" text,
	"status" "deployment_status" DEFAULT 'queued' NOT NULL,
	"current_step" text,
	"error_diagnostic" text,
	"error_message" text,
	"build_started_at" timestamp with time zone,
	"build_finished_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deploys" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"cube_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"region_id" text NOT NULL,
	"source_type" "deploy_source_type" NOT NULL,
	"git_provider_id" text,
	"repo_full_name" text,
	"branch" text,
	"build_path" text DEFAULT '/' NOT NULL,
	"watch_paths" text[] DEFAULT '{}' NOT NULL,
	"trigger_type" "deploy_trigger_type" DEFAULT 'push' NOT NULL,
	"auto_deploy" boolean DEFAULT true NOT NULL,
	"build_type" "deploy_build_type" NOT NULL,
	"dockerfile_path" text DEFAULT 'Dockerfile' NOT NULL,
	"docker_context_path" text DEFAULT '.' NOT NULL,
	"docker_build_stage" text,
	"railpack_version" text,
	"clean_cache_next_deploy" boolean DEFAULT false NOT NULL,
	"port" integer DEFAULT 3000 NOT NULL,
	"healthcheck_path" text DEFAULT '/' NOT NULL,
	"healthcheck_timeout_sec" integer DEFAULT 30 NOT NULL,
	"vcpus" real NOT NULL,
	"ram_mb" integer NOT NULL,
	"disk_limit_gb" integer DEFAULT 20 NOT NULL,
	"build_vcpus" real DEFAULT 4 NOT NULL,
	"build_ram_mb" integer DEFAULT 4096 NOT NULL,
	"build_disk_gb" integer DEFAULT 20 NOT NULL,
	"build_timeout_sec" integer DEFAULT 3600 NOT NULL,
	"replicas" integer DEFAULT 1 NOT NULL,
	"status" "deploy_status" DEFAULT 'drafting' NOT NULL,
	"last_deployment_id" text,
	"last_successful_deployment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "deploys_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "deploy_env_vars" (
	"id" text PRIMARY KEY NOT NULL,
	"deploy_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"encrypted_value" text,
	"is_secret" boolean DEFAULT false NOT NULL,
	"available_at" "deploy_env_availability" DEFAULT 'runtime' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deploy_env_vars_deploy_key_avail_unique" UNIQUE("deploy_id","key","available_at")
);
--> statement-breakpoint
CREATE TABLE "deploy_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"deploy_id" text NOT NULL,
	"domain" text NOT NULL,
	"kind" "deploy_domain_kind" NOT NULL,
	"verification_status" "deploy_domain_verification_status" DEFAULT 'pending_dns' NOT NULL,
	"verification_checked_at" timestamp with time zone,
	"verify_attempts" integer DEFAULT 0 NOT NULL,
	"verification_error" text,
	"tls_status" "deploy_domain_tls_status" DEFAULT 'none' NOT NULL,
	"tls_cert_resolver" text DEFAULT 'letsencrypt' NOT NULL,
	"redirect_to_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deploy_health_events" (
	"id" text PRIMARY KEY NOT NULL,
	"deploy_id" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"result" "deploy_health_result" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN "is_deploy_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN "purpose" "cube_purpose" DEFAULT 'runtime' NOT NULL;--> statement-breakpoint
ALTER TABLE "git_providers" ADD CONSTRAINT "git_providers_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_providers" ADD CONSTRAINT "git_providers_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_repositories" ADD CONSTRAINT "git_repositories_git_provider_id_git_providers_id_fk" FOREIGN KEY ("git_provider_id") REFERENCES "public"."git_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_git_provider_id_git_providers_id_fk" FOREIGN KEY ("git_provider_id") REFERENCES "public"."git_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_git_provider_id_git_providers_id_fk" FOREIGN KEY ("git_provider_id") REFERENCES "public"."git_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_deploy_id_deploys_id_fk" FOREIGN KEY ("deploy_id") REFERENCES "public"."deploys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_build_cube_id_cubes_id_fk" FOREIGN KEY ("build_cube_id") REFERENCES "public"."cubes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploys" ADD CONSTRAINT "deploys_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploys" ADD CONSTRAINT "deploys_cube_id_cubes_id_fk" FOREIGN KEY ("cube_id") REFERENCES "public"."cubes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploys" ADD CONSTRAINT "deploys_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploys" ADD CONSTRAINT "deploys_git_provider_id_git_providers_id_fk" FOREIGN KEY ("git_provider_id") REFERENCES "public"."git_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploys" ADD CONSTRAINT "deploys_last_deployment_id_deployments_id_fk" FOREIGN KEY ("last_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploys" ADD CONSTRAINT "deploys_last_successful_deployment_id_deployments_id_fk" FOREIGN KEY ("last_successful_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_env_vars" ADD CONSTRAINT "deploy_env_vars_deploy_id_deploys_id_fk" FOREIGN KEY ("deploy_id") REFERENCES "public"."deploys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_domains" ADD CONSTRAINT "deploy_domains_deploy_id_deploys_id_fk" FOREIGN KEY ("deploy_id") REFERENCES "public"."deploys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deploy_health_events" ADD CONSTRAINT "deploy_health_events_deploy_id_deploys_id_fk" FOREIGN KEY ("deploy_id") REFERENCES "public"."deploys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "git_providers_space_id_kind_idx" ON "git_providers" USING btree ("space_id","kind");--> statement-breakpoint
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "webhook_events_git_provider_id_idx" ON "webhook_events" USING btree ("git_provider_id");--> statement-breakpoint
CREATE INDEX "deployments_deploy_id_created_at_idx" ON "deployments" USING btree ("deploy_id","created_at");--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deploys_space_id_idx" ON "deploys" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "deploys_cube_id_idx" ON "deploys" USING btree ("cube_id");--> statement-breakpoint
CREATE INDEX "deploys_status_idx" ON "deploys" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deploys_webhook_lookup_idx" ON "deploys" USING btree ("git_provider_id","repo_full_name","branch");--> statement-breakpoint
CREATE INDEX "deploy_domains_deploy_id_idx" ON "deploy_domains" USING btree ("deploy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deploy_domains_domain_verified_unique" ON "deploy_domains" USING btree ("domain") WHERE verification_status = 'verified';--> statement-breakpoint
CREATE INDEX "deploy_domains_pending_verify_idx" ON "deploy_domains" USING btree ("verification_status","verification_checked_at") WHERE verification_status = 'pending_dns';--> statement-breakpoint
CREATE INDEX "deploy_health_events_deploy_checked_idx" ON "deploy_health_events" USING btree ("deploy_id","checked_at");