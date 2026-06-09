"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import * as schema from "@/db/schema";
import { requireActionMembershipAndPermission } from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import {
  CANCELLATION_REASON_VALUES,
  type CancellationReason,
} from "@/lib/billing/cancellation-reasons";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getPaymentProvider } from "@/lib/payments";
import { checkSpaceFitsPlanV2, effectiveLimits } from "@/lib/plan/limits";
import { getSpaceOverrides, getSpacePlanRow } from "@/lib/plan/usage";
import { visiblePlansForSpace } from "@/lib/plan/visibility";

/**
 * Start a Polar checkout to subscribe a space to a paid plan. Owner /
 * `billing.manage` only, and only from the default (free) plan (an
 * already-subscribed space changes plan via `changePlan`, not a new
 * checkout). Phase 5C — input is the target `planId`, not the legacy slug.
 */
export async function createSubscriptionCheckout(
  spaceId: string,
  planId: string
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }
    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "billing.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    if (typeof planId !== "string" || planId.length === 0) {
      return { error: "Invalid plan." };
    }

    // The plan must be (a) visible to this space, (b) non-archived, (c) paid.
    const visible = await visiblePlansForSpace(spaceId);
    const targetPlan = visible.find((p) => p.id === planId);
    if (!targetPlan) {
      return { error: "Plan is not available for this space." };
    }
    if (Number.parseFloat(targetPlan.priceUsd) <= 0) {
      return { error: "Cannot subscribe to a free plan." };
    }
    if (!targetPlan.polarProductId) {
      return {
        error:
          "Plan is not yet provisioned with the payment provider — contact support.",
      };
    }

    const [space] = await db
      .select({
        providerSubscriptionId: schema.spaces.providerSubscriptionId,
      })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);
    if (!space) {
      return { error: "Space not found" };
    }
    if (space.providerSubscriptionId) {
      return {
        error:
          "This space already has a subscription — use Change plan instead.",
      };
    }

    // Block a second checkout if a pending intent already exists for this
    // space. Without this, double-clicking Subscribe or losing the redirect
    // creates two Polar checkout sessions + two pending rows; whichever the
    // customer pays activates the sub, the other becomes stale and gets
    // failed-out by the 24h reaper. The dropped checkout is harmless but
    // pollutes the audit trail and creates a window where the admin's
    // `assignPlanToSpace` is blocked (orbit-plans.ts pending-intent guard)
    // for up to 24h waiting for the abandoned intent to expire.
    const [pendingIntent] = await db
      .select({ id: schema.subscriptionIntents.id })
      .from(schema.subscriptionIntents)
      .where(
        and(
          eq(schema.subscriptionIntents.spaceId, spaceId),
          eq(schema.subscriptionIntents.status, "pending")
        )
      )
      .limit(1);
    if (pendingIntent) {
      return {
        error:
          "A subscription checkout is already in progress for this space. Complete or cancel it (or wait for it to expire) before starting another.",
      };
    }

    // Durable pending intent FIRST (recoverable if the webhook is lost).
    const provider = getPaymentProvider();
    const [intent] = await db
      .insert(schema.subscriptionIntents)
      .values({
        spaceId,
        planId: targetPlan.id,
        paymentProvider: provider.name,
      })
      .returning({ id: schema.subscriptionIntents.id });

    try {
      const { checkoutId, url } = await provider.createSubscriptionCheckout({
        spaceId,
        intentId: intent.id,
        initiatorUserId: session.user.id,
        planId: targetPlan.id,
        contact: {
          email: session.user.email,
          name: session.user.name ?? null,
        },
        successUrl: `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/billing?plan=success`,
      });
      await db
        .update(schema.subscriptionIntents)
        .set({ providerCheckoutId: checkoutId })
        .where(eq(schema.subscriptionIntents.id, intent.id));

      const reqCtx = extractRequestContext(await headers());
      audit({
        action: "billing.subscription_checkout",
        category: "billing",
        actorType: "user",
        actorId: session.user.id,
        actorEmail: session.user.email,
        entityType: "space",
        entityId: spaceId,
        spaceId,
        description: `Started a ${targetPlan.name} subscription checkout`,
        metadata: {
          spaceId,
          planId: targetPlan.id,
          planSlug: targetPlan.slug,
          intentId: intent.id,
        },
        ...reqCtx,
      });
      return { success: true as const, data: { checkoutUrl: url } };
    } catch (err) {
      await db
        .update(schema.subscriptionIntents)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(schema.subscriptionIntents.id, intent.id));
      throw err;
    }
  } catch (error) {
    console.error("createSubscriptionCheckout error:", error);
    return {
      error: "Something went wrong starting the checkout. Please try again.",
    };
  }
}

