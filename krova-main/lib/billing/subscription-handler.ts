/**
 * Provider-agnostic subscription lifecycle handler. The Polar webhook route
 * normalizes an event then calls this. Every event is processed under a
 * per-space advisory lock (serialized) and an occurredAt staleness guard
 * (an out-of-order redelivery cannot regress plan/period state). See the
 * foundation design, "Subscription lifecycle" + "Concurrency & ordering".
 */
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import { applyPlanCredit } from "@/lib/billing/apply-plan-credit";
import { applyCreditTopup } from "@/lib/billing/apply-topup";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { getSpaceOwner } from "@/lib/email/helpers";
import { overagePastDueEmailTemplate } from "@/lib/email/templates/overage-past-due";
import { enqueueEmailitSyncForSpaceOwner } from "@/lib/emailit/enqueue-sync";
import { env } from "@/lib/env";
import { getPaymentProvider } from "@/lib/payments";
import type { NormalizedPaymentEvent } from "@/lib/payments/types";
import { reconcileSpaceCubeCount } from "@/lib/plan/reconcile";
import { acquireSpaceLock, getDefaultPlan } from "@/lib/plan/usage";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildSubscriptionPayload } from "@/lib/webhook-payloads";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

type SubscriptionWebhookKind =
  | "activated"
  | "renewed"
  | "canceled"
  | "past_due"
  | "resumed";

/** Marker written to lifecycle_logs to dedupe the overage past-due email
 *  per past-due transition. */
const OVERAGE_EMAIL_PAST_DUE_MARKER = "overage email: past_due";

/**
 * Provider status strings that mean the subscription has ended. Polar's
 * `subscription.revoked` event carries a `canceled` / `unpaid` status — there
 * is no `revoked` status value — so those two cover every terminal case.
 */
const TERMINAL_STATUSES = new Set(["canceled", "unpaid"]);

/**
 * Statuses that mean the subscription has not yet activated (payment not
 * confirmed). The space's plan/columns must NOT be touched for these — the
 * customer is not on the plan until the subscription is `active`.
 */
const PENDING_STATUSES = new Set(["incomplete", "incomplete_expired"]);

type SyncedEvent = Extract<
  NormalizedPaymentEvent,
  { kind: "subscription.synced" }
>;
type RenewalEvent = Extract<
  NormalizedPaymentEvent,
  { kind: "subscription.renewal_paid" }
>;

/** Dispatch a normalized subscription event. Returns nothing — the route
 *  returns 200 once this resolves; a throw → 500 → Polar retry. */
export async function handleSubscriptionEvent(
  event: SyncedEvent | RenewalEvent
): Promise<void> {
  if (event.kind === "subscription.synced") {
    await handleSynced(event);
  } else {
    await handleRenewalPaid(event);
  }
}

