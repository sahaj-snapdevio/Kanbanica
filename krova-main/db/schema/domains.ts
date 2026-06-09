import { createId } from "@paralleldrive/cuid2"
import { sql } from "drizzle-orm"
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { cubes } from "@/db/schema/cubes"

/**
 * Routing state — whether the domain is currently attached to Caddy and
 * actively serving traffic. Independent of the verification flow below.
 */
export const domainStatus = pgEnum("domain_status", [
  "pending",
  "active",
  "stopping",
])

/**
 * DNS verification state — was a `dig <domain>` resolved to the platform's
 * server IP? Caddy's on-demand TLS `ask` endpoint only approves verified
 * rows, so an attacker cannot trigger Let's Encrypt rate-limit abuse by
 * pointing thousands of unrelated hostnames at the platform.
 */
export const domainVerificationStatus = pgEnum(
  "domain_verification_status",
  ["pending_dns", "verified", "failed"]
)

/**
 * TLS provisioning state — populated by Caddy after on-demand issuance.
 * Surfaced in the UI for "TLS ready" / "TLS pending" badges.
 */
export const domainTlsStatus = pgEnum("domain_tls_status", [
  "none",
  "pending",
  "ready",
  "failed",
])

/**
 * Cube-level domain mapping. ONE source of truth for every hostname that
 * routes traffic to a Krova cube — customer-supplied custom domains
 * registered as Cloudflare for SaaS Custom Hostnames.
 *
 * Uniqueness:
 *   - `(cube_id, domain)` — a single cube cannot list the same hostname
 *     twice.
 *   - Partial unique on `(domain) WHERE verification_status = 'verified'` —
 *     at most one cube globally can hold a verified claim on a hostname.
 *     Pending/failed rows are not constrained, so multiple cubes can have
 *     pending claims on the same domain. The legitimate owner wins by
 *     pointing real DNS at our server, which an attacker can't do for a
 *     domain they don't control.
 */
export const domainMappings = pgTable(
  "domain_mappings",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    cubeId: text("cube_id")
      .notNull()
      .references(() => cubes.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    /** Routing port on the cube. */
    port: integer("port"),
    status: domainStatus("status").notNull().default("pending"),

    // ── Verification flow ─────────────────────────────────────────────
    verificationStatus: domainVerificationStatus("verification_status")
      .notNull()
      .default("pending_dns"),
    verificationCheckedAt: timestamp("verification_checked_at", {
      withTimezone: true,
    }),
    /** Count of verify-cron ticks since last verified status. Reset on flip. */
    verifyAttempts: integer("verify_attempts").notNull().default(0),
    /** Last error surface for the UI (e.g. "DNS resolves to a different server"). */
    verificationError: text("verification_error"),

    /** TLS provisioning state, populated by Caddy after on-demand issuance.
     *  Surfaced in the UI for "TLS ready" / "TLS pending" badges. */
    tlsStatus: domainTlsStatus("tls_status").notNull().default("none"),

    /** Cloudflare for SaaS Custom Hostname ID — set once the domain is
     *  registered with Cloudflare; needed to PATCH the origin and DELETE.
     *  Null for rows not yet migrated to Cloudflare for SaaS. */
    cloudflareHostnameId: text("cloudflare_hostname_id"),
    /** Raw Cloudflare hostname/SSL status (e.g. "pending", "active") —
     *  drives the live UI badge. Null until registered with Cloudflare. */
    cloudflareStatus: text("cloudflare_status"),
    /** Last time `cloudflare.hostname-poll` read this hostname's live status.
     *  Lets the poll re-check ALREADY-`active` rows on a slow cadence (~30 min)
     *  so a regressed / expired cert flips its badge back instead of showing a
     *  stale "active" forever — without re-polling every active hostname each
     *  1-min tick. Null = never polled (treated as due). */
    cloudflareCheckedAt: timestamp("cloudflare_checked_at", {
      withTimezone: true,
    }),

    /** Last time an edge-cache purge was REQUESTED for this hostname. Stamped
     *  at enqueue (not worker completion) and drives the per-domain purge
     *  cooldown so a customer can't spam Cloudflare's purge rate limit. Null =
     *  never purged. See lib/domains/cache-purge.ts + lib/cloudflare/cache.ts. */
    lastCachePurgeAt: timestamp("last_cache_purge_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("domain_mappings_cube_id_idx").on(t.cubeId),
    /** Per-cube uniqueness: same cube can't list the same hostname twice. */
    uniqueIndex("domain_mappings_cube_domain_unique").on(t.cubeId, t.domain),
    /** Cross-cube partial unique: at most one verified claim per hostname. */
    uniqueIndex("domain_mappings_domain_verified_unique")
      .on(t.domain)
      .where(sql`verification_status = 'verified'`),
    /** Index for the verify cron's "find pending rows" scan. */
    index("domain_mappings_pending_verify_idx")
      .on(t.verificationStatus, t.verificationCheckedAt)
      .where(sql`verification_status = 'pending_dns'`),
  ]
)