/**
 * Change an existing subscription's plan. An upgrade applies immediately
 * (provider-side); a downgrade is BLOCKED until the space fits the lower
 * tier. The DB `spaces.plan_id` is updated by the webhook (authoritative).
 * Phase 5C — input is `planId`.
 */
export async function changePlan(spaceId: string, planId: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }
    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "billing.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    if (typeof planId !== "string" || planId.length === 0) {
      return { error: "Invalid plan." };
    }

    const visible = await visiblePlansForSpace(spaceId);
    const targetPlan = visible.find((p) => p.id === planId);
    if (!targetPlan) {
      return { error: "Plan is not available for this space." };
    }
    if (Number.parseFloat(targetPlan.priceUsd) <= 0) {
      return {
        error:
          "Cannot change to a free plan — cancel the subscription instead.",
      };
    }
    if (!targetPlan.polarProductId) {
      return {
        error:
          "Plan is not yet provisioned with the payment provider — contact support.",
      };
    }

    const [space] = await db
      .select({
        planId: schema.spaces.planId,
        providerSubscriptionId: schema.spaces.providerSubscriptionId,
      })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);
    if (!space) {
      return { error: "Space not found" };
    }
    if (!space.providerSubscriptionId) {
      return { error: "This space has no subscription to change." };
    }
    if (space.planId === targetPlan.id) {
      return { error: "Already on this plan." };
    }

    // Compare price_usd between the resolved current plan row + the target.
    const currentPlan = await getSpacePlanRow(spaceId);
    const isDowngrade =
      Number.parseFloat(targetPlan.priceUsd) <
      Number.parseFloat(currentPlan.priceUsd);
    if (isDowngrade) {
      // Re-merge against the per-space overrides so a generous override on the
      // target plan can still let the downgrade through.
      const spaceOverrides = await getSpaceOverrides(spaceId);
      const targetLimits = effectiveLimits(targetPlan, spaceOverrides);
      const fit = await checkSpaceFitsPlanV2(spaceId, targetLimits);
      if (!fit.ok) {
        return {
          error: `Reduce your usage before downgrading to ${targetPlan.name}.`,
          violations: fit.violations,
        };
      }
    }

    const result = await getPaymentProvider().changeSubscription(
      space.providerSubscriptionId,
      targetPlan.id
    );
    if (!result.ok) {
      return { error: result.reason };
    }

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "billing.subscription_change",
      category: "billing",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Requested plan change ${currentPlan.slug} → ${targetPlan.slug}`,
      metadata: {
        spaceId,
        fromPlanId: currentPlan.id,
        fromPlanSlug: currentPlan.slug,
        toPlanId: targetPlan.id,
        toPlanSlug: targetPlan.slug,
      },
      ...reqCtx,
    });
    return { success: true as const };
  } catch (error) {
    console.error("changePlan error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}

/** Zod schema for the optional cancellation feedback. Both fields nullable
 *  — a customer who just wants to cancel without telling us why is fine. */
const cancelFeedbackSchema = z
  .object({
    reason: z.enum(CANCELLATION_REASON_VALUES).optional(),
    comment: z.string().trim().max(1000).optional(),
  })
  .optional();

/**
 * Cancel a subscription at period end. The space stays on its paid plan until
 * the period ends, then the webhook drops it to the default plan.
 *
 * Optional `feedback.reason` + `feedback.comment` are forwarded to Polar's
 * `subscriptions.update` (`customer_cancellation_reason` enum + free-text
 * comment) so they show up in Polar's churn-reason analytics.
 */
export async function cancelPlan(
  spaceId: string,
  rawFeedback?: { reason?: string; comment?: string }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }
    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "billing.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const parsedFeedback = cancelFeedbackSchema.safeParse(rawFeedback);
    if (!parsedFeedback.success) {
      return { error: "Invalid cancellation feedback." };
    }
    const feedback = parsedFeedback.data;
    const reason: CancellationReason | null = feedback?.reason ?? null;
    const comment = feedback?.comment?.length ? feedback.comment : null;

    const [space] = await db
      .select({
        providerSubscriptionId: schema.spaces.providerSubscriptionId,
        cancelAtPeriodEnd: schema.spaces.cancelAtPeriodEnd,
      })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);
    if (!space) {
      return { error: "Space not found" };
    }
    if (!space.providerSubscriptionId) {
      return { error: "This space has no subscription to cancel." };
    }
    if (space.cancelAtPeriodEnd) {
      // Polar would no-op this update, but surface a useful error rather
      // than letting the customer click Cancel twice and see "success" both
      // times. The UI also disables the button when this column is true,
      // so this guard is defense-in-depth.
      return {
        error:
          "Subscription is already scheduled to cancel at the end of the current period.",
      };
    }

    await getPaymentProvider().cancelSubscription(
      space.providerSubscriptionId,
      { reason, comment }
    );

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "billing.subscription_cancel",
      category: "billing",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: "Requested subscription cancellation",
      metadata: {
        spaceId,
        cancellationReason: reason,
        // Truncate the audit-log copy so a 1k char comment doesn't bloat
        // every row. The full text is in Polar.
        cancellationComment: comment
          ? comment.slice(0, 200) + (comment.length > 200 ? "…" : "")
          : null,
      },
      ...reqCtx,
    });
    return { success: true as const };
  } catch (error) {
    console.error("cancelPlan error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}

/**
 * Open a pre-authenticated Polar customer-portal session for this space.
 * The customer uses the portal to update their payment method, download
 * invoices, change plan (when enabled in Polar dashboard), or cancel/resume.
 *
 * Owner / `billing.manage` only. Sibling-safe — the provider implementation
 * addresses the customer by `polar_customer_id` (NOT `external_id`), per
 * Rule 42. Returns the absolute portal URL; the client navigates to it.
 */
export async function openCustomerPortal(spaceId: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }
    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "billing.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }
    const returnUrl = `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/billing`;
    const result = await getPaymentProvider().createCustomerPortalSession(
      spaceId,
      returnUrl
    );
    if (!result.ok) {
      return { error: result.reason };
    }
    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "billing.customer_portal_open",
      category: "billing",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: "Opened the customer-portal session",
      metadata: { spaceId },
      ...reqCtx,
    });
    return { success: true as const, data: { url: result.url } };
  } catch (error) {
    console.error("openCustomerPortal error:", error);
    return {
      error: "Could not open the customer portal. Please try again.",
    };
  }
}

/**
 * Resume a subscription that was previously set to cancel at period end.
 * Only valid while the current period is still active — once Polar has
 * fired the actual cancel webhook (and the space has dropped to the
 * default plan), the customer has to subscribe fresh.
 */
export async function resumePlan(spaceId: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }
    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "billing.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const [space] = await db
      .select({
        providerSubscriptionId: schema.spaces.providerSubscriptionId,
        cancelAtPeriodEnd: schema.spaces.cancelAtPeriodEnd,
        subscriptionStatus: schema.spaces.subscriptionStatus,
      })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);
    if (!space) {
      return { error: "Space not found" };
    }
    if (!space.providerSubscriptionId) {
      return {
        error:
          "This space has no active subscription. Subscribe again to start a new period.",
      };
    }
    if (!space.cancelAtPeriodEnd) {
      return {
        error: "Subscription is not scheduled to cancel — nothing to resume.",
      };
    }
    // `past_due` / `unpaid` can still be resumed; only a terminal
    // `canceled` / `expired` (which clears providerSubscriptionId via the
    // handler) is unreachable. Polar will accept the update either way.

    await getPaymentProvider().resumeSubscription(space.providerSubscriptionId);

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "billing.subscription_resume",
      category: "billing",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: "Resumed subscription (cleared pending cancel)",
      metadata: { spaceId },
      ...reqCtx,
    });
    return { success: true as const };
  } catch (error) {
    console.error("resumePlan error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}
