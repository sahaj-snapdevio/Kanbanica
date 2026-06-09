/**
 * Hourly backstop for missed Polar webhooks. Polls pending `credit_purchases`
 * rows and heals any that Polar has already marked paid but whose webhook was
 * never delivered (or was delivered but processing failed). Runs at :30 past
 * each hour — offset from `billing.hourly` at :00 to avoid contention.
 *
 * Idempotency is guaranteed by `applyPaidTopup`, which only flips a row from
 * `pending` to `paid` inside an atomic transaction. A second call for the same
 * checkout id is always a safe no-op.
 */

import { and, eq, gte, isNotNull } from "drizzle-orm";
import type { Job } from "pg-boss";
import { creditPurchases } from "@/db/schema";
import { applyPaidTopup } from "@/lib/billing/apply-paid-topup";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getPolarClient } from "@/lib/payments/polar/client";

const WINDOW_HOURS = 48;

export async function handleBillingTopupReconcile(_jobs: Job[]): Promise<void> {
  void _jobs;

  if (!env.POLAR_ACCESS_TOKEN) {
    // Polar not configured — nothing to reconcile.
    return;
  }

  console.log("[billing-topup-reconcile] starting reconciliation sweep");

  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000);

  // Find all pending purchases created within the last 48h that have a
  // provider_checkout_id (so we can look them up in Polar).
  const pendingRows = await db
    .select({
      id: creditPurchases.id,
      providerCheckoutId: creditPurchases.providerCheckoutId,
    })
    .from(creditPurchases)
    .where(
      and(
        eq(creditPurchases.status, "pending"),
        gte(creditPurchases.createdAt, since),
        isNotNull(creditPurchases.providerCheckoutId)
      )
    );

  if (pendingRows.length === 0) {
    console.log("[billing-topup-reconcile] no pending purchases to check");
    return;
  }

  console.log(
    `[billing-topup-reconcile] checking ${pendingRows.length} pending purchase(s)`
  );

  const polar = getPolarClient();
  let healed = 0;

  for (const row of pendingRows) {
    // providerCheckoutId is guaranteed non-null by the isNotNull filter above.
    const checkoutId = row.providerCheckoutId!;

    try {
      // The Polar SDK supports `checkoutId` as a direct filter on orders.list().
      // Returns a PageIterator; the first page is enough — there is at most one
      // paid order per checkout.
      const page = await polar.orders.list({ checkoutId, limit: 5 });
      const orders = page.result.items;

      // Find the first order with status "paid".
      const paidOrder = orders.find((o) => o.status === "paid");

      if (!paidOrder) {
        // No paid order yet — checkout may still be open or genuinely unfulfilled.
        continue;
      }

      const outcome = await applyPaidTopup({
        providerCheckoutId: checkoutId,
        providerOrderId: paidOrder.id,
      });

      if (outcome.result === "credited") {
        healed++;
        console.warn(
          `[billing-topup-reconcile] healed missed credit: purchaseId=${outcome.purchaseId} checkoutId=${checkoutId} orderId=${paidOrder.id}`
        );
      } else if (outcome.result === "already_processed") {
        // Webhook beat us — row was already flipped. Normal; not a problem.
      } else if (outcome.result === "orphaned") {
        console.warn(
          `[billing-topup-reconcile] orphaned purchase: purchaseId=${outcome.purchaseId} checkoutId=${checkoutId} (space no longer exists)`
        );
      } else {
        // "not_found" — should not happen since we fetched the row ourselves,
        // but guard defensively.
        console.warn(
          `[billing-topup-reconcile] unexpected not_found for checkoutId=${checkoutId}`
        );
      }
    } catch (err) {
      // One failure must not abort the sweep — log and continue.
      console.error(
        `[billing-topup-reconcile] error processing checkoutId=${checkoutId}:`,
        err
      );
    }
  }

  console.log(
    `[billing-topup-reconcile] done — checked ${pendingRows.length} row(s), healed ${healed}`
  );
}