async function handleSynced(event: SyncedEvent): Promise<void> {
  // `null` → the event was a no-op (stale / space gone / not yet activated);
  // post-commit side effects are skipped. Otherwise → applied; the result is
  // the zero-balance cubes to auto-wake + whether to enqueue the overage
  // past-due email (set only on a clean active → past_due transition while
  // the space had overageEnabled).
  const txOutcome = await db.transaction(
    async (
      tx
    ): Promise<{
      wakeCubeIds: string[];
      sendOveragePastDueEmail: boolean;
      webhookKind: SubscriptionWebhookKind | null;
    } | null> => {
      await acquireSpaceLock(tx, event.spaceId);

      const [space] = await tx
        .select()
        .from(schema.spaces)
        .where(eq(schema.spaces.id, event.spaceId))
        .for("update")
        .limit(1);
      if (!space) {
        return null; // space deleted — nothing to do
      }

      // Staleness guard — ignore an event STRICTLY older than the last one
      // applied. `<` (not `<=`) so an exact-timestamp redelivery is re-run
      // idempotently — e.g. a webhook whose first delivery committed the plan
      // change but whose post-commit reconcile threw (→ 500 → Polar retry).
      if (
        space.subscriptionEventAt &&
        event.occurredAt.getTime() < space.subscriptionEventAt.getTime()
      ) {
        return null;
      }

      // Not-yet-activated subscription — the customer is not on the plan until
      // payment confirms. Do not touch plan/columns; wait for `active`.
      if (PENDING_STATUSES.has(event.providerStatus)) {
        return null;
      }

      const isTerminal = TERMINAL_STATUSES.has(event.providerStatus);
      const previousPlanId = space.planId;
      const previousStatus = space.subscriptionStatus;
      const previousOverageEnabled = space.overageEnabled;
      const isNewSubscription =
        space.providerSubscriptionId !== event.providerSubscriptionId;

      // Load the plan row inside the locked transaction. The plan referenced by
      // event.planId is the authoritative source for `name` (used in the
      // lifecycle log message). Throws if the row disappeared mid-flight
      // (operator deleted a plan referenced by an in-flight webhook — should
      // not happen since plans are archive-only).
      const [eventPlan] = await tx
        .select({
          id: schema.plans.id,
          slug: schema.plans.slug,
          name: schema.plans.name,
        })
        .from(schema.plans)
        .where(eq(schema.plans.id, event.planId))
        .limit(1);
      if (!eventPlan) {
        throw new Error(
          `subscription.synced references unknown plan_id ${event.planId} (space ${event.spaceId})`
        );
      }

      // Past-due email trigger: send when this event moves the space from any
      // non-`past_due` status into `past_due` AND overage was enabled at the
      // moment of transition. Idempotent against webhook redelivery via a
      // lifecycle_logs marker scoped to this transition.
      let sendOveragePastDueEmail = false;
      if (
        event.providerStatus === "past_due" &&
        previousStatus !== "past_due" &&
        previousOverageEnabled
      ) {
        const [existing] = await tx
          .select({ id: schema.lifecycleLogs.id })
          .from(schema.lifecycleLogs)
          .where(
            and(
              eq(schema.lifecycleLogs.entityType, "space"),
              eq(schema.lifecycleLogs.entityId, event.spaceId),
              eq(schema.lifecycleLogs.message, OVERAGE_EMAIL_PAST_DUE_MARKER)
            )
          )
          .limit(1);
        if (!existing) {
          await tx.insert(schema.lifecycleLogs).values({
            entityType: "space",
            entityId: event.spaceId,
            message: OVERAGE_EMAIL_PAST_DUE_MARKER,
          });
          sendOveragePastDueEmail = true;
        }
      } else if (
        event.providerStatus === "active" &&
        previousStatus === "past_due"
      ) {
        // Returning to active — clear the marker so the next past_due
        // transition fires a fresh email.
        await tx
          .delete(schema.lifecycleLogs)
          .where(
            and(
              eq(schema.lifecycleLogs.entityType, "space"),
              eq(schema.lifecycleLogs.entityId, event.spaceId),
              eq(schema.lifecycleLogs.message, OVERAGE_EMAIL_PAST_DUE_MARKER)
            )
          );
      }

      if (isTerminal) {
        // Cancel / revoke — drop to the default plan (Trial in seed) and CLEAR
        // the subscription columns: the space no longer has a subscription, so
        // a later resubscribe must see a clean slate (a stale
        // providerSubscriptionId would block createSubscriptionCheckout and
        // misroute changePlan to a dead sub). The per-period overage counter is
        // cleared too — Trial cannot overage, and a future resubscribe must
        // start the new period at 0. The overage settings (enabled flag + cap)
        // are RESET so a resubscribe does NOT silently inherit the previous cap
        // — the customer must explicitly opt in again (foundation design:
        // "cancel/resubscribe must require fresh opt-in").
        //
        // `polarCustomerId` is intentionally KEPT — a customer cancel does not
        // delete the Polar customer record, and preserving the id makes a
        // resubscribe / ownership transfer / overage event resolvable without
        // having to re-discover it from a fresh webhook.
        const defaultPlan = await getDefaultPlan();
        await tx
          .update(schema.spaces)
          .set({
            planId: defaultPlan.id,
            providerSubscriptionId: null,
            subscriptionStatus: null,
            currentPeriodEnd: null,
            // Clear the pending-cancel flag on a terminal event — the
            // subscription is gone, not "ending soon", so the UI should
            // not keep showing the "Resume" affordance.
            cancelAtPeriodEnd: false,
            subscriptionEventAt: event.occurredAt,
            thisPeriodOverageUsd: "0",
            overageEnabled: false,
            overageCapUsd: "0",
            // Capture the customer id if we have not yet — even a terminal
            // event is a valid first-touch.
            ...(event.providerCustomerId && !space.polarCustomerId
              ? { polarCustomerId: event.providerCustomerId }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.spaces.id, event.spaceId));
        await tx.insert(schema.lifecycleLogs).values({
          entityType: "space",
          entityId: event.spaceId,
          message: `Subscription ${event.providerStatus} — dropped to ${defaultPlan.name}`,
        });
        // reconcile is enqueued below, post-commit
        return {
          wakeCubeIds: [],
          sendOveragePastDueEmail,
          webhookKind: "canceled",
        };
      }

      // Active (or past_due — non-terminal): sync plan + period columns.
      // Detect a genuine billing-period advance — a strictly-later periodEnd OR
      // the first time we see a periodEnd at all. A same-period status flip
      // (active ↔ past_due) keeps the same periodEnd and MUST NOT reset the
      // per-period overage counter.
      const periodAdvanced =
        !space.currentPeriodEnd ||
        event.periodEnd.getTime() > space.currentPeriodEnd.getTime();

      // Detect a mid-cycle plan change (same subscription id, different plan)
      // — the customer just upgraded or downgraded. Direction is by face
      // price. Used below to (a) grant prorated additional credit on
      // upgrade, (b) re-clamp overage settings on downgrade.
      const planChanged = previousPlanId !== event.planId;
      let previousPlan: {
        name: string;
        priceUsd: string;
        includedCreditUsd: string;
        allowOverage: boolean;
        maxConcurrentCubes: number | null;
      } | null = null;
      if (planChanged && previousPlanId) {
        const [prev] = await tx
          .select({
            name: schema.plans.name,
            priceUsd: schema.plans.priceUsd,
            includedCreditUsd: schema.plans.includedCreditUsd,
            allowOverage: schema.plans.allowOverage,
            maxConcurrentCubes: schema.plans.maxConcurrentCubes,
          })
          .from(schema.plans)
          .where(eq(schema.plans.id, previousPlanId))
          .limit(1);
        previousPlan = prev ?? null;
      }

      // Re-load the post-change plan's full row for overage gating. Cheap;
      // already inside the lock so a concurrent plan edit is harmless.
      const [newPlanFull] = await tx
        .select({
          allowOverage: schema.plans.allowOverage,
          includedCreditUsd: schema.plans.includedCreditUsd,
          priceUsd: schema.plans.priceUsd,
        })
        .from(schema.plans)
        .where(eq(schema.plans.id, event.planId))
        .limit(1);

      const isMidCycleChange =
        planChanged && !isNewSubscription && previousPlan !== null;
      const previousPrice = previousPlan
        ? Number.parseFloat(previousPlan.priceUsd)
        : 0;
      const newPrice = newPlanFull
        ? Number.parseFloat(newPlanFull.priceUsd)
        : 0;
      const isUpgrade = isMidCycleChange && newPrice > previousPrice;
      const isDowngrade = isMidCycleChange && newPrice < previousPrice;

      // Downgrade-side overage cleanup. Two distinct concerns:
      //   1. `allowOverage = false` on new plan -> clear `overage_enabled`
      //      AND `overage_cap_usd` (cascade defense-in-depth blocks accrual
      //      regardless, but the UI mis-shows "Overage enabled" without this).
      //   2. New plan has `allowOverage = true` BUT customer's cap is now
      //      higher than the (operator-set platform max OR per-space override
      //      cap). Re-clamp downward.
      let overageEnabledOverride: boolean | undefined;
      let overageCapOverride: string | undefined;
      if (
        isDowngrade &&
        newPlanFull &&
        !newPlanFull.allowOverage &&
        space.overageEnabled
      ) {
        overageEnabledOverride = false;
        overageCapOverride = "0";
      }

      await tx
        .update(schema.spaces)
        .set({
          planId: eventPlan.id,
          paymentProvider: getPaymentProvider().name,
          providerSubscriptionId: event.providerSubscriptionId,
          subscriptionStatus: event.providerStatus,
          currentPeriodEnd: event.periodEnd,
          subscriptionEventAt: event.occurredAt,
          // Mirror Polar's cancel-at-period-end flag. The customer cancel
          // flips this true via Polar's cancel API (handled by the
          // subsequent webhook); a resume flips it back. The UI reads this
          // to render "Ending on X" + the Resume button.
          cancelAtPeriodEnd: event.cancelAtPeriodEnd,
          // Capture the canonical provider customer id the first time we see
          // it. Independent of `external_id` (which Polar shares across
          // sibling spaces) so subsequent meter events, profile updates,
          // and reconcile lookups can address the right customer per-space.
          // Only set when present + not already cached — the column is the
          // source of truth, never overwritten by a later webhook.
          ...(event.providerCustomerId && !space.polarCustomerId
            ? { polarCustomerId: event.providerCustomerId }
            : {}),
          updatedAt: new Date(),
          // Reset the per-period overage counter ONLY when the period genuinely
          // advanced — not on a same-period status flip (active ↔ past_due).
          ...(periodAdvanced ? { thisPeriodOverageUsd: "0" } : {}),
          // Downgrade defenses (only when applicable — undefined fields are
          // a no-op via Drizzle's set semantics).
          ...(overageEnabledOverride === undefined
            ? {}
            : { overageEnabled: overageEnabledOverride }),
          ...(overageCapOverride === undefined
            ? {}
            : { overageCapUsd: overageCapOverride }),
        })
        .where(eq(schema.spaces.id, event.spaceId));

      // Grant included credit on a brand-new subscription (activation).
      let wake: string[] = [];
      if (isNewSubscription && event.providerStatus === "active") {
        const outcome = await applyPlanCredit({
          tx,
          spaceId: event.spaceId,
          planId: event.planId,
          providerSubscriptionId: event.providerSubscriptionId,
          periodStart: event.periodStart,
          periodEnd: event.periodEnd,
          reason: "activation",
        });
        if (outcome.result === "granted") {
          wake = outcome.wakeCubeIds;
        }
      }

      // Mid-cycle UPGRADE — grant the PRORATED delta of (new includedCredit
      // − old includedCredit) for the remaining days in the period. Customer
      // paid Polar the prorated charge difference immediately
      // (prorationBehavior="invoice" in changeSubscription); this matches
      // that with the corresponding credit. Without this, the customer
      // pays for the higher tier but gets ZERO additional credit until the
      // next renewal — they got the caps but not the compute allowance they
      // paid for.
      //
      // Bypasses applyPlanCredit because that is keyed on
      // (provider_subscription_id, period_end) UNIQUE — the same key as the
      // activation/renewal grant for this period. We write a billing_events
      // ledger row directly via applyCreditTopup so the upgrade-delta is
      // visible in the customer's transaction history.
      if (
        isUpgrade &&
        previousPlan &&
        newPlanFull &&
        event.providerStatus === "active"
      ) {
        const oldIncluded = Number.parseFloat(previousPlan.includedCreditUsd);
        const newIncluded = Number.parseFloat(newPlanFull.includedCreditUsd);
        const delta = newIncluded - oldIncluded;
        if (Number.isFinite(delta) && delta > 0) {
          // Period fraction remaining. Bound to [0, 1] defensively — a clock
          // skew between Polar and us could theoretically produce a tiny
          // negative or >1 fraction otherwise.
          const periodMs =
            event.periodEnd.getTime() - event.periodStart.getTime();
          const remainingMs = Math.max(
            0,
            event.periodEnd.getTime() - Date.now()
          );
          const fraction =
            periodMs > 0 ? Math.max(0, Math.min(1, remainingMs / periodMs)) : 0;
          const prorated = delta * fraction;
          // Round to 2 cents — anything smaller is noise (sub-penny).
          const proratedRounded = Math.round(prorated * 100) / 100;
          if (proratedRounded > 0) {
            const credited = await applyCreditTopup({
              tx,
              spaceId: event.spaceId,
              amount: proratedRounded,
              type: "plan_credit",
              description: `${eventPlan.name} upgrade prorated credit (${Math.round(fraction * 100)}% of period remaining)`,
            });
            if (credited?.wakeCubeIds.length) {
              wake = wake.concat(credited.wakeCubeIds);
            }
          }
        }
      }

      // Lifecycle log: specific message per transition kind so the audit
      // trail is readable. Order matters — terminal/new/change/status-flip
      // are mutually exclusive transitions in this `active|past_due` branch.
      let message: string;
      if (isNewSubscription) {
        message = `Subscribed to ${eventPlan.name} (${event.providerStatus})`;
      } else if (isUpgrade && previousPlan) {
        message = `Upgraded: ${previousPlan.name} → ${eventPlan.name}`;
      } else if (isDowngrade && previousPlan) {
        const overageNote =
          overageEnabledOverride === false
            ? " (overage settings reset — new plan does not allow overage)"
            : "";
        message = `Downgraded: ${previousPlan.name} → ${eventPlan.name}${overageNote}`;
      } else if (planChanged && previousPlan) {
        message = `Plan changed: ${previousPlan.name} → ${eventPlan.name}`;
      } else if (event.cancelAtPeriodEnd !== space.cancelAtPeriodEnd) {
        message = event.cancelAtPeriodEnd
          ? `Cancellation scheduled for period end (${eventPlan.name})`
          : `Cancellation reversed — ${eventPlan.name} continues`;
      } else if (
        event.providerStatus === "past_due" &&
        previousStatus !== "past_due"
      ) {
        message = `Payment failed — ${eventPlan.name} marked past_due`;
      } else if (
        event.providerStatus === "active" &&
        previousStatus === "past_due"
      ) {
        message = `Payment recovered — ${eventPlan.name} active again`;
      } else {
        message = `Subscription synced (${eventPlan.name}, ${event.providerStatus})`;
      }
      await tx.insert(schema.lifecycleLogs).values({
        entityType: "space",
        entityId: event.spaceId,
        message,
      });

      let webhookKind: SubscriptionWebhookKind | null = null;
      if (isNewSubscription) {
        webhookKind = "activated";
      } else if (periodAdvanced) {
        webhookKind = "renewed";
      } else if (
        event.providerStatus === "past_due" &&
        previousStatus !== "past_due"
      ) {
        webhookKind = "past_due";
      } else if (space.cancelAtPeriodEnd && event.cancelAtPeriodEnd === false) {
        webhookKind = "resumed";
      }

      return { wakeCubeIds: wake, sendOveragePastDueEmail, webhookKind };
    }
  );

  // No-op event (stale / space gone / not yet activated) — skip every
  // post-commit side effect, including the audit log.
  if (txOutcome === null) {
    return;
  }

  // Post-commit side effects.
  const provider = getPaymentProvider().name;
  const [space] = await db
    .select({ planId: schema.spaces.planId, name: schema.spaces.name })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, event.spaceId))
    .limit(1);
  if (space?.planId) {
    // A downgrade or cancel may leave Cubes over the new cap. Reconcile reads
    // the post-update `spaces.plan_id` so the resolved cap reflects the new
    // tier (and any per-space override).
    await reconcileSpaceCubeCount(event.spaceId, space.planId);
  }
  await wakeCubes(event.spaceId, txOutcome.wakeCubeIds);

  if (txOutcome.webhookKind) {
    const [plan] = space?.planId
      ? await db
          .select({
            id: schema.plans.id,
            name: schema.plans.name,
            priceUsd: schema.plans.priceUsd,
          })
          .from(schema.plans)
          .where(eq(schema.plans.id, space.planId))
          .limit(1)
      : [null];
    if (plan) {
      dispatchWebhookEvent(
        event.spaceId,
        `subscription.${txOutcome.webhookKind}`,
        {
          subscription: buildSubscriptionPayload({
            cancelAtPeriodEnd: event.cancelAtPeriodEnd,
            currentPeriodEnd:
              txOutcome.webhookKind === "canceled" ? null : event.periodEnd,
            plan,
            providerSubscriptionId:
              txOutcome.webhookKind === "canceled"
                ? null
                : event.providerSubscriptionId,
            status:
              txOutcome.webhookKind === "canceled"
                ? null
                : event.providerStatus,
          }),
        }
      );
    }
  }

  // Past-due overage email — sent once per active → past_due transition.
  if (txOutcome.sendOveragePastDueEmail) {
    try {
      const owner = await getSpaceOwner(event.spaceId);
      if (owner) {
        const spaceUrl = `${env.NEXT_PUBLIC_APP_URL}/${event.spaceId}/billing`;
        const { html, text } = await overagePastDueEmailTemplate({
          userName: owner.name,
          spaceName: owner.spaceName,
          spaceUrl,
        });
        await enqueueEmail({
          to: owner.email,
          subject: `Overage paused — ${owner.spaceName} payment failed`,
          html,
          text,
        });
      }
    } catch (err) {
      console.error(
        `[subscription-handler] failed to send overage past-due email for space ${event.spaceId}:`,
        err
      );
    }
  }

  audit({
    action: "billing.subscription_synced",
    category: "billing",
    actorType: "system",
    entityType: "space",
    entityId: event.spaceId,
    spaceId: event.spaceId,
    description: `Subscription event applied (${event.providerStatus})`,
    metadata: {
      provider,
      planId: event.planId,
      status: event.providerStatus,
      subscriptionId: event.providerSubscriptionId,
    },
    source: "worker",
  });

  // Plan / credit / lifecycle fields just changed for this space's owner.
  await enqueueEmailitSyncForSpaceOwner(event.spaceId);
}

