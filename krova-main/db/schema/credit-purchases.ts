import { createId } from "@paralleldrive/cuid2"
import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { spaces } from "@/db/schema/spaces"
import { user } from "@/db/schema/auth"

/**
 * Lifecycle of a credit top-up purchase:
 *   pending            — row inserted, awaiting payment
 *   paid               — payment confirmed, credit applied
 *   partially_refunded — some of the order was refunded
 *   refunded           — the full order (base + processing fee) was refunded
 *   failed             — the provider checkout-create call failed
 *   orphaned           — paid, but the space row no longer exists (operator attention)
 */
export const creditPurchaseStatus = pgEnum("credit_purchase_status", [
  "pending",
  "paid",
  "partially_refunded",
  "refunded",
  "failed",
  "orphaned",
])

/**
 * A customer-initiated prepaid credit purchase routed through a payment
 * provider (Polar). The webhook is the source of truth; this row is the
 * durable record, inserted BEFORE the provider checkout is created.
 */
export const creditPurchases = pgTable(
  "credit_purchases",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    initiatedByUserId: text("initiated_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    paymentProvider: text("payment_provider").notNull(),
    providerCheckoutId: text("provider_checkout_id"),
    providerOrderId: text("provider_order_id"),
    amount: numeric("amount", { precision: 12, scale: 4 }).notNull(),
    /**
     * The processing fee that was grossed up on top of `amount`. Column kept
     * named `surcharge_amount` for backward compatibility with the original
     * migration — semantics are unchanged (it is the payment-processor fee).
     */
    surchargeAmount: numeric("surcharge_amount", {
      precision: 12,
      scale: 4,
    }).notNull(),
    refundedAmount: numeric("refunded_amount", { precision: 12, scale: 4 })
      .notNull()
      .default("0"),
    status: creditPurchaseStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [
    index("credit_purchases_space_id_created_at_idx").on(
      t.spaceId,
      t.createdAt
    ),
    uniqueIndex("credit_purchases_provider_order_id_unique").on(
      t.providerOrderId
    ),
    // Webhook + reconcile look the row up by checkout id — make it a
    // DB-enforced invariant that exactly one row exists per checkout.
    // (Postgres treats NULLs as distinct, so pre-checkout/failed rows are fine.)
    uniqueIndex("credit_purchases_provider_checkout_id_unique").on(
      t.providerCheckoutId
    ),
  ]
)
