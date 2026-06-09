"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import * as schema from "@/db/schema";
import { requireActionMembershipAndPermission } from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { createTopupCheckout } from "@/lib/billing/topup-checkout";
import { db } from "@/lib/db";
import { loadEffectiveLimits, loadEffectiveLimitsTx } from "@/lib/plan/limits";
import { getPlatformSettings } from "@/lib/platform-settings";

/**
 * Create a Polar checkout to buy account credit. Owner / `billing.manage`
 * members on a paid plan only. Returns the hosted checkout URL.
 */
export async function createCreditCheckout(spaceId: string, amountUsd: number) {
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
      .select({ id: schema.spaces.id })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);
    if (!space) {
      return { error: "Space not found" };
    }
    const limits = await loadEffectiveLimits(spaceId);
    if (!limits.allowTopup) {
      return {
        error:
          "Your plan does not support credit top-up. Pick a paid plan to add credit.",
      };
    }

    const settings = await getPlatformSettings();
    if (
      typeof amountUsd !== "number" ||
      !Number.isFinite(amountUsd) ||
      amountUsd < settings.creditTopupMinUsd ||
      amountUsd > settings.creditTopupMaxUsd
    ) {
      return {
        error: `Amount must be between $${settings.creditTopupMinUsd} and $${settings.creditTopupMaxUsd}.`,
      };
    }
    const decimals = String(amountUsd).split(".")[1];
    if (decimals && decimals.length > 2) {
      return { error: "Amount must have at most 2 decimal places." };
    }

    const { checkoutUrl, purchaseId } = await createTopupCheckout({
      spaceId,
      initiatedByUserId: session.user.id,
      initiatedByUserEmail: session.user.email,
      initiatedByUserName: session.user.name ?? null,
      baseUsd: amountUsd,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "billing.topup_initiated",
      category: "billing",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Initiated a $${amountUsd} credit top-up`,
      metadata: { spaceId, amountUsd, purchaseId },
      ...reqCtx,
    });

    return { success: true as const, data: { checkoutUrl } };
  } catch (error) {
    console.error("createCreditCheckout error:", error);
    return {
      error: "Something went wrong starting the checkout. Please try again.",
    };
  }
}

/**
 * Set the per-space low-balance warning threshold. Owner / `billing.manage`
 * only. The value cannot be set below `platform_settings.lowBalanceThresholdMinUsd`.
 */
export async function updateLowBalanceThreshold(
  spaceId: string,
  thresholdUsd: number
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

    const settings = await getPlatformSettings();
    if (
      typeof thresholdUsd !== "number" ||
      !Number.isFinite(thresholdUsd) ||
      thresholdUsd < settings.lowBalanceThresholdMinUsd
    ) {
      return {
        error: `Threshold must be at least $${settings.lowBalanceThresholdMinUsd}.`,
      };
    }
    const decimals = String(thresholdUsd).split(".")[1];
    if (decimals && decimals.length > 2) {
      return { error: "Threshold must have at most 2 decimal places." };
    }

    await db
      .update(schema.spaces)
      .set({
        lowBalanceThreshold: thresholdUsd.toFixed(4),
        updatedAt: new Date(),
      })
      .where(eq(schema.spaces.id, spaceId));

    await db.insert(schema.lifecycleLogs).values({
      entityType: "space",
      entityId: spaceId,
      message: `Low-balance threshold updated to $${thresholdUsd}`,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "billing.threshold_updated",
      category: "billing",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Set low-balance threshold to $${thresholdUsd}`,
      metadata: { spaceId, thresholdUsd },
      ...reqCtx,
    });

    return { success: true as const };
  } catch (error) {
    console.error("updateLowBalanceThreshold error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}

/**
 * Toggle postpaid overage for a space and set its per-period cap. Owner /
 * `billing.manage` only. Trial plans cannot enable overage. Enabling
 * requires the subscription to be `active` (not past_due / canceled).
 */
export async function updateOverageSettings(
  spaceId: string,
  input: { enabled: boolean; capUsd: number }
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

    if (typeof input.enabled !== "boolean") {
      return { error: "Invalid input." };
    }
    const settings = await getPlatformSettings();
    if (typeof input.capUsd !== "number" || !Number.isFinite(input.capUsd)) {
      return { error: "Invalid cap amount." };
    }
    if (input.capUsd < settings.overageCapMinUsd) {
      return { error: `Cap must be at least $${settings.overageCapMinUsd}.` };
    }
    const decimals = String(input.capUsd).split(".")[1];
    if (decimals && decimals.length > 2) {
      return { error: "Cap must have at most 2 decimal places." };
    }

    // Read + validate + write atomically under a FOR UPDATE lock on the
    // space row — without this, a concurrent cancel webhook could flip the
    // space to its default plan between the validation read and the enable
    // write, leaving an allow_overage=false plan with overageEnabled=true (a
    // dirty state the cascade refuses to honor, but worth not creating in
    // the first place).
    //
    // The cap MAXIMUM is also resolved inside the tx so the per-space
    // `override_overage_cap_max_usd` is honored: an operator can grant a
    // higher (or lower) ceiling than the platform default. Bound below by
    // `overageCapMinUsd` so a stale or zero override cannot make the ceiling
    // smaller than the floor (which would make every value invalid).
    const validationError = await db.transaction(async (tx) => {
      const [space] = await tx
        .select({
          subscriptionStatus: schema.spaces.subscriptionStatus,
          overrideOverageCapMaxUsd: schema.spaces.overrideOverageCapMaxUsd,
        })
        .from(schema.spaces)
        .where(eq(schema.spaces.id, spaceId))
        .for("update")
        .limit(1);
      if (!space) {
        return "Space not found";
      }

      const overrideMax =
        space.overrideOverageCapMaxUsd === null
          ? null
          : Number.parseFloat(space.overrideOverageCapMaxUsd);
      const effectiveCapMax =
        overrideMax !== null && Number.isFinite(overrideMax)
          ? Math.max(settings.overageCapMinUsd, overrideMax)
          : settings.overageCapMaxUsd;
      if (input.capUsd > effectiveCapMax) {
        return `Cap must be at most $${effectiveCapMax}.`;
      }

      if (input.enabled) {
        const limits = await loadEffectiveLimitsTx(tx, spaceId);
        if (!limits.allowOverage) {
          return "Your plan does not support overage. Pick a plan that allows overage first.";
        }
        if (space.subscriptionStatus !== "active") {
          return "Overage can only be enabled while your subscription is active.";
        }
      }

      await tx
        .update(schema.spaces)
        .set({
          overageEnabled: input.enabled,
          overageCapUsd: input.capUsd.toFixed(4),
          updatedAt: new Date(),
        })
        .where(eq(schema.spaces.id, spaceId));
      return null;
    });
    if (validationError) {
      return { error: validationError };
    }

    await db.insert(schema.lifecycleLogs).values({
      entityType: "space",
      entityId: spaceId,
      message: input.enabled
        ? `Overage enabled (cap $${input.capUsd})`
        : "Overage disabled",
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "billing.overage_settings_updated",
      category: "billing",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: input.enabled
        ? `Enabled overage with $${input.capUsd} cap`
        : "Disabled overage",
      metadata: {
        spaceId,
        enabled: input.enabled,
        capUsd: input.capUsd,
      },
      ...reqCtx,
    });

    return { success: true as const };
  } catch (error) {
    console.error("updateOverageSettings error:", error);
    return { error: "Something went wrong. Please try again." };
  }
}