async function handleRenewalPaid(event: RenewalEvent): Promise<void> {
  // A renewal order was paid. Fetch the subscription's AUTHORITATIVE current
  // period from the provider — never trust space.currentPeriodEnd here, since
  // order.paid and subscription.updated arrive in no guaranteed order. The
  // fetched periodEnd is the stable idempotency key.
  const state = await getPaymentProvider().getSubscription(
    event.providerSubscriptionId
  );
  if (!state) {
    return; // unknown subscription — nothing to grant
  }

  const result = await db.transaction(async (tx) => {
    await acquireSpaceLock(tx, event.spaceId);
    const [space] = await tx
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, event.spaceId))
      .for("update")
      .limit(1);
    const empty = { wakeCubeIds: [] as string[], granted: false, amount: 0 };
    if (!space) {
      return empty;
    }
    // Only grant if this subscription is the space's active one.
    if (space.providerSubscriptionId !== event.providerSubscriptionId) {
      return empty;
    }
    const outcome = await applyPlanCredit({
      tx,
      spaceId: event.spaceId,
      planId: state.planId,
      providerSubscriptionId: event.providerSubscriptionId,
      providerOrderId: event.providerOrderId,
      periodStart: state.periodStart,
      periodEnd: state.periodEnd,
      reason: "renewal",
    });
    // Advance `currentPeriodEnd` and `subscriptionStatus` to the authoritative
    // provider state. Without this, a renewal-paid event landing BEFORE the
    // accompanying subscription.updated webhook leaves the space's
    // currentPeriodEnd at the OLD period — which the overage-email markers
    // use as the period key, suppressing the new period's emails until the
    // synced event arrives. Idempotent: subsequent subscription.synced for
    // the same period is a no-op write (advisory lock serializes both).
    //
    // Also reset `thisPeriodOverageUsd` to 0 when the period strictly
    // advances — same rule as `handleSynced`. Without this, a paid renewal
    // landing before the accompanying `subscription.updated` webhook would
    // leave the prior-period counter live, the hourly worker would see zero
    // overage budget on the new period and auto-sleep cubes immediately.
    // A same-period redelivery of `order.paid` does NOT trip the guard, so
    // an in-period counter is never accidentally cleared.
    const renewalPeriodAdvanced =
      !space.currentPeriodEnd ||
      state.periodEnd.getTime() > space.currentPeriodEnd.getTime();
    await tx
      .update(schema.spaces)
      .set({
        currentPeriodEnd: state.periodEnd,
        subscriptionStatus: state.providerStatus,
        // Mirror the renewal state's cancel-at-period-end flag. A renewal
        // that fires while the subscription is still set to cancel keeps
        // the flag — it means Polar charged for one more period but the
        // customer's prior cancel-at-period-end intent is still recorded.
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        // Capture the canonical Polar customer id if we have not seen it yet
        // — `state.providerCustomerId` came from `getSubscription` which is
        // the freshest authoritative read. Same rule as the synced path:
        // first-write wins.
        ...(state.providerCustomerId && !space.polarCustomerId
          ? { polarCustomerId: state.providerCustomerId }
          : {}),
        updatedAt: new Date(),
        ...(renewalPeriodAdvanced ? { thisPeriodOverageUsd: "0" } : {}),
      })
      .where(eq(schema.spaces.id, event.spaceId));
    if (outcome.result === "granted") {
      return {
        wakeCubeIds: outcome.wakeCubeIds,
        granted: true,
        amount: outcome.amount,
      };
    }
    return empty;
  });
  await wakeCubes(event.spaceId, result.wakeCubeIds);

  // Audit the renewal credit grant (Rule 9 — a money mutation in a worker).
  if (result.granted) {
    audit({
      action: "billing.subscription_renewal_credit",
      category: "billing",
      actorType: "system",
      entityType: "space",
      entityId: event.spaceId,
      spaceId: event.spaceId,
      description: `Renewal plan credit granted ($${result.amount})`,
      metadata: {
        planId: state.planId,
        amount: result.amount,
        subscriptionId: event.providerSubscriptionId,
      },
      source: "worker",
    });
    await enqueueEmailitSyncForSpaceOwner(event.spaceId);
  }
}

/** Enqueue cube.wake for the auto-wake set (post-commit). */
async function wakeCubes(spaceId: string, cubeIds: string[]): Promise<void> {
  for (const cubeId of cubeIds) {
    const [cube] = await db
      .select({ serverId: schema.cubes.serverId })
      .from(schema.cubes)
      .where(eq(schema.cubes.id, cubeId))
      .limit(1);
    if (cube) {
      await enqueueJob(JOB_NAMES.CUBE_WAKE, {
        cubeId,
        spaceId,
        serverId: cube.serverId,
      });
    }
  }
}
