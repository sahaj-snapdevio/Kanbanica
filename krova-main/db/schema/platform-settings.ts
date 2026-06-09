import {
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

/**
 * Singleton table (id = 1, enforced by CHECK constraint) for operator-tweakable
 * platform globals. Replaces hard-coded constants in `config/platform.ts` for
 * fields the operator wants to change without a redeploy.
 */
export const platformSettings = pgTable("platform_settings", {
  id: integer("id").primaryKey().default(1).notNull(),
  paymentFeePercent: numeric("payment_fee_percent", {
    precision: 6,
    scale: 5,
  })
    .notNull()
    .default("0.07"),
  paymentFeeFlatUsd: numeric("payment_fee_flat_usd", {
    precision: 12,
    scale: 4,
  })
    .notNull()
    .default("0.40"),
  creditTopupMinUsd: numeric("credit_topup_min_usd", {
    precision: 12,
    scale: 4,
  })
    .notNull()
    .default("10"),
  creditTopupMaxUsd: numeric("credit_topup_max_usd", {
    precision: 12,
    scale: 4,
  })
    .notNull()
    .default("1000"),
  creditTopupDefaultUsd: numeric("credit_topup_default_usd", {
    precision: 12,
    scale: 4,
  })
    .notNull()
    .default("50"),
  overageCapMinUsd: numeric("overage_cap_min_usd", {
    precision: 12,
    scale: 4,
  })
    .notNull()
    .default("5"),
  overageCapMaxUsd: numeric("overage_cap_max_usd", {
    precision: 12,
    scale: 4,
  })
    .notNull()
    .default("1000"),
  overageDefaultCapMultiplier: numeric("overage_default_cap_multiplier", {
    precision: 6,
    scale: 4,
  })
    .notNull()
    .default("2"),
  planCreditGrantCooldownDays: integer("plan_credit_grant_cooldown_days")
    .notNull()
    .default(30),
  lowBalanceThresholdDefaultUsd: numeric("low_balance_threshold_default_usd", {
    precision: 12,
    scale: 4,
  })
    .notNull()
    .default("5"),
  lowBalanceThresholdMinUsd: numeric("low_balance_threshold_min_usd", {
    precision: 12,
    scale: 4,
  })
    .notNull()
    .default("5"),
  /**
   * Per-GB-month rate for backup storage billing. Charged hourly by
   * `billing.hourly` on every space with `complete` backups: each backup
   * contributes `sizeBytes / 1024^3` GB × rate × (1/730 hours/month).
   * $0.01/GB/mo is the conservative default (≈ $0.05/mo for a 5 GB backup,
   * which covers S3 cost plus margin). Snapshots are NOT billed under this
   * rate — only backups, since snapshots are bundled in the plan.
   */
  backupStorageRatePerGbPerMonth: numeric(
    "backup_storage_rate_per_gb_per_month",
    {
      precision: 12,
      scale: 6,
    }
  )
    .notNull()
    .default("0.01"),
  /**
   * **DEPRECATED — no longer read by any code path.** Sleep-storage billing
   * is now ALWAYS on and uses `DISK_RATE × diskLimitGb × tier multiplier`
   * per hour — same per-GB rate and full-disk basis as the running-disk
   * component (single source of truth: `config/platform.ts`, via
   * `calculateSleepHourlyCost` in `lib/cost-shared.ts`). Setting
   * `DISK_RATE = 0` is the only way to disable sleep-storage billing, and
   * it also disables running-disk billing — one knob, one truth.
   *
   * Kept in the schema per Rule 40 — the column still exists in production
   * with historical values, and code is no longer reading it as of this
   * deploy. A follow-up migration can `DROP COLUMN` once this deploy has
   * stabilised in production (the standard Rule-40 two-step removal: stop
   * reading, deploy, then drop).
   */
  sleepStorageRatePerGbPerMonth: numeric(
    "sleep_storage_rate_per_gb_per_month",
    {
      precision: 12,
      scale: 6,
    }
  )
    .notNull()
    // Schema default kept at the original `"0.01"` to match production
    // (migration 0058). Changing it would prompt `pnpm db:generate` to emit a
    // spurious default-alter migration on next schema change. The value is
    // moot — no code reads this column — so any non-null default works. The
    // follow-up `DROP COLUMN` migration will retire it cleanly.
    .default("0.01"),
  /**
   * Polar's product id for the one-shot credit top-up. Created once in the
   * Polar dashboard and pasted into Orbit → Platform Settings. Null = top-up
   * checkout is inert (the create-checkout call throws a loud error).
   * Held here rather than env so it can be rotated without a redeploy.
   */
  polarCreditProductId: text("polar_credit_product_id"),
  /**
   * Polar's meter id for postpaid overage billing (event name
   * `krova_overage_usd`). Created once in the Polar dashboard and pasted into
   * Orbit. Null = overage event reporting is inert; the worker throws so the
   * meter-reconcile cron retries instead of silently dropping events.
   */
  polarOverageMeterId: text("polar_overage_meter_id"),
  /**
   * Operator-editable per-tier disk QoS caps (the disk-I/O overhaul rate_limiter
   * + io.max sizing). One entry per vCPU tier (aligned to CREDIT_RATE_TIERS).
   * NULL = use the `DISK_RATE_LIMITER_TIERS` defaults in `config/platform.ts`
   * (the seed/fallback); an Orbit save writes the full array here so caps can be
   * tuned without a redeploy. Read via `getDiskQosTiers()` (cached 60s); applies
   * on each cube's NEXT cold boot. `minVcpus`/`maxVcpus`/`label` mirror the
   * billing tiers and are not operator-edited; `bandwidthMbps`/`iops`/
   * `burstMultiplier` are the tunable caps. Validated on write (Rule 32).
   */
  diskQosTiers: jsonb("disk_qos_tiers").$type<
    {
      minVcpus: number
      maxVcpus: number | null
      label: string
      // null = UNLIMITED on that axis (default; the customer uses the full disk).
      bandwidthMbps: number | null
      iops: number | null
      burstMultiplier: number
      recommendedBandwidthMbps: number
      recommendedIops: number
    }[]
  >(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})
