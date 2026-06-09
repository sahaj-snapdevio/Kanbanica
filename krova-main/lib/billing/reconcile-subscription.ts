/**
 * Reconcile one space's plan/subscription state against the payment provider.
 * Webhooks can be dropped — this is the backstop. It polls the provider for
 * the space's current subscription and, if it diverges from the DB, feeds a
 * synthetic `subscription.synced` event through the Phase 3B handler (so all
 * the lifecycle logic — credit grant, reconcile, columns — is reused).
 *
 * Also resolves stale pending `subscription_intents`: a pending intent whose
 * space now has a matching active subscription is marked `completed`.
 */
import { and, eq, lt } from "drizzle-orm";

import * as schema from "@/db/schema";
import { handleSubscriptionEvent } from "@/lib/billing/subscription-handler";
import { db } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payments";
import { getDefaultPlan } from "@/lib/plan/usage";

export type ReconcileOutcome =
  | { result: "synced"; planId: string }
  | { result: "no_subscription" }
  | { result: "already_consistent" };

/**
 * Reconcile a single space. Safe to call repeatedly (the handler is idempotent
 * + per-space serialized). Returns what it did.
 */
export async function reconcileSpaceSubscription(
  spaceId: string
): Promise<ReconcileOutcome> {
  const [space] = await db
    .select({
      planId: schema.spaces.planId,
      providerSubscriptionId: schema.spaces.providerSubscriptionId,
      subscriptionStatus: schema.spaces.subscriptionStatus,
      currentPeriodEnd: schema.spaces.currentPeriodEnd,
    })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);
  if (!space) {
    return { result: "no_subscription" };
  }

  const provider = getPaymentProvider();
  const live = await provider.getActiveSubscriptionForSpace(spaceId);

  if (!live) {
    // The space-scoped lookup returned nothing. Before synthesizing a
    // terminal event, double-check by looking up the recorded subscription
    // id DIRECTLY. The `getActiveSubscriptionForSpace` query is keyed on
    // `metadata.spaceId`; a real subscription whose metadata was set
    // incorrectly (older checkout flow, manual Polar dashboard edit, etc.)
    // could be missing the metadata tag while still being live. Synthesizing
    // a `canceled` event in that case wrongly regresses the space to the
    // default plan and clears the columns — exactly the bug we are fixing.
    //
    // The direct `getSubscription` call hits Polar by id; the only way it
    // returns null is a true 404, which Polar only returns when the
    // subscription has been hard-deleted (does not happen via the cancel
    // flow). Anything else — active / past_due / canceled / unpaid /
    // incomplete — is returned with its real status, and we re-feed that
    // through the synced path so the terminal-vs-not-terminal decision is
    // made on authoritative state, not on an empty list query.
    if (space.providerSubscriptionId) {
      const direct = await provider.getSubscription(
        space.providerSubscriptionId
      );
      if (direct) {
        // Real subscription exists — feed it through the synced path with
        // its actual status. The handler will write columns, grant credit
        // if newly-activated, or drop to default-plan if `direct.providerStatus`
        // is `canceled` / `unpaid`. Either way the decision is correct.
        await handleSubscriptionEvent({
          kind: "subscription.synced",
          providerSubscriptionId: space.providerSubscriptionId,
          spaceId,
          providerCustomerId: direct.providerCustomerId,
          planId: direct.planId,
          periodStart: direct.periodStart,
          periodEnd: direct.periodEnd,
          cancelAtPeriodEnd: direct.cancelAtPeriodEnd,
          providerStatus: direct.providerStatus,
          occurredAt: new Date(),
        });
        await resolvePendingIntents(spaceId);
        // If Polar reported a non-terminal status we just refused to drop
        // the plan — log it loudly so the operator can investigate the
        // metadata mismatch (the subscription is missing `metadata.spaceId`).
        if (
          direct.providerStatus !== "canceled" &&
          direct.providerStatus !== "unpaid"
        ) {
          console.warn(
            `[reconcile-subscription] space ${spaceId}: getActiveSubscriptionForSpace returned null but getSubscription(${space.providerSubscriptionId}) is ${direct.providerStatus} — sub likely missing metadata.spaceId in Polar; refused to synthesize canceled`
          );
        }
        return { result: "synced", planId: direct.planId };
      }
      // `direct` was null → genuine 404, the subscription is gone from
      // Polar entirely. Synthesize a terminal event to drop the space to
      // the default plan and clear the subscription columns. Same shape as
      // before, but only reached after the defense-in-depth check above.
      const defaultPlan = await getDefaultPlan();
      if (space.planId !== defaultPlan.id) {
        await handleSubscriptionEvent({
          kind: "subscription.synced",
          providerSubscriptionId: space.providerSubscriptionId,
          spaceId,
          providerCustomerId: null,
          planId: defaultPlan.id,
          periodStart: space.currentPeriodEnd ?? new Date(),
          periodEnd: space.currentPeriodEnd ?? new Date(),
          cancelAtPeriodEnd: false,
          providerStatus: "canceled",
          // Newer than any real event so the staleness guard passes.
          occurredAt: new Date(),
        });
        return { result: "synced", planId: defaultPlan.id };
      }
    }
    return { result: "no_subscription" };
  }

  // Polar shows an active subscription. If the DB diverges (planId, status,
  // or missing subscription id), feed a synthetic synced event to heal it.
  const diverged =
    space.providerSubscriptionId !== live.providerSubscriptionId ||
    space.planId !== live.planId ||
    space.subscriptionStatus !== live.providerStatus;
  if (!diverged) {
    await resolvePendingIntents(spaceId);
    return { result: "already_consistent" };
  }

  await handleSubscriptionEvent({
    kind: "subscription.synced",
    providerSubscriptionId: live.providerSubscriptionId,
    spaceId,
    providerCustomerId: live.providerCustomerId,
    planId: live.planId,
    periodStart: live.periodStart,
    periodEnd: live.periodEnd,
    cancelAtPeriodEnd: live.cancelAtPeriodEnd,
    providerStatus: live.providerStatus,
    // Wall-clock now — the reconcile cron polls Polar's authoritative state
    // and feeds it through the handler. By definition, this synthetic event
    // is more recent than any past webhook (whose `modifiedAt` is <= the
    // moment we polled). Using `live.periodStart` instead silently no-ops
    // the reconcile for any subscription whose last real webhook is later
    // than periodStart (i.e. all mid-cycle plan changes) because the
    // staleness guard would drop the synthetic event. Tiny clock-skew risk
    // (sub-ms with NTP) traded for a working reconcile backstop.
    occurredAt: new Date(),
  });
  await resolvePendingIntents(spaceId);
  return { result: "synced", planId: live.planId };
}

/** Mark a space's stale `pending` subscription intents as completed once the
 *  space is subscribed (the activation has landed one way or another). */
async function resolvePendingIntents(spaceId: string): Promise<void> {
  const [space] = await db
    .select({ providerSubscriptionId: schema.spaces.providerSubscriptionId })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);
  if (space?.providerSubscriptionId) {
    await db
      .update(schema.subscriptionIntents)
      .set({ status: "completed", completedAt: new Date() })
      .where(
        and(
          eq(schema.subscriptionIntents.spaceId, spaceId),
          eq(schema.subscriptionIntents.status, "pending")
        )
      );
  }
}

/**
 * Mark `pending` intents older than `maxAgeHours` as `failed` — the checkout
 * was abandoned. Called by the cron sweep, not per-space.
 */
export async function expireStalePendingIntents(
  maxAgeHours = 24
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const expired = await db
    .update(schema.subscriptionIntents)
    .set({ status: "failed", completedAt: new Date() })
    .where(
      and(
        eq(schema.subscriptionIntents.status, "pending"),
        lt(schema.subscriptionIntents.createdAt, cutoff)
      )
    )
    .returning({ id: schema.subscriptionIntents.id });
  return expired.length;
}
