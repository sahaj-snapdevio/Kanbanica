import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import * as schema from "@/db/schema";
import { applyPaidTopup } from "@/lib/billing/apply-paid-topup";
import { applySubscriptionRefund } from "@/lib/billing/apply-subscription-refund";
import { reconcileSpaceSubscription } from "@/lib/billing/reconcile-subscription";
import { handleSubscriptionEvent } from "@/lib/billing/subscription-handler";
import { db } from "@/lib/db";
import { enqueueEmailitSyncForSpaceOwner } from "@/lib/emailit/enqueue-sync";
import { env } from "@/lib/env";
import { getPaymentProvider } from "@/lib/payments";
import { WebhookVerificationError } from "@/lib/payments/polar/provider";
import type { NormalizedPaymentEvent } from "@/lib/payments/types";

/**
 * Polar webhook receiver. Verifies the Standard-Webhooks signature via the
 * payment-provider abstraction, normalizes the event, and dispatches:
 *   topup.paid     → idempotent flip+apply (lib/billing/apply-paid-topup)
 *   topup.refunded → base-fraction clawback (handleRefund below)
 * See docs/superpowers/specs/2026-05-18-polar-credit-topup-design.md, "Webhook route".
 */
export async function POST(request: Request) {
  if (!env.POLAR_WEBHOOK_SECRET) {
    return new NextResponse("webhook not configured", { status: 503 });
  }

  const rawBody = await request.text();
  const headerObj: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headerObj[k] = v;
  });

  let event: NormalizedPaymentEvent;
  try {
    event = await getPaymentProvider().verifyWebhook(rawBody, headerObj);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return new NextResponse("invalid signature", { status: 403 });
    }
    console.error("[polar webhook] verify error:", err);
    return new NextResponse("verify error", { status: 500 });
  }

  try {
    if (event.kind === "topup.paid") {
      const outcome = await applyPaidTopup({
        providerCheckoutId: event.providerCheckoutId,
        providerOrderId: event.providerOrderId,
      });
      if (outcome.result === "not_found") {
        // Row not committed yet (near-impossible given row-before-checkout) —
        // 503 so Polar retries; never a silent 200.
        return new NextResponse("purchase row not found — retry", {
          status: 503,
        });
      }
      if (outcome.result === "orphaned") {
        console.error(
          "[polar webhook] paid order for a deleted space — purchase marked orphaned:",
          outcome.purchaseId
        );
      }
      return new NextResponse("ok", { status: 200 });
    }

    if (event.kind === "topup.refunded") {
      const outcome = await handleRefund(
        event.providerCheckoutId,
        event.cumulativeRefundedCents
      );
      if (outcome.result === "retry") {
        // The matching order.paid has not been processed yet — 503 so Polar
        // redelivers; never a silent 200 that would drop the refund.
        return new NextResponse("refund pending order.paid — retry", {
          status: 503,
        });
      }
      if (outcome.spaceId) {
        await enqueueEmailitSyncForSpaceOwner(outcome.spaceId);
      }
      return new NextResponse("ok", { status: 200 });
    }

    if (
      event.kind === "subscription.synced" ||
      event.kind === "subscription.renewal_paid"
    ) {
      await handleSubscriptionEvent(event);
      return new NextResponse("ok", { status: 200 });
    }

    if (event.kind === "subscription.refunded") {
      const outcome = await applySubscriptionRefund({
        providerSubscriptionId: event.providerSubscriptionId,
        providerOrderId: event.providerOrderId,
        cumulativeRefundedCents: event.cumulativeRefundedCents,
      });
      if (outcome.result === "retry") {
        return new NextResponse("subscription refund pending grant — retry", {
          status: 503,
        });
      }
      if (outcome.spaceId) {
        await enqueueEmailitSyncForSpaceOwner(outcome.spaceId);
      }
      return new NextResponse("ok", { status: 200 });
    }

    if (event.kind === "checkout.expired") {
      await markCheckoutExpired(event.providerCheckoutId);
      return new NextResponse("ok", { status: 200 });
    }

    if (event.kind === "customer.deleted") {
      await clearDeletedPolarCustomer(event.providerCustomerId);
      return new NextResponse("ok", { status: 200 });
    }

    if (event.kind === "customer.state_changed") {
      await reconcileSpacesByPolarCustomerId(event.providerCustomerId);
      return new NextResponse("ok", { status: 200 });
    }

    return new NextResponse("ignored", { status: 200 });
  } catch (err) {
    console.error("[polar webhook] handler error:", err);
    return new NextResponse("handler error — retry", { status: 500 });
  }
}

