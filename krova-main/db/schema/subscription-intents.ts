import { createId } from "@paralleldrive/cuid2"
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { plans } from "@/db/schema/plans"
import { spaces } from "@/db/schema/spaces"

/**
 * Lifecycle of a subscription checkout intent:
 *   pending   — row inserted, Polar checkout created, awaiting activation
 *   completed — subscription.activated processed, spaces.plan_id updated
 *   failed    — the provider checkout-create call failed
 *   orphaned  — activated, but the space row no longer exists
 */
export const subscriptionIntentStatus = pgEnum("subscription_intent_status", [
  "pending",
  "completed",
  "failed",
  "orphaned",
])

/**
 * A customer-initiated subscription checkout. The webhook is the source of
 * truth; this row is the durable record (inserted BEFORE the provider checkout
 * is created) that lets the reconcile cron heal a lost activation webhook.
 */
export const subscriptionIntents = pgTable(
  "subscription_intents",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    /** FK to the `plans` table — the plan the customer is subscribing to. */
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    paymentProvider: text("payment_provider").notNull(),
    providerCheckoutId: text("provider_checkout_id"),
    status: subscriptionIntentStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("subscription_intents_space_id_created_at_idx").on(
      t.spaceId,
      t.createdAt
    ),
    uniqueIndex("subscription_intents_provider_checkout_id_unique").on(
      t.providerCheckoutId
    ),
  ]
)
