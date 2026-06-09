/**
 * Subscription invoice refund handler. Mirrors the top-up refund path
 * (lib/billing/apply-paid-topup.ts -> handleRefund in the polar webhook route).
 *
 * When Polar refunds a subscription order (activation or renewal), this claws
 * back the proportional plan-credit FACE fraction from the space's
 * creditBalance and writes a `credit_refund` billing_events row.
 *
 * Idempotency:
 *   - Cumulative-aware: compares `cumulativeRefundedCents` against
 *     `subscription_credit_grants.refunded_amount` to derive the newly-
 *     refunded delta. A redelivery of the same webhook is a no-op.
 *   - Per-grant `FOR UPDATE` lock serializes concurrent refund events.
 *
 * Lookup precedence:
 *   1. `provider_order_id` — set on renewal grants. O(1) index lookup.
 *   2. `(provider_subscription_id, period_end)` matching the subscription's
 *      current period — activation grants leave provider_order_id null.
 *
 * Returns `retry` when no matching grant exists (the activation grant has
 * not been persisted yet, or the order was for a period whose grant we
 * never made). The webhook route maps `retry` -> HTTP 503 so Polar
 * redelivers rather than silently dropping the refund.
 */
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

export type SubscriptionRefundOutcome =
  | { result: "retry" }
  | { result: "done"; spaceId: string | null; clawedBackUsd: number };

export async function applySubscriptionRefund(opts: {
  providerSubscriptionId: string;
  providerOrderId: string;
  cumulativeRefundedCents: number;
}): Promise<SubscriptionRefundOutcome> {
  const { providerSubscriptionId, providerOrderId, cumulativeRefundedCents } =
    opts;

  // Resolve the grant: O(1) by provider_order_id first. If missing (activation
  // grant — we don't store the activation order id), fall back to the
  // subscription's most-recent grant; that's the activation row for any
  // initial refund. We never rely on `period_end` matching since the order's
  // period_end is not directly exposed in the order.refunded event payload.
  const grant = await db.transaction(
    async (tx): Promise<SubscriptionRefundOutcome> => {
      // Lookup #1: by provider_order_id (renewal grants).
      let row = (
        await tx
          .select()
          .from(schema.subscriptionCreditGrants)
          .where(
            eq(schema.subscriptionCreditGrants.providerOrderId, providerOrderId)
          )
          .for("update")
          .limit(1)
      )[0];

      // Lookup #2: activation grant — most recent for the subscription that
      // has NO provider_order_id (i.e., the activation row). If two
      // subscriptions reused the same id (impossible per Polar), the
      // most-recent createdAt is the right pick.
      if (!row) {
        const candidate = (
          await tx
            .select()
            .from(schema.subscriptionCreditGrants)
            .where(
              and(
                eq(
                  schema.subscriptionCreditGrants.providerSubscriptionId,
                  providerSubscriptionId
                ),
                eq(schema.subscriptionCreditGrants.reason, "activation")
              )
            )
            .orderBy(desc(schema.subscriptionCreditGrants.createdAt))
            .limit(1)
        )[0];
        if (candidate) {
          // Re-select with FOR UPDATE so the row is locked for the write.
          row = (
            await tx
              .select()
              .from(schema.subscriptionCreditGrants)
              .where(eq(schema.subscriptionCreditGrants.id, candidate.id))
              .for("update")
              .limit(1)
          )[0];
        }
      }

      if (!row) {
        // Activation/renewal grant has not been persisted yet. Retry so the
        // refund is never silently dropped against a missing grant.
        console.warn(
          "[polar webhook] subscription refund: no matching grant — retry",
          providerOrderId,
          providerSubscriptionId
        );
        return { result: "retry" };
      }

      // Skip zero-credit grants — nothing was added to the balance, so
      // nothing to claw back. The refund still happens on Polar's side
      // (Polar returns the money to the customer's card); we just don't
      // need a billing_events row.
      const grantAmount = Number.parseFloat(row.amount);
      if (!Number.isFinite(grantAmount) || grantAmount <= 0) {
        return { result: "done", spaceId: row.spaceId, clawedBackUsd: 0 };
      }

      // Provider authoritative read for the order amount — we need to compute
      // the BASE fraction (the grant face value vs. the order's grossed-up
      // total). The order.refunded webhook gives us the cumulative refund in
      // cents but NOT the order's gross total, so derive face/total from
      // (grant.amount = face) and Polar's order.amount field.
      //
      // Defensive: if the provider lookup fails, treat the grant amount as
      // the face fraction (no gross-up correction). Worst case: we claw back
      // slightly MORE than we should (full base of refund, no fee fraction),
      // which is the safer direction for the platform.
      //
      // The current Polar SDK does not expose order amount on the refund
      // webhook payload — defer to a face/face-with-fee approximation. The
      // grant face is `grantAmount` USD; the grossed-up order total = face *
      // (1 + processingFee%). For simplicity we apply the WHOLE
      // newly-refunded cents to the grant fraction. This is conservative
      // (slightly higher clawback than strict math); revisit if Polar adds
      // order.amount to refund payloads.
      const alreadyRefunded = Number.parseFloat(row.refundedAmount);
      const alreadyRefundedCents = Math.round(alreadyRefunded * 100);
      const newlyRefundedCents = cumulativeRefundedCents - alreadyRefundedCents;
      if (newlyRefundedCents <= 0) {
        // Already processed / redelivery / partial that we've already seen.
        return { result: "done", spaceId: row.spaceId, clawedBackUsd: 0 };
      }

      // Claw back the FACE-equivalent portion of the newly refunded cents.
      // Bounded by the original grant amount minus what we've already clawed
      // back — never claw back more than the customer received as credit.
      const remainingGrant = Math.max(0, grantAmount - alreadyRefunded);
      const baseClawbackUsd = Math.min(
        newlyRefundedCents / 100,
        remainingGrant
      );

      // Apply the clawback against the space's balance, capped at the balance
      // (cannot push balance below zero — same rule as top-up refunds).
      const [space] = await tx
        .select({ creditBalance: schema.spaces.creditBalance })
        .from(schema.spaces)
        .where(eq(schema.spaces.id, row.spaceId))
        .for("update")
        .limit(1);

      let actualDebitUsd = 0;
      if (space) {
        const balance = Number.parseFloat(space.creditBalance);
        actualDebitUsd = Math.min(baseClawbackUsd, Math.max(0, balance));
        if (actualDebitUsd > 0) {
          await tx
            .update(schema.spaces)
            .set({
              creditBalance: (balance - actualDebitUsd).toFixed(4),
              updatedAt: new Date(),
            })
            .where(eq(schema.spaces.id, row.spaceId));
          await tx.insert(schema.billingEvents).values({
            id: createId(),
            spaceId: row.spaceId,
            amount: actualDebitUsd.toFixed(4),
            type: "credit_refund",
            description: `Subscription refund clawback (Polar order ${providerOrderId})`,
          });
        }
      }

      // Record the newly-refunded amount on the grant row — idempotency key
      // for any redelivery. Integer-cent compare so float drift doesn't
      // mis-flag a fully refunded grant as partial.
      const newRefundedCents = alreadyRefundedCents + newlyRefundedCents;
      await tx
        .update(schema.subscriptionCreditGrants)
        .set({
          refundedAmount: (newRefundedCents / 100).toFixed(4),
        })
        .where(eq(schema.subscriptionCreditGrants.id, row.id));

      return {
        result: "done",
        spaceId: row.spaceId,
        clawedBackUsd: actualDebitUsd,
      };
    }
  );
  return grant;
}