/**
 * `retry` → caller returns 503 so Polar redelivers.
 * `done` → 200. `spaceId` set when a clawback actually ran, so the caller can
 * post-commit fan-out (e.g. enqueue an EmailIt sync to refresh credit_balance).
 */
type RefundOutcome =
  | { result: "retry" }
  | { result: "done"; spaceId: string | null };

/**
 * Refund handler. Acts only on `paid` / `partially_refunded` rows. Claws back
 * the BASE fraction of the newly-refunded amount, capped at the balance.
 * Cumulative-aware: idempotent against redelivery + multiple partial refunds.
 * Returns `retry` when the row is still `pending` (the matching order.paid has
 * not been processed yet) or missing — so the refund is never silently dropped.
 */
async function handleRefund(
  providerCheckoutId: string,
  cumulativeRefundedCents: number
): Promise<RefundOutcome> {
  return db.transaction(async (tx): Promise<RefundOutcome> => {
    const [row] = await tx
      .select()
      .from(schema.creditPurchases)
      .where(eq(schema.creditPurchases.providerCheckoutId, providerCheckoutId))
      .for("update")
      .limit(1);

    if (!row) {
      // Row not committed yet (near-impossible given row-before-checkout) —
      // retry rather than drop the refund.
      console.warn(
        "[polar webhook] refund for unknown checkout — retry",
        providerCheckoutId
      );
      return { result: "retry" };
    }
    if (row.status === "pending") {
      // order.paid has not landed yet — retry so the clawback is not lost
      // against a balance the credit has not been applied to.
      console.warn(
        "[polar webhook] refund before order.paid processed — retry",
        row.id
      );
      return { result: "retry" };
    }
    if (row.status !== "paid" && row.status !== "partially_refunded") {
      // failed / orphaned / fully refunded — terminal, nothing to claw back.
      console.warn(
        "[polar webhook] refund on non-actionable row, ignoring",
        row.id,
        row.status
      );
      return { result: "done", spaceId: null };
    }

    const base = Number.parseFloat(row.amount);
    // `surchargeAmount` is the DB column name (kept for back-compat); the
    // value is the processing fee that was grossed up at checkout.
    const fee = Number.parseFloat(row.surchargeAmount);
    const total = base + fee;
    const totalCents = Math.round(total * 100);
    const alreadyRefundedCents = Math.round(
      Number.parseFloat(row.refundedAmount) * 100
    );
    const newlyRefundedCents = cumulativeRefundedCents - alreadyRefundedCents;
    if (newlyRefundedCents <= 0) {
      return { result: "done", spaceId: null }; // already processed / redelivery
    }

    const baseClawbackUsd =
      total > 0 ? (newlyRefundedCents / 100) * (base / total) : 0;

    const [space] = await tx
      .select({ creditBalance: schema.spaces.creditBalance })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, row.spaceId))
      .for("update")
      .limit(1);

    if (space) {
      const balance = Number.parseFloat(space.creditBalance);
      const debit = Math.min(baseClawbackUsd, Math.max(0, balance));
      if (debit > 0) {
        await tx
          .update(schema.spaces)
          .set({
            creditBalance: (balance - debit).toFixed(4),
            updatedAt: new Date(),
          })
          .where(eq(schema.spaces.id, row.spaceId));
        await tx.insert(schema.billingEvents).values({
          id: createId(),
          spaceId: row.spaceId,
          amount: debit.toFixed(4),
          type: "credit_refund",
          description: "Refund clawback (Polar)",
        });
      }
    }

    // Integer-cent comparison — float addition of two numeric(12,4) values can
    // drift (e.g. 12.469000000000002), which would wrongly leave a fully
    // refunded row stuck on `partially_refunded`.
    const newRefundedCents = alreadyRefundedCents + newlyRefundedCents;
    await tx
      .update(schema.creditPurchases)
      .set({
        refundedAmount: (newRefundedCents / 100).toFixed(4),
        status:
          newRefundedCents >= totalCents ? "refunded" : "partially_refunded",
      })
      .where(eq(schema.creditPurchases.id, row.id));
    return { result: "done", spaceId: row.spaceId };
  });
}

