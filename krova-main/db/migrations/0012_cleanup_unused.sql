-- Cleanup pass: drop columns that were added speculatively but never read or
-- written by any code path. Audit reference: agent code-explorer 2026-05-01.
--
-- All affected columns have zero references outside the schema definition.
-- Safe to drop; if a future phase needs them they can be re-added.

-- ── deploys ──────────────────────────────────────────────────────────
ALTER TABLE "deploys" DROP COLUMN IF EXISTS "replicas";--> statement-breakpoint
ALTER TABLE "deploys" DROP COLUMN IF EXISTS "railpack_version";--> statement-breakpoint
ALTER TABLE "deploys" DROP COLUMN IF EXISTS "build_vcpus";--> statement-breakpoint
ALTER TABLE "deploys" DROP COLUMN IF EXISTS "build_ram_mb";--> statement-breakpoint
ALTER TABLE "deploys" DROP COLUMN IF EXISTS "build_disk_gb";--> statement-breakpoint

-- ── domain_mappings ─────────────────────────────────────────────────
ALTER TABLE "domain_mappings" DROP COLUMN IF EXISTS "redirect_to_primary";--> statement-breakpoint
ALTER TABLE "domain_mappings" DROP COLUMN IF EXISTS "tls_cert_resolver";--> statement-breakpoint

-- ── git_providers ───────────────────────────────────────────────────
ALTER TABLE "git_providers" DROP COLUMN IF EXISTS "gitlab_base_url";--> statement-breakpoint
ALTER TABLE "git_providers" DROP COLUMN IF EXISTS "gitea_base_url";--> statement-breakpoint
ALTER TABLE "git_providers" DROP COLUMN IF EXISTS "shared_with_space";
