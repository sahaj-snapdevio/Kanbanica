ALTER TYPE "public"."billing_event_type" ADD VALUE 'prorated_charge' BEFORE 'credit_grant';--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "current_kernel_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "servers" ADD COLUMN "current_rootfs_versions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN "booted_kernel_version" integer;--> statement-breakpoint
ALTER TABLE "cubes" ADD COLUMN "provisioned_rootfs_version" integer;--> statement-breakpoint
ALTER TABLE "platform_images" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;