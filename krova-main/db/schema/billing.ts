import { createId } from "@paralleldrive/cuid2"
import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

import { spaces } from "@/db/schema/spaces"
import { cubes } from "@/db/schema/cubes"

export const billingEventType = pgEnum("billing_event_type", [
  // Cron-driven hourly cycle: billing.hourly worker fires at the top of each
  // hour and charges every running cube for the full hour just elapsed.
  "hourly_charge",
  // Operator/state-transition prorated charge: written by chargeProratedUsage
  // when a cube sleeps, is deleted, or has its VM stopped (snapshot restore,
  // state-sync orphan cleanup). Charges the fractional hours since
  // lastBilledAt — typically a few minutes' worth, not a full hour.
  "prorated_charge",
  "credit_grant",
  "credit_topup",
  "backup_storage_charge",
  // Sleep-storage charge: a sleeping cube's disk continues to occupy the host
  // filesystem even after CPU+RAM are released. ALWAYS charged hourly by
  // `billing.hourly` at `DISK_RATE × diskLimitGb × tier multiplier` per
  // hour (from config/platform.ts via `calculateSleepHourlyCost`). Same
  // per-GB rate and full-disk basis as the running-disk component — running
  // and sleeping cubes both occupy every allocated GB on the host. No
  // operator toggle — single source of truth lives in `config/platform.ts`.
  // Distinct from `hourly_charge` (running compute) and
  // `backup_storage_charge` (S3 backups) so reporting can split idle-host
  // disk cost from active compute cost.
  "sleep_storage_charge",
  "credit_refund",
  // Included plan credit granted on subscription activation / renewal.
  // Distinct from credit_grant (Orbit admin) so plan credit is reportable
  // separately. Routed through applyCreditTopup() like every other grant.
  "plan_credit",
  // Hour or fraction billed via Polar's meter (postpaid overage). Written
  // by billing-hourly when prepaid balance is exhausted and the space has
  // opted into overage. Reported to Polar after the tx commits (see
  // `polar_meter_reported_at`).
  "overage_charge",
])

export const billingEvents = pgTable(
  "billing_events",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    cubeId: text("cube_id").references(() => cubes.id, {
      onDelete: "set null",
    }),
    amount: numeric("amount", { precision: 12, scale: 4 }).notNull(),
    type: billingEventType("type").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Set by the post-commit reporter (or the `polar.meter-reconcile` cron)
     * when this row's overage event has been ingested into Polar's meter.
     * Only meaningful for type='overage_charge'; null for every other type.
     */
    polarMeterReportedAt: timestamp("polar_meter_reported_at", {
      withTimezone: true,
    }),
  },
  (t) => [
    index("billing_events_cube_id_idx").on(t.cubeId),
    index("billing_events_created_at_idx").on(t.createdAt),
    // Composite index for billing summary queries that filter by space + type
    index("billing_events_space_id_type_idx").on(t.spaceId, t.type),
    // Composite for the hot space-scoped, time-ordered query
    // (`WHERE space_id = ? ORDER BY created_at DESC`). Replaces the old
    // single-column space_id index — Postgres uses this composite's leading
    // column for space-only lookups too.
    index("billing_events_space_id_created_at_idx").on(
      t.spaceId,
      t.createdAt
    ),
  ]
)
