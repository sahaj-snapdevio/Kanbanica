import { createId } from "@paralleldrive/cuid2"
import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { plans } from "@/db/schema/plans"
import { spaces } from "@/db/schema/spaces"

/**
 * One row per plan-credit grant (subscription activation or renewal). The
 * UNIQUE(provider_subscription_id, period_end) constraint makes each billing
 * period grant-at-most-once — idempotent against webhook redelivery. See the
 * foundation design, "Subscription lifecycle / Renewal".
 *
 * `provider_order_id` is set on RENEWAL grants (the Polar order id of the
 * subscription_cycle order) so a subsequent `order.refunded` webhook can
 * look up the grant in O(1). Activation grants leave it null — activation
 * refunds (rare) fall back to matching by `(provider_subscription_id,
 * period_end)`. `refunded_amount` is the cumulative USD already clawed back
 * for this grant, the idempotency key for partial / repeated refund events.
 * Same pattern as `credit_purchases.refunded_amount`.
 */
export const subscriptionCreditGrants = pgTable(
  "subscription_credit_grants",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    /** FK to the `plans` table — the plan whose included credit was granted. */
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 4 }).notNull(),
    /** `activation` | `renewal` — why the grant fired. */
    reason: text("reason").notNull(),
    /** Polar order id this grant came from (renewal grants only). */
    providerOrderId: text("provider_order_id"),
    /** Cumulative USD clawed back via refunds against this grant. */
    refundedAmount: numeric("refunded_amount", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("subscription_credit_grants_space_id_idx").on(t.spaceId),
    uniqueIndex("subscription_credit_grants_subscription_period_unique").on(
      t.providerSubscriptionId,
      t.periodEnd
    ),
    index("subscription_credit_grants_provider_order_idx").on(
      t.providerOrderId
    ),
  ]
)
