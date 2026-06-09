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
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { user } from "@/db/schema/auth"
import { cubes } from "@/db/schema/cubes"
import { plans } from "@/db/schema/plans"

export const spaces = pgTable("spaces", {
  id: text("id").primaryKey().$defaultFn(createId),
  name: text("name").notNull(),
  creditBalance: numeric("credit_balance", { precision: 12, scale: 4 })
    .notNull()
    .default("0"),
  /** Per-space balance level at/under which the hourly worker sends the
   *  low-balance email. Default + hard floor come from `platform_settings`. */
  lowBalanceThreshold: numeric("low_balance_threshold", {
    precision: 12,
    scale: 4,
  })
    .notNull()
    .default("5"),
  /** FK to the `plans` table — the space's current plan. */
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id),
  /** Per-space limit overrides — all nullable. Null = use the plan's value. */
  overrideMaxConcurrentCubes: integer("override_max_concurrent_cubes"),
  overrideMaxVcpus: integer("override_max_vcpus"),
  overrideMaxRamMb: integer("override_max_ram_mb"),
  overrideMaxDiskGb: integer("override_max_disk_gb"),
  overrideMaxSeats: integer("override_max_seats"),
  overrideMaxBackups: integer("override_max_backups"),
  overrideMaxDomains: integer("override_max_domains"),
  overrideIncludedCreditUsd: numeric("override_included_credit_usd", {
    precision: 12,
    scale: 4,
  }),
  overrideAllowTopup: boolean("override_allow_topup"),
  overrideAllowOverage: boolean("override_allow_overage"),
  overrideOverageCapMaxUsd: numeric("override_overage_cap_max_usd", {
    precision: 12,
    scale: 4,
  }),
  /** Payment provider holding the subscription (e.g. `polar`). Null on Trial. */
  paymentProvider: text("payment_provider"),
  /**
   * Provider-side customer id (e.g. Polar's `cus_…` / UUID). Captured from
   * the first subscription / order event we see for the space. Independent
   * of the customer's `external_id`, which Polar SHARES across sibling
   * spaces of the same user (one Polar customer per email — `external_id`
   * is immutable + pinned to the first space that subscribed). With this
   * column we can address the right customer record per-space for
   * `subscriptions.list({metadata.spaceId})`, meter events, and customer
   * profile updates without colliding with siblings.
   */
  polarCustomerId: text("polar_customer_id"),
  /** Provider-side subscription id. Null on Trial / canceled. */
  providerSubscriptionId: text("provider_subscription_id"),
  /** Mirror of the provider subscription status (`active` / `past_due` / …). */
  subscriptionStatus: text("subscription_status"),
  /** End of the current paid period (used as the overage-counter reset key). */
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  /**
   * True iff the subscription is set to cancel at `currentPeriodEnd`. Polar
   * keeps a canceling subscription in `status="active"` until the period
   * actually ends, so the UI needs this flag to render "Ending on X" and
   * expose a "Resume subscription" button. Persisted from the
   * `cancelAtPeriodEnd` field on every subscription webhook (canceled,
   * uncanceled, updated, synced, renewed). Reset to false on
   * activation / a fresh new-period renewal. The customer cancel + resume
   * actions in `app/actions/subscriptions.ts` flip the column through
   * the Polar webhook round-trip, never directly.
   */
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  /**
   * Timestamp of the last plan-credit grant. The grant cooldown
   * (`platform_settings.planCreditGrantCooldownDays`, default 30) reads this
   * so a subscribe/cancel/resubscribe loop cannot farm fresh allotments.
   */
  lastPlanCreditGrantAt: timestamp("last_plan_credit_grant_at", {
    withTimezone: true,
  }),
  /**
   * `occurredAt` of the last subscription webhook the handler applied. An
   * incoming event with an equal-or-older occurredAt is ignored, so an
   * out-of-order Polar redelivery cannot regress plan / period state.
   */
  subscriptionEventAt: timestamp("subscription_event_at", {
    withTimezone: true,
  }),
  /**
   * Whether the space has opted into postpaid overage. Default false; Trial
   * is server-side blocked from enabling. When true AND subscriptionStatus
   * is "active", usage beyond `creditBalance` is reported to Polar's meter
   * (up to `overageCapUsd` per billing period).
   */
  overageEnabled: boolean("overage_enabled").notNull().default(false),
  /** Customer-set hard cap on overage per billing period (USD). */
  overageCapUsd: numeric("overage_cap_usd", { precision: 12, scale: 4 })
    .notNull()
    .default("0"),
  /**
   * Running counter of overage accrued in the CURRENT billing period (USD).
   * Reset to 0 by the subscription handler when `currentPeriodEnd` advances.
   */
  thisPeriodOverageUsd: numeric("this_period_overage_usd", {
    precision: 12,
    scale: 4,
  })
    .notNull()
    .default("0"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const spaceMemberships = pgTable(
  "space_memberships",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    isOwner: boolean("is_owner").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.userId, t.spaceId),
    index("space_memberships_user_id_idx").on(t.userId),
    /** At most one owner per space — invariant enforced at the DB level. */
    uniqueIndex("space_memberships_one_owner_per_space")
      .on(t.spaceId)
      .where(sql`is_owner = true`),
  ]
)

export const permission = pgEnum("permission", [
  "cube.view",
  "cube.create",
  "cube.manage",
  "billing.view",
  "billing.manage",
  "members.invite",
  "members.manage",
  "webhook.manage",
])

export const memberPermissions = pgTable(
  "member_permissions",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    membershipId: text("membership_id")
      .notNull()
      .references(() => spaceMemberships.id, { onDelete: "cascade" }),
    permission: permission("permission").notNull(),
  },
  (t) => [unique().on(t.membershipId, t.permission)]
)

export const memberCubeAssignments = pgTable(
  "member_cube_assignments",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    membershipId: text("membership_id")
      .notNull()
      .references(() => spaceMemberships.id, { onDelete: "cascade" }),
    cubeId: text("cube_id")
      .notNull()
      .references(() => cubes.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.membershipId, t.cubeId),
    index("member_cube_assignments_membership_id_idx").on(t.membershipId),
  ]
)
