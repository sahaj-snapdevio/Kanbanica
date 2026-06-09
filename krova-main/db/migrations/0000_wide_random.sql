CREATE TYPE "public"."permission" AS ENUM('cube.view', 'cube.create', 'cube.manage', 'billing.view', 'billing.manage', 'members.invite', 'members.manage');--> statement-breakpoint
CREATE TYPE "public"."invite_status" AS ENUM('pending', 'accepted', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."server_setup_phase" AS ENUM('bootstrap', 'install', 'pull_images', 'network', 'verify', 'ready');--> statement-breakpoint
CREATE TYPE "public"."server_setup_status" AS ENUM('idle', 'running', 'failed');--> statement-breakpoint
CREATE TYPE "public"."server_status" AS ENUM('active', 'inactive', 'draining', 'offline', 'provisioning');--> statement-breakpoint
CREATE TYPE "public"."cube_status" AS ENUM('pending', 'booting', 'running', 'sleeping', 'stopping', 'deleted', 'error');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending', 'active', 'stopping', 'deleted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('cube', 'space');--> statement-breakpoint
CREATE TYPE "public"."billing_event_type" AS ENUM('hourly_charge', 'credit_grant', 'credit_topup', 'backup_storage_charge');--> statement-breakpoint
CREATE TYPE "public"."tcp_mapping_status" AS ENUM('pending', 'active', 'stopping', 'failed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."audit_category" AS ENUM('auth', 'space', 'member', 'invite', 'cube', 'app', 'domain', 'tcp_mapping', 'ssh_key', 'billing', 'server', 'platform');--> statement-breakpoint
CREATE TYPE "public"."snapshot_status" AS ENUM('pending', 'creating', 'complete', 'restoring', 'failed');--> statement-breakpoint
CREATE TYPE "public"."backup_status" AS ENUM('pending', 'creating', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."platform_image_kind" AS ENUM('kernel', 'rootfs');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_cube_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text NOT NULL,
	"cube_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_cube_assignments_membership_id_cube_id_unique" UNIQUE("membership_id","cube_id")
);
--> statement-breakpoint
CREATE TABLE "member_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"membership_id" text NOT NULL,
	"permission" "permission" NOT NULL,
	CONSTRAINT "member_permissions_membership_id_permission_unique" UNIQUE("membership_id","permission")
);
--> statement-breakpoint
CREATE TABLE "space_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"space_id" text NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_memberships_user_id_space_id_unique" UNIQUE("user_id","space_id")
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"credit_balance" numeric(12, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"space_id" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"cube_assignments" jsonb NOT NULL,
	"token" text NOT NULL,
	"status" "invite_status" DEFAULT 'pending' NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "ssh_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_ssh_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" text PRIMARY KEY NOT NULL,
	"hostname" text NOT NULL,
	"server_domain" text NOT NULL,
	"public_ip" text NOT NULL,
	"region_id" text NOT NULL,
	"ssh_port" integer DEFAULT 2822 NOT NULL,
	"ssh_key_id" text NOT NULL,
	"status" "server_status" DEFAULT 'active' NOT NULL,
	"setup_phase" "server_setup_phase" DEFAULT 'ready' NOT NULL,
	"setup_status" "server_setup_status" DEFAULT 'idle' NOT NULL,
	"setup_error" text,
	"setup_started_at" timestamp with time zone,
	"total_cpus" integer NOT NULL,
	"total_ram_mb" integer NOT NULL,
	"total_disk_gb" integer NOT NULL,
	"allocated_cpus" real DEFAULT 0 NOT NULL,
	"allocated_ram_mb" integer DEFAULT 0 NOT NULL,
	"allocated_disk_gb" integer DEFAULT 0 NOT NULL,
	"max_cpu_overcommit" numeric(4, 2) DEFAULT '4' NOT NULL,
	"max_ram_overcommit" numeric(4, 2) DEFAULT '2' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocated_ports" (
	"id" text PRIMARY KEY NOT NULL,
	"server_id" text NOT NULL,
	"port" integer NOT NULL,
	"cube_id" text,
	"purpose" text DEFAULT 'ssh' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocated_ports_server_id_port_unique" UNIQUE("server_id","port")
);
--> statement-breakpoint
CREATE TABLE "cubes" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"server_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "cube_status" DEFAULT 'pending' NOT NULL,
	"vcpus" real NOT NULL,
	"ram_mb" integer NOT NULL,
	"disk_limit_gb" integer DEFAULT 20 NOT NULL,
	"image_id" text DEFAULT 'ubuntu-24.04' NOT NULL,
	"internal_ip" text,
	"zero_balance_sleep" boolean DEFAULT false NOT NULL,
	"last_billed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"cube_id" text NOT NULL,
	"domain" text NOT NULL,
	"port" integer NOT NULL,
	"status" "domain_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_mappings_cube_domain_unique" UNIQUE("cube_id","domain")
);
--> statement-breakpoint
CREATE TABLE "lifecycle_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"cube_id" text,
	"amount" numeric(12, 4) NOT NULL,
	"type" "billing_event_type" NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tcp_mapping_whitelisted_ips" (
	"id" text PRIMARY KEY NOT NULL,
	"mapping_id" text NOT NULL,
	"cidr" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tcp_mapping_whitelisted_ips_mapping_id_cidr_unique" UNIQUE("mapping_id","cidr")
);
--> statement-breakpoint
CREATE TABLE "tcp_port_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"cube_id" text NOT NULL,
	"cube_port" integer NOT NULL,
	"host_port" integer NOT NULL,
	"allocated_port_id" text NOT NULL,
	"label" text,
	"is_ssh" boolean DEFAULT false NOT NULL,
	"status" "tcp_mapping_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tcp_port_mappings_cube_id_cube_port_unique" UNIQUE("cube_id","cube_port")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"category" "audit_category" NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text,
	"actor_email" text,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"space_id" text,
	"metadata" jsonb,
	"description" text,
	"ip_address" text,
	"user_agent" text,
	"source" text DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cube_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"cube_id" text NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "snapshot_status" DEFAULT 'pending' NOT NULL,
	"size_bytes" bigint,
	"storage_path" text,
	"storage_box_id" text,
	"is_automatic" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cube_backups" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "backup_status" DEFAULT 'pending' NOT NULL,
	"original_cube_id" text NOT NULL,
	"original_cube_name" text NOT NULL,
	"cube_config" jsonb NOT NULL,
	"size_bytes" bigint,
	"storage_path" text,
	"storage_box_id" text,
	"disk_size_gb" integer NOT NULL,
	"created_by" text,
	"completed_at" timestamp with time zone,
	"redeployed_cube_id" text,
	"redeploy_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_boxes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"user" text NOT NULL,
	"port" integer DEFAULT 23 NOT NULL,
	"ssh_key_id" text NOT NULL,
	"total_bytes" bigint,
	"used_bytes" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_health_check" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_images" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "platform_image_kind" NOT NULL,
	"path" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_cube_assignments" ADD CONSTRAINT "member_cube_assignments_membership_id_space_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."space_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_cube_assignments" ADD CONSTRAINT "member_cube_assignments_cube_id_cubes_id_fk" FOREIGN KEY ("cube_id") REFERENCES "public"."cubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_permissions" ADD CONSTRAINT "member_permissions_membership_id_space_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."space_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_memberships" ADD CONSTRAINT "space_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_memberships" ADD CONSTRAINT "space_memberships_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_ssh_keys" ADD CONSTRAINT "user_ssh_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_ssh_key_id_ssh_keys_id_fk" FOREIGN KEY ("ssh_key_id") REFERENCES "public"."ssh_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocated_ports" ADD CONSTRAINT "allocated_ports_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocated_ports" ADD CONSTRAINT "allocated_ports_cube_id_cubes_id_fk" FOREIGN KEY ("cube_id") REFERENCES "public"."cubes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cubes" ADD CONSTRAINT "cubes_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cubes" ADD CONSTRAINT "cubes_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD CONSTRAINT "domain_mappings_cube_id_cubes_id_fk" FOREIGN KEY ("cube_id") REFERENCES "public"."cubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_cube_id_cubes_id_fk" FOREIGN KEY ("cube_id") REFERENCES "public"."cubes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcp_mapping_whitelisted_ips" ADD CONSTRAINT "tcp_mapping_whitelisted_ips_mapping_id_tcp_port_mappings_id_fk" FOREIGN KEY ("mapping_id") REFERENCES "public"."tcp_port_mappings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcp_port_mappings" ADD CONSTRAINT "tcp_port_mappings_cube_id_cubes_id_fk" FOREIGN KEY ("cube_id") REFERENCES "public"."cubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tcp_port_mappings" ADD CONSTRAINT "tcp_port_mappings_allocated_port_id_allocated_ports_id_fk" FOREIGN KEY ("allocated_port_id") REFERENCES "public"."allocated_ports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_snapshots" ADD CONSTRAINT "cube_snapshots_cube_id_cubes_id_fk" FOREIGN KEY ("cube_id") REFERENCES "public"."cubes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_snapshots" ADD CONSTRAINT "cube_snapshots_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_snapshots" ADD CONSTRAINT "cube_snapshots_storage_box_id_storage_boxes_id_fk" FOREIGN KEY ("storage_box_id") REFERENCES "public"."storage_boxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_snapshots" ADD CONSTRAINT "cube_snapshots_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_backups" ADD CONSTRAINT "cube_backups_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_backups" ADD CONSTRAINT "cube_backups_storage_box_id_storage_boxes_id_fk" FOREIGN KEY ("storage_box_id") REFERENCES "public"."storage_boxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cube_backups" ADD CONSTRAINT "cube_backups_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_boxes" ADD CONSTRAINT "storage_boxes_ssh_key_id_ssh_keys_id_fk" FOREIGN KEY ("ssh_key_id") REFERENCES "public"."ssh_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_cube_assignments_membership_id_idx" ON "member_cube_assignments" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "space_memberships_user_id_idx" ON "space_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invites_space_id_idx" ON "invites" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "invites_email_idx" ON "invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "user_ssh_keys_user_id_idx" ON "user_ssh_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "servers_status_idx" ON "servers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "servers_region_id_idx" ON "servers" USING btree ("region_id");--> statement-breakpoint