/**
 * Marks any pending `credit_purchases` or `subscription_intents` row with this
 * checkout id as `failed`. Lets the customer retry immediately instead of
 * waiting for the 24h reaper after abandoning the hosted checkout.
 *
 * Both lookups are by `provider_checkout_id` (uniquely indexed); the writes
 * are conditional on `status = 'pending'` so a webhook redelivery after the
 * customer eventually completed the checkout doesn't flip a paid row.
 */
async function markCheckoutExpired(providerCheckoutId: string): Promise<void> {
  await db
    .update(schema.creditPurchases)
    .set({ status: "failed" })
    .where(
      and(
        eq(schema.creditPurchases.providerCheckoutId, providerCheckoutId),
        eq(schema.creditPurchases.status, "pending")
      )
    );
  await db
    .update(schema.subscriptionIntents)
    .set({ status: "failed", completedAt: new Date() })
    .where(
      and(
        eq(schema.subscriptionIntents.providerCheckoutId, providerCheckoutId),
        eq(schema.subscriptionIntents.status, "pending")
      )
    );
}

/**
 * Backup heartbeat for the `customer.state_changed` event. Polar fires this
 * whenever a customer's subscription set / benefit grants change — we use
 * it to re-reconcile every Krova space that maps to this Polar customer
 * (one customer can own multiple sibling spaces under the same email per
 * Rule 42), catching any drift a dropped subscription.* event missed.
 *
 * Each `reconcileSpaceSubscription` call is idempotent + per-space locked,
 * so iterating siblings is safe.
 */
async function reconcileSpacesByPolarCustomerId(
  providerCustomerId: string
): Promise<void> {
  const spaces = await db
    .select({ id: schema.spaces.id })
    .from(schema.spaces)
    .where(eq(schema.spaces.polarCustomerId, providerCustomerId));
  for (const space of spaces) {
    try {
      await reconcileSpaceSubscription(space.id);
    } catch (err) {
      console.error(
        `[polar webhook] customer.state_changed reconcile failed for space ${space.id}:`,
        err
      );
      // Continue with the other spaces — a single sibling failure should
      // not block the rest.
    }
  }
}

/**
 * When a Polar customer record is deleted (operator action, GDPR), every
 * `spaces.polar_customer_id` that referenced it becomes stale — future
 * `customers.update` / meter ingests would 404 against a dead id. Clear the
 * column and (defensively) drop any subscription state still pointing at
 * this customer; the affected spaces fall back to the default plan on
 * subsequent webhooks.
 */
async function clearDeletedPolarCustomer(
  providerCustomerId: string
): Promise<void> {
  const affected = await db
    .select({ id: schema.spaces.id })
    .from(schema.spaces)
    .where(eq(schema.spaces.polarCustomerId, providerCustomerId));
  if (affected.length === 0) {
    return;
  }
  const ids = affected.map((s) => s.id);
  await db
    .update(schema.spaces)
    .set({
      polarCustomerId: null,
      providerSubscriptionId: null,
      subscriptionStatus: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      overageEnabled: false,
      overageCapUsd: "0",
      thisPeriodOverageUsd: "0",
      updatedAt: new Date(),
    })
    .where(inArray(schema.spaces.id, ids));
  await db.insert(schema.lifecycleLogs).values(
    affected.map((s) => ({
      entityType: "space" as const,
      entityId: s.id,
      message:
        "Polar customer record was deleted — subscription state cleared.",
    }))
  );
  for (const id of ids) {
    await enqueueEmailitSyncForSpaceOwner(id);
  }
}
