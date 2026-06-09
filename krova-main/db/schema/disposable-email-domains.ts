import { pgTable, text, timestamp } from "drizzle-orm/pg-core"

/**
 * Blocklist of disposable / temporary / spam-trap email-service domains
 * used to gate new signups in `lib/auth.ts` `sendMagicLink`.
 *
 * Lookup happens once per signup attempt — an indexed PK probe on an
 * average ~5,500-row table, sub-millisecond on a warm Postgres. No
 * in-process cache: the table is the single source of truth, and the
 * scale of the data is small enough that the latency of one round-trip
 * is acceptable on the human-paced signup path.
 *
 * Refreshed weekly by the `disposable-emails.refresh` pg-boss cron job
 * (Sundays at 04:00 UTC) AND on-demand by an operator via
 * `pnpm refresh:disposable-emails`. Both flows share
 * `lib/email-validation/refresh.ts` `refreshDisposableEmailDomains()`,
 * which pulls the canonical list from
 * `disposable-email-domains/disposable-email-domains` (CC0) and
 * idempotently replaces the table contents inside a single transaction
 * (TRUNCATE + bulk INSERT) — the table starts empty after migration so
 * the cron's first run on a fresh deploy populates it within a week,
 * or the operator can prime it earlier with the pnpm script.
 *
 * Domain values are stored lower-cased; the lookup helper in
 * `lib/email-validation/index.ts` lower-cases its input before the
 * query so casing never matters.
 */
export const disposableEmailDomains = pgTable("disposable_email_domains", {
  domain: text("domain").primaryKey(),
  addedAt: timestamp("added_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