CREATE INDEX "servers_status_region_id_idx" ON "servers" USING btree ("status","region_id");--> statement-breakpoint
CREATE INDEX "cubes_status_idx" ON "cubes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cubes_server_id_idx" ON "cubes" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "cubes_space_id_idx" ON "cubes" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "cubes_status_space_id_idx" ON "cubes" USING btree ("status","space_id");--> statement-breakpoint
CREATE INDEX "domain_mappings_cube_id_idx" ON "domain_mappings" USING btree ("cube_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_mappings_domain_active_unique" ON "domain_mappings" USING btree ("domain") WHERE status IN ('pending', 'active');--> statement-breakpoint
CREATE INDEX "lifecycle_logs_entity_type_entity_id_idx" ON "lifecycle_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "lifecycle_logs_created_at_idx" ON "lifecycle_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "billing_events_space_id_idx" ON "billing_events" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "billing_events_cube_id_idx" ON "billing_events" USING btree ("cube_id");--> statement-breakpoint
CREATE INDEX "billing_events_created_at_idx" ON "billing_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "billing_events_space_id_type_idx" ON "billing_events" USING btree ("space_id","type");--> statement-breakpoint
CREATE INDEX "tcp_port_mappings_cube_id_idx" ON "tcp_port_mappings" USING btree ("cube_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_space_id_idx" ON "audit_logs" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_category_idx" ON "audit_logs" USING btree ("category");--> statement-breakpoint
CREATE INDEX "cube_snapshots_cube_id_status_idx" ON "cube_snapshots" USING btree ("cube_id","status");--> statement-breakpoint
CREATE INDEX "cube_backups_space_id_idx" ON "cube_backups" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "cube_backups_space_id_status_idx" ON "cube_backups" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "storage_boxes_is_active_idx" ON "storage_boxes" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_images_name_key" ON "platform_images" USING btree ("name");--> statement-breakpoint
CREATE INDEX "platform_images_kind_idx" ON "platform_images" USING btree ("kind");