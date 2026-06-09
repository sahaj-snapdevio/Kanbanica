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

import { spaces } from "@/db/schema/spaces"

/**
 * Verification state of a space's claim on a registrable domain:
 *   pending  — claim created; TXT record not yet confirmed.
 *   verified — TXT confirmed; the domain AND all its subdomains are locked to
 *              this space.
 *   failed   — auto-released by the `domain-claim.recheck` cron after the TXT
 *              record disappeared for DOMAIN_CLAIM_MAX_FAILED_CHECKS in a row.
 */
export const domainClaimStatus = pgEnum("domain_claim_status", [
  "pending",
  "verified",
  "failed",
])

/**
 * A space's ownership claim on a registrable domain (e.g. `acme.com`), proven
 * via a TXT record (`_krova-verify.<domain>` = `krova-domain-verification=<token>`).
 *
 * Once `verified`, the domain AND every hostname under it (subdomains +
 * wildcards) are LOCKED to `space_id` — no other space may map any hostname
 * under it (enforced in `addDomainAction`). This is space-wide "domain
 * locking." Claiming is optional + additive: an unclaimed domain still maps
 * first-come, so existing live domains are undisturbed.
 *
 * See docs/superpowers/specs/2026-06-02-space-domain-claims-design.md.
 */
export const spaceDomainClaims = pgTable(
  "space_domain_claims",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    /** Normalized (lowercase, no trailing dot) registrable domain, e.g. `acme.com`. */
    domain: text("domain").notNull(),
    /** Per-claim secret embedded in the TXT value: `krova-domain-verification=<token>`. */
    token: text("token").notNull(),
    status: domainClaimStatus("status").notNull().default("pending"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Last DNS check (the verify action or the recheck cron). */
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    /** Consecutive recheck misses; the lock auto-releases at
     *  DOMAIN_CLAIM_MAX_FAILED_CHECKS (config/platform.ts). Reset to 0 on a
     *  successful check. */
    failedChecks: integer("failed_checks").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("space_domain_claims_space_id_idx").on(t.spaceId),
    /** A space lists a given domain at most once. */
    uniqueIndex("space_domain_claims_space_domain_unique").on(
      t.spaceId,
      t.domain
    ),
    /** A domain is VERIFIED by at most one space — the DB-level cross-space
     *  lock (mirrors domain_mappings_domain_verified_unique). */
    uniqueIndex("space_domain_claims_domain_verified_unique")
      .on(t.domain)
      .where(sql`status = 'verified'`),
    /** Fast lookup for the addDomainAction enforcement query (domain IN parents). */
    index("space_domain_claims_domain_idx").on(t.domain),
  ]
)
