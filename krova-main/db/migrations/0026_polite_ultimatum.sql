ALTER TABLE "servers" ADD COLUMN IF NOT EXISTS "cf_origin_hostname" text;--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD COLUMN IF NOT EXISTS "cloudflare_hostname_id" text;--> statement-breakpoint
ALTER TABLE "domain_mappings" ADD COLUMN IF NOT EXISTS "cloudflare_status" text;
