import { createId } from "@paralleldrive/cuid2"
import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

/** Public plans are visible to all spaces; custom plans only to assigned spaces. */
export const planVisibility = pgEnum("plan_visibility", ["public", "custom"])

/**
 * The plan catalog. Replaces the old `plan_tier` pgEnum + the hardcoded
 * `PLANS` config matrix. Operator-editable from Orbit. Each paid plan has a
 * Polar product id; the seed provisions products on first run.
 */
export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    priceUsd: numeric("price_usd", { precision: 12, scale: 4 }).notNull(),
    includedCreditUsd: numeric("included_credit_usd", {
      precision: 12,
      scale: 4,
    }).notNull(),
    maxConcurrentCubes: integer("max_concurrent_cubes"),
    maxVcpus: integer("max_vcpus").notNull(),
    maxRamMb: integer("max_ram_mb").notNull(),
    maxDiskGb: integer("max_disk_gb").notNull(),
    maxSeats: integer("max_seats"),
    maxBackups: integer("max_backups"),
    maxDomains: integer("max_domains"),
    // Auto-snapshot cadence in hours. NULL = auto-snapshots disabled for
    // this plan (Trial). Validated >= 2 in the Orbit form; lower than that
    // hammers the host I/O.
    autoSnapshotCadenceHours: integer("auto_snapshot_cadence_hours"),
    // Retention buckets passed to `restic forget` for auto snapshots.
    // All three default to 0 → no auto rotation kept.
    autoSnapshotKeepLast: integer("auto_snapshot_keep_last")
      .notNull()
      .default(0),
    autoSnapshotKeepDaily: integer("auto_snapshot_keep_daily")
      .notNull()
      .default(0),
    autoSnapshotKeepWeekly: integer("auto_snapshot_keep_weekly")
      .notNull()
      .default(0),
    // Hard cap on user-created (manual) snapshots per cube. 0 = customer
    // cannot create manual snapshots on this plan.
    maxManualSnapshotsPerCube: integer("max_manual_snapshots_per_cube")
      .notNull()
      .default(0),
    allowTopup: boolean("allow_topup").notNull().default(true),
    allowOverage: boolean("allow_overage").notNull().default(true),
    visibility: planVisibility("visibility").notNull().default("public"),
    isDefaultForNewSpaces: boolean("is_default_for_new_spaces")
      .notNull()
      .default(false),
    isArchived: boolean("is_archived").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    polarProductId: text("polar_product_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("plans_slug_unique").on(t.slug),
    uniqueIndex("plans_polar_product_id_unique")
      .on(t.polarProductId)
      .where(sql`${t.polarProductId} IS NOT NULL`),
    uniqueIndex("plans_default_unique")
      .on(t.isDefaultForNewSpaces)
      .where(sql`${t.isDefaultForNewSpaces} = true`),
    index("plans_visibility_idx").on(t.visibility),
  ]
)
