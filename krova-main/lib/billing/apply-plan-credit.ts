/**
 * Grants a plan's included credit — at most once per billing period
 * (subscription_credit_grants UNIQUE), and for ACTIVATION at most once per
 * `platform_settings.planCreditGrantCooldownDays` (anti-abuse). Routes through
 * applyCreditTopup() so plan credit and top-up credit follow one path.
 * Idempotent: a redelivered event is a no-op.
 *
 * MUST be called inside a transaction that already holds the per-space
 * advisory lock (the subscription handler does this).
 *
 * Phase 5 — takes `planId` (FK to `plans`) instead of the legacy `PlanTier`.
 * Loads the plan row inside the tx to pick up the latest `name` /
 * `includedCreditUsd`, and honors `spaces.override_included_credit_usd` so an
 * operator can grant one space more (or less) included credit per period
 * without duplicating the plan.
 */
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import type { Tx } from "@/lib/billing/apply-topup";
import { applyCreditTopup } from "@/lib/billing/apply-topup";
import { getPlatformSettings } from "@/lib/platform-settings";

export type PlanCreditOutcome =
  | { result: "granted"; amount: number; wakeCubeIds: string[] }
  | { result: "skipped_period_already_granted" }
  | { result: "skipped_cooldown" }
  | { result: "skipped_zero_credit" }
  | { result: "space_missing" }
  | { result: "plan_missing" };

export async function applyPlanCredit(opts: {
  tx: Tx;
  spaceId: string;
  /** Phase 5 — the `plans.id` for the plan being granted credit. */
  planId: string;
  providerSubscriptionId: string;
  /** Polar order id of the subscription_cycle order (renewal grants only).
   *  Stored on the grant row so a later `order.refunded` webhook can look up
   *  the grant in O(1). Null for activation grants. */
  providerOrderId?: string | null;
  periodStart: Date;
  periodEnd: Date;
  /** `activation` applies the cooldown; `renewal` does not. */
  reason: "activation" | "renewal";
}): Promise<PlanCreditOutcome> {
  const {
    tx,
    spaceId,
    planId,
    providerSubscriptionId,
    providerOrderId,
    periodStart,
    periodEnd,
    reason,
  } = opts;

  // Load the plan row inside the transaction so `name` / `includedCreditUsd`
  // reflect the operator's latest edit (no caching here — money path).
  const [plan] = await tx
    .select({
      id: schema.plans.id,
      slug: schema.plans.slug,
      name: schema.plans.name,
      includedCreditUsd: schema.plans.includedCreditUsd,
    })
    .from(schema.plans)
    .where(eq(schema.plans.id, planId))
    .limit(1);
  if (!plan) {
    return { result: "plan_missing" };
  }

  // Per-space override wins if set. The override column is `numeric(12,4)` so
  // it arrives as a string; parseFloat once here.
  const [spaceRow] = await tx
    .select({
      overrideIncludedCreditUsd: schema.spaces.overrideIncludedCreditUsd,
    })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);
  const includedCreditSource =
    spaceRow?.overrideIncludedCreditUsd ?? plan.includedCreditUsd;
  const includedCredit = Number.parseFloat(includedCreditSource);
  const isZeroCredit = !Number.isFinite(includedCredit) || includedCredit <= 0;

  // Period idempotency — UNIQUE(provider_subscription_id, period_end). Insert
  // first; a conflict means this period was already granted.
  //
  // For zero-credit periods (free plan OR an explicit override of `0`), we
  // STILL insert a row (amount = "0", reason = "skipped_zero_credit") so the
  // UNIQUE constraint is the canonical idempotency gate for every period —
  // a redelivery of the same activation/renewal event hits the conflict
  // path instead of repeatedly entering the early-return branch.
  const rowAmount = isZeroCredit ? "0" : includedCredit.toFixed(4);
  const rowReason = isZeroCredit ? "skipped_zero_credit" : reason;
  const inserted = await tx
    .insert(schema.subscriptionCreditGrants)
    .values({
      spaceId,
      providerSubscriptionId,
      providerOrderId: providerOrderId ?? null,
      planId: plan.id,
      periodStart,
      periodEnd,
      amount: rowAmount,
      reason: rowReason,
    })
    .onConflictDoNothing({
      target: [
        schema.subscriptionCreditGrants.providerSubscriptionId,
        schema.subscriptionCreditGrants.periodEnd,
      ],
    })
    .returning({ id: schema.subscriptionCreditGrants.id });

  if (inserted.length === 0) {
    return { result: "skipped_period_already_granted" };
  }

  // Zero-credit period: row inserted (UNIQUE protects against redelivery)
  // but no credit applied and no cooldown stamp (correct — nothing granted).
  if (isZeroCredit) {
    return { result: "skipped_zero_credit" };
  }

  // Activation cooldown — anti-abuse against subscribe/cancel/resubscribe.
  if (reason === "activation") {
    const [space] = await tx
      .select({ lastGrantAt: schema.spaces.lastPlanCreditGrantAt })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);
    if (space?.lastGrantAt) {
      const settings = await getPlatformSettings();
      const cooldownMs =
        settings.planCreditGrantCooldownDays * 24 * 60 * 60 * 1000;
      if (Date.now() - space.lastGrantAt.getTime() < cooldownMs) {
        // The period row stays — DO NOT DELETE. If we deleted, a late Polar
        // webhook redelivery (e.g. after the cooldown expires) would not hit
        // the UNIQUE(providerSubscriptionId, period_end) conflict and the
        // cooldown check at THAT time would pass, granting credit that this
        // first attempt correctly blocked. Mark the row as a blocked attempt
        // (amount=0, reason=activation_cooldown_skipped) so any redelivery
        // of the same (subId, periodEnd) sees the conflict and short-circuits.
        // A future RENEWAL has a different periodEnd → unique key differs →
        // not blocked by this row.
        await tx
          .update(schema.subscriptionCreditGrants)
          .set({
            amount: "0",
            reason: "activation_cooldown_skipped",
          })
          .where(eq(schema.subscriptionCreditGrants.id, inserted[0].id));
        return { result: "skipped_cooldown" };
      }
    }
  }

  const credited = await applyCreditTopup({
    tx,
    spaceId,
    amount: includedCredit,
    type: "plan_credit",
    description: `${plan.name} plan credit`,
  });
  if (credited === null) {
    return { result: "space_missing" };
  }

  await tx
    .update(schema.spaces)
    .set({ lastPlanCreditGrantAt: new Date() })
    .where(eq(schema.spaces.id, spaceId));

  return {
    result: "granted",
    amount: includedCredit,
    wakeCubeIds: credited.wakeCubeIds,
  };
}
