/**
 * Polar implementation of `PaymentProvider`. All Polar-specific types and SDK
 * calls are confined to this file + `./client.ts`.
 */
import type { CustomerCancellationReason } from "@polar-sh/sdk/models/components/customercancellationreason.js";
import {
  validateEvent,
  WebhookVerificationError,
} from "@polar-sh/sdk/webhooks";
import { eq, inArray } from "drizzle-orm";
import { POLAR_OVERAGE_EVENT_NAME } from "@/config/platform";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getPolarClient } from "@/lib/payments/polar/client";
import type {
  ChangeSubscriptionResult,
  CheckoutResult,
  CreatePlanProductInput,
  CreatePlanProductResult,
  CustomerPortalResult,
  MeterReportResult,
  MeterUsageEvent,
  NormalizedPaymentEvent,
  PaymentProvider,
  SubscriptionCheckoutInput,
  SubscriptionState,
  TopupCheckoutInput,
  UpdatePlanProductInput,
} from "@/lib/payments/types";
import { getPlatformSettings } from "@/lib/platform-settings";

/**
 * Resolve a Krova plan row from a Polar product id. Returns null if no plan
 * row references this product id (an unknown / archived / external product).
 *
 * When non-empty `productId` returns null, log a WARN — that is the silent
 * drop path for the "subscription event ignored, no credit granted" bug that
 * bit custom plans where the operator never clicked "Provision in Polar" (or
 * provisioned then re-created the product). The webhook handler returns
 * `{kind:"ignored"}` for these so without this log there is zero signal in
 * production that the event was received but dropped.
 */
async function planIdForPolarProductId(
  productId: string
): Promise<string | null> {
  if (!productId) {
    return null;
  }
  const [row] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(eq(schema.plans.polarProductId, productId))
    .limit(1);
  if (!row) {
    console.warn(
      `[polar webhook] no plan row matches polarProductId=${productId} — webhook will be ignored, no credit granted. Either (a) the plan was never "Provisioned in Polar" via Orbit → Plans, (b) the plan was re-provisioned and the old product id is now orphaned, or (c) the customer subscribed manually through a product not created via Orbit.`
    );
    return null;
  }
  return row.id;
}

/**
 * Resolve a Krova space id from a Polar subscription id by looking up the
 * `spaces` row that already references it. Returns null on the activation
 * event (before the DB has linked the sub) — callers fall back to metadata.
 */
async function spaceIdForProviderSubscriptionId(
  providerSubscriptionId: string
): Promise<string | null> {
  if (!providerSubscriptionId) {
    return null;
  }
  const [row] = await db
    .select({ id: schema.spaces.id })
    .from(schema.spaces)
    .where(eq(schema.spaces.providerSubscriptionId, providerSubscriptionId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Look up the canonical Polar customer id stored on `spaces` (captured from
 * the first webhook seen for the space). Independent of the customer's
 * `external_id`, which Polar SHARES across sibling spaces of the same user.
 */
async function polarCustomerIdForSpace(
  spaceId: string
): Promise<string | null> {
  if (!spaceId) {
    return null;
  }
  const [row] = await db
    .select({ polarCustomerId: schema.spaces.polarCustomerId })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);
  return row?.polarCustomerId ?? null;
}

/**
 * Extract a string `spaceId` from a Polar metadata object. The Polar SDK
 * types metadata values as `string | number | boolean`, but we always write
 * strings — narrow defensively.
 */
function spaceIdFromMetadata(
  metadata: Record<string, string | number | boolean> | null | undefined
): string | null {
  const value = metadata?.spaceId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Resolve a Polar product id from a Krova `plans.id`. Throws with a clear
 * error if the plan does not exist, has `priceUsd = 0` (free — cannot be
 * subscribed via checkout), or has no `polarProductId` (paid plan not yet
 * provisioned in Polar — operator must run the "Provision in Polar" action).
 */
async function requirePolarProductIdForPlan(planId: string): Promise<string> {
  const [plan] = await db
    .select({
      id: schema.plans.id,
      name: schema.plans.name,
      priceUsd: schema.plans.priceUsd,
      polarProductId: schema.plans.polarProductId,
    })
    .from(schema.plans)
    .where(eq(schema.plans.id, planId))
    .limit(1);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }
  if (Number.parseFloat(plan.priceUsd) <= 0) {
    throw new Error(
      `Free plans cannot be subscribed to via checkout (${plan.name}).`
    );
  }
  if (!plan.polarProductId) {
    throw new Error(
      `Plan ${plan.name} has no Polar product id — provision it in Polar before subscribing.`
    );
  }
  return plan.polarProductId;
}

/**
 * Extract a human-meaningful error string from a Polar SDK exception. The SDK
 * surfaces validation + processor errors with a `body` field carrying detail;
 * fall back to the plain `message` if the shape varies between SDK versions.
 */
function polarErrorDetail(err: unknown): string | null {
  if (!err) {
    return null;
  }
  if (typeof err === "object") {
    const e = err as {
      body?: { detail?: unknown };
      message?: unknown;
    };
    const detail = e.body?.detail;
    if (typeof detail === "string" && detail.length > 0) {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      // Polar validation errors come back as an array of {msg, loc} entries
      // — surface the first one's `msg`.
      const first = detail[0] as { msg?: unknown };
      if (typeof first?.msg === "string" && first.msg.length > 0) {
        return first.msg;
      }
    }
    if (typeof e.message === "string" && e.message.length > 0) {
      return e.message;
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return null;
}

/** Re-export the verification error so the route can branch on it. */
export { WebhookVerificationError };

export const polarProvider: PaymentProvider = {
  name: "polar",

  async createTopupCheckout(
    input: TopupCheckoutInput
  ): Promise<CheckoutResult> {
    const settings = await getPlatformSettings();
    if (!settings.polarCreditProductId) {
      throw new Error(
        "Polar credit product id is not configured. Set it in Orbit → Platform Settings."
      );
    }
    const productId = settings.polarCreditProductId;
    const polar = getPolarClient();
    const checkout = await polar.checkouts.create({
      products: [productId],
      amount: input.totalCents,
      successUrl: input.successUrl,
      allowDiscountCodes: false,
      // Polar customer = Krova space. One Polar customer record per space —
      // ownership transfer updates THIS record's email (via
      // `updateCustomerForSpace`) without affecting any other space's billing.
      externalCustomerId: input.spaceId,
      // Pre-fill so the Polar checkout page isn't blank when the customer
      // arrives. They can still edit if they want a different billing email.
      customerEmail: input.contact.email,
      customerName: input.contact.name,
      metadata: { spaceId: input.spaceId, purchaseId: input.purchaseId },
      // `customerMetadata` is COPIED to the Polar customer record at first
      // creation — makes the Polar dashboard row queryable + back-linkable
      // to a Krova space + owner. Keys ≤40 chars, values ≤500 chars (Polar
      // limits per docs).
      customerMetadata: {
        spaceId: input.spaceId,
        initiatorUserId: input.initiatorUserId,
      },
    });
    return { checkoutId: checkout.id, url: checkout.url };
  },

  async createSubscriptionCheckout(
    input: SubscriptionCheckoutInput
  ): Promise<CheckoutResult> {
    const productId = await requirePolarProductIdForPlan(input.planId);
    const polar = getPolarClient();
    const checkout = await polar.checkouts.create({
      products: [productId],
      successUrl: input.successUrl,
      allowDiscountCodes: false,
      // Same scoping as topup — see comment in createTopupCheckout.
      externalCustomerId: input.spaceId,
      customerEmail: input.contact.email,
      customerName: input.contact.name,
      metadata: {
        spaceId: input.spaceId,
        intentId: input.intentId,
        planId: input.planId,
      },
      // Same rationale as createTopupCheckout — copied to the customer record.
      customerMetadata: {
        spaceId: input.spaceId,
        initiatorUserId: input.initiatorUserId,
      },
    });
    return { checkoutId: checkout.id, url: checkout.url };
  },

  async updateCustomerForSpace(
    spaceId: string,
    contact: { email: string; name: string | null }
  ): Promise<void> {
    const polar = getPolarClient();
    // Prefer the canonical Polar customer id captured from a prior webhook
    // — `external_id` is shared across sibling spaces of the same user and
    // `updateExternal` for a sibling 404s (the space's id is not the
    // customer's `external_id`), so an ownership transfer would silently
    // never update the customer's invoice contact for any non-first space.
    const polarCustomerId = await polarCustomerIdForSpace(spaceId);
    try {
      if (polarCustomerId) {
        await polar.customers.update({
          id: polarCustomerId,
          customerUpdate: {
            email: contact.email,
            name: contact.name,
          },
        });
        return;
      }
      // No id captured yet — fall back to the external_id path. Works for a
      // first / only space; 404s for a sibling (silent OK below).
      await polar.customers.updateExternal({
        externalId: spaceId,
        customerUpdateExternalID: {
          email: contact.email,
          name: contact.name,
        },
      });
    } catch (err) {
      // 404 = the space has no Polar customer record we can address yet
      // (free-plan / never-billed space). Nothing to update; silent OK so a
      // transfer of an unbilled space is not surfaced as a failure.
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404) {
        return;
      }
      throw err;
    }
  },

  async changeSubscription(
    providerSubscriptionId: string,
    newPlanId: string
  ): Promise<ChangeSubscriptionResult> {
    try {
      const productId = await requirePolarProductIdForPlan(newPlanId);
      const polar = getPolarClient();
      // `prorationBehavior: "invoice"` — Polar issues an immediate proration
      // invoice for the difference (upgrade: charge now; downgrade: credit
      // to next invoice). The plan change ONLY takes effect if the immediate
      // payment succeeds — declined cards reject the change atomically.
      // Without this param Polar uses the org-wide default (`prorate` by
      // default in fresh accounts), which DEFERS the upgrade charge to the
      // next renewal — customer gets the higher tier for free until then.
      // See https://polar.sh/docs/guides/proration-for-subscription-changes
      await polar.subscriptions.update({
        id: providerSubscriptionId,
        subscriptionUpdate: {
          productId,
          prorationBehavior: "invoice",
        },
      });
      return { ok: true };
    } catch (err) {
      // Surface Polar's specific reason (declined card, 3DS failure, etc.)
      // rather than a generic "failed" — the customer can act on the real
      // error. Falls back to the JS message if Polar's error shape varies.
      const detail = polarErrorDetail(err);
      return {
        ok: false,
        reason: detail ?? "Plan change failed.",
      };
    }
  },

  async createCustomerPortalSession(
    spaceId: string,
    returnUrl: string
  ): Promise<CustomerPortalResult> {
    const polarCustomerId = await polarCustomerIdForSpace(spaceId);
    if (!polarCustomerId) {
      return {
        ok: false,
        reason:
          "This space has no provider customer record yet. Subscribe to a paid plan or top up credits first.",
      };
    }
    console.log(
      `[polar] createCustomerPortalSession: spaceId=${spaceId} customerId=${polarCustomerId}`
    );
    try {
      const polar = getPolarClient();
      // `customerId` (NOT `externalCustomerId`) because Rule 42: Polar's
      // external_id is shared per-email across sibling spaces. The space's
      // captured polar_customer_id is the only sibling-safe address.
      //
      // `returnUrl` goes IN THE REQUEST BODY (not appended to the response
      // URL). Polar embeds it inside the session token + injects the back
      // button in the portal page itself. The returned `customerPortalUrl`
      // must then be used AS-IS — Polar's BetterAuth adapter is the
      // reference (polar-adapters/packages/polar-betterauth/src/plugins/
      // portal.ts) and confirms `return_url` belongs in the create() body,
      // not on the response URL. Manually appending `?return_url=…` to the
      // response corrupts Polar's session URL and the portal page hangs.
      //
      // 10s hard timeout on the SDK call. Polar's customer-portal API has
      // been seen to hang under intermittent network conditions; without a
      // timeout the customer's spinner spins forever and the server-action
      // promise never settles. `timeoutMs` is the SDK's documented option.
      const session = await polar.customerSessions.create(
        { customerId: polarCustomerId, returnUrl },
        { timeoutMs: 10_000 }
      );
      console.log(
        `[polar] createCustomerPortalSession: got session, portalUrl=${session.customerPortalUrl?.slice(0, 80) ?? "(missing)"}…`
      );
      if (!session.customerPortalUrl) {
        return {
          ok: false,
          reason:
            "Polar returned a session without a portal URL — contact support.",
        };
      }
      return { ok: true, url: session.customerPortalUrl };
    } catch (err) {
      const detail = polarErrorDetail(err);
      console.error(
        `[polar] createCustomerPortalSession failed for space ${spaceId}:`,
        detail ?? err
      );
      return {
        ok: false,
        reason: detail ?? "Could not open the customer portal.",
      };
    }
  },

  async cancelSubscription(
    providerSubscriptionId: string,
    opts?: { reason?: string | null; comment?: string | null }
  ): Promise<void> {
    const polar = getPolarClient();
    // `customerCancellationReason` is Polar's SubscriptionCancel enum
    // (too_expensive | missing_features | switched_service | unused |
    //  customer_service | low_quality | too_complex | other). We pass the
    // value through as a string — the SDK validates and Polar will reject
    // an unknown value, surfacing as polarErrorDetail to the caller.
    // `customerCancellationComment` is a free-text field (≤ 1000 chars).
    await polar.subscriptions.update({
      id: providerSubscriptionId,
      subscriptionUpdate: {
        cancelAtPeriodEnd: true,
        ...(opts?.reason
          ? {
              customerCancellationReason:
                opts.reason as CustomerCancellationReason,
            }
          : {}),
        ...(opts?.comment ? { customerCancellationComment: opts.comment } : {}),
      },
    });
  },

  async resumeSubscription(providerSubscriptionId: string): Promise<void> {
    const polar = getPolarClient();
    await polar.subscriptions.update({
      id: providerSubscriptionId,
      subscriptionUpdate: { cancelAtPeriodEnd: false },
    });
  },

  async getSubscription(
    providerSubscriptionId: string
  ): Promise<SubscriptionState | null> {
    try {
      const polar = getPolarClient();
      const sub = await polar.subscriptions.get({ id: providerSubscriptionId });
      const planId = await planIdForPolarProductId(sub.productId ?? "");
      if (!planId) {
        return null;
      }
      return {
        planId,
        periodStart: sub.currentPeriodStart ?? new Date(),
        periodEnd: sub.currentPeriodEnd ?? new Date(),
        providerStatus: sub.status,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
        providerCustomerId: sub.customer?.id ?? null,
      };
    } catch (err) {
      // A 404 (unknown subscription) → null; other errors rethrow so the
      // caller's retry path (webhook 500) kicks in.
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404) {
        return null;
      }
      throw err;
    }
  },

  async getActiveSubscriptionForSpace(
    spaceId: string
  ): Promise<(SubscriptionState & { providerSubscriptionId: string }) | null> {
    // Query by `metadata.spaceId` — sibling-safe. The legacy implementation
    // looked the customer up by `external_id == spaceId`, which 404s for any
    // space that is not the FIRST one the user subscribed (Polar pins
    // `external_id` to that first space and locks it for life). For a sibling
    // space the legacy path returned null → the reconcile cron would then
    // synthesize a `canceled` event and silently regress the space to Trial
    // every hour, even though Polar shows the subscription active.
    //
    // We also constrain by `active: true` so the result set excludes
    // canceled/revoked subs, and by metadata key strictly — Polar's deepObject
    // filter syntax matches the value, not a substring.
    try {
      const polar = getPolarClient();
      const page = await polar.subscriptions.list({
        metadata: { spaceId },
        active: true,
        limit: 10,
      });
      const subs = page.result.items;
      // Among active subs (should be at most one per space; defensively
      // accept multiples), pick the first one mapping to a known plan.
      for (const sub of subs) {
        const planId = await planIdForPolarProductId(sub.productId ?? "");
        if (!planId) {
          continue;
        }
        return {
          providerSubscriptionId: sub.id,
          planId,
          periodStart: sub.currentPeriodStart ?? new Date(),
          periodEnd: sub.currentPeriodEnd ?? new Date(),
          providerStatus: sub.status,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
          providerCustomerId: sub.customer?.id ?? null,
        };
      }
      return null;
    } catch (err) {
      // Polar's list endpoint returns an empty page for "no match" rather
      // than 404, but defensively handle 404 the same as empty (treat as
      // "no active subscription for this space").
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404) {
        return null;
      }
      throw err;
    }
  },

  async reportMeterEvents(
    events: MeterUsageEvent[]
  ): Promise<MeterReportResult> {
    if (events.length === 0) {
      return { inserted: 0, duplicates: 0 };
    }
    const settings = await getPlatformSettings();
    if (!settings.polarOverageMeterId) {
      // The meter has not been configured by the operator yet. THROW (do not
      // silently no-op) so the caller's catch leaves `polar_meter_reported_at`
      // NULL — the reconcile cron will keep retrying every 10 min and as soon
      // as the operator pastes the id into Orbit the queued events flow
      // through.
      //
      // A silent no-op would let the caller back-fill the timestamp and
      // permanently lose every event accrued during the misconfiguration
      // window — real money silently dropped.
      throw new Error(
        "Polar overage meter id is not configured. Set it in Orbit → Platform Settings; the reconcile cron will replay queued events."
      );
    }
    const polar = getPolarClient();
    // Resolve each event's space → its Polar customer id (captured from the
    // first webhook seen for the space). Independent of `external_id`, which
    // is shared across sibling spaces and would mis-attribute or auto-create
    // a phantom customer for any non-first space.
    //
    // Batch the lookup with `inArray` so we do ONE round-trip regardless of
    // batch size (the hourly worker can pass dozens of events at once).
    const spaceIds = Array.from(new Set(events.map((e) => e.spaceId)));
    const rows = spaceIds.length
      ? await db
          .select({
            id: schema.spaces.id,
            polarCustomerId: schema.spaces.polarCustomerId,
          })
          .from(schema.spaces)
          .where(inArray(schema.spaces.id, spaceIds))
      : [];
    const customerIdBySpace = new Map<string, string>();
    for (const row of rows) {
      if (row.polarCustomerId) {
        customerIdBySpace.set(row.id, row.polarCustomerId);
      }
    }
    const result = await polar.events.ingest(
      {
        events: events.map((e) => {
          const customerId = customerIdBySpace.get(e.spaceId);
          const base = {
            name: POLAR_OVERAGE_EVENT_NAME,
            externalId: e.eventId,
            timestamp: e.occurredAt,
            metadata: { amount_cents: e.amountCents },
          } as const;
          // Prefer the canonical customer id when known — sibling-safe.
          // Fall back to `externalCustomerId: spaceId` only for spaces that
          // haven't yet had a webhook captured (legacy / very new spaces);
          // works for a first / only space, may mis-attribute for siblings
          // until the backfill or next webhook populates the column.
          if (customerId) {
            return { ...base, customerId };
          }
          console.warn(
            `[polar] meter event for space ${e.spaceId} has no polar_customer_id captured — falling back to externalCustomerId; run scripts/backfill-polar-customer-id.ts`
          );
          return { ...base, externalCustomerId: e.spaceId };
        }),
      },
      // 10s hard timeout (mirrors the customer-portal call). This is awaited
      // INLINE inside the hourly billing per-space loop; without a timeout a
      // hung Polar API would stall the whole billing cron. On timeout the
      // caller's catch leaves polar_meter_reported_at NULL and the
      // polar.meter-reconcile cron retries — the desired behavior.
      { timeoutMs: 10_000 }
    );
    return {
      inserted: result.inserted,
      duplicates: result.duplicates,
    };
  },

  async verifyWebhook(
    rawBody: string,
    headers: Record<string, string>
  ): Promise<NormalizedPaymentEvent> {
    if (!env.POLAR_WEBHOOK_SECRET) {
      throw new Error("POLAR_WEBHOOK_SECRET is not set.");
    }
    // Throws WebhookVerificationError on a bad signature — the route maps that to 403.
    const event = validateEvent(rawBody, headers, env.POLAR_WEBHOOK_SECRET);

    if (event.type === "order.paid") {
      const order = event.data;
      const subId = order.subscriptionId ?? null;
      if (subId) {
        // A subscription order. Only a renewal CYCLE triggers a credit grant;
        // the initial `subscription_create` order is ignored here — activation
        // credit is granted from the `subscription.synced` event instead, so
        // routing subscription_create through renewal would bypass the
        // activation cooldown (anti-abuse).
        if (order.billingReason === "subscription_cycle") {
          // Routing precedence: DB lookup by subscription id → metadata →
          // customer.externalId. The Polar customer record is shared across
          // a user's spaces (Polar enforces email uniqueness per org and
          // external_id immutability), so `customer.externalId` may point at
          // a SIBLING space, not the one that owns this subscription. By the
          // time a renewal fires the activation has already linked the sub
          // to the correct space in `spaces.provider_subscription_id`, so
          // the DB is the most reliable cross-reference.
          const fromDb = await spaceIdForProviderSubscriptionId(subId);
          const fromMeta = spaceIdFromMetadata(order.metadata);
          const fromCustomer = order.customer?.externalId ?? null;
          const spaceId = fromDb ?? fromMeta ?? fromCustomer;
          if (!spaceId) {
            return { kind: "ignored" };
          }
          if (
            fromCustomer &&
            spaceId !== fromCustomer &&
            (fromDb || fromMeta)
          ) {
            console.warn(
              `[polar webhook] order ${order.id} (sub ${subId}): routing by ${fromDb ? "DB" : "metadata"} spaceId=${spaceId} (customer.externalId=${fromCustomer} differs — Polar customer shared across sibling spaces)`
            );
          }
          return {
            kind: "subscription.renewal_paid",
            providerSubscriptionId: subId,
            spaceId,
            providerCustomerId: order.customer?.id ?? null,
            providerOrderId: order.id,
            occurredAt: order.createdAt ?? new Date(),
          };
        }
        return { kind: "ignored" };
      }
      // No subscription → a one-time credit top-up. A top-up order always
      // carries the checkout id Krova created; if it is somehow absent the
      // order cannot be matched to a credit_purchases row — ignore it (the
      // billing.topup-reconcile backstop heals a genuinely stuck purchase)
      // rather than emit an empty key that would 503-retry forever.
      if (!order.checkoutId) {
        return { kind: "ignored" };
      }
      return {
        kind: "topup.paid",
        providerOrderId: order.id,
        providerCheckoutId: order.checkoutId,
      };
    }
    if (event.type === "order.refunded") {
      const order = event.data;
      // A subscription invoice refund — claw back the proportional plan-credit
      // fraction. The handler looks up the matching subscription_credit_grants
      // row (by provider_order_id, set on renewal grants) and writes a
      // `credit_refund` billing_events row.
      if (order.subscriptionId) {
        return {
          kind: "subscription.refunded",
          providerSubscriptionId: order.subscriptionId,
          providerOrderId: order.id,
          cumulativeRefundedCents: order.refundedAmount ?? 0,
        };
      }
      if (!order.checkoutId) {
        return { kind: "ignored" };
      }
      return {
        kind: "topup.refunded",
        providerOrderId: order.id,
        providerCheckoutId: order.checkoutId,
        cumulativeRefundedCents: order.refundedAmount ?? 0,
      };
    }
    if (event.type === "checkout.expired") {
      const checkout = event.data;
      return {
        kind: "checkout.expired",
        providerCheckoutId: checkout.id,
      };
    }
    if (event.type === "customer.deleted") {
      const customer = event.data;
      return {
        kind: "customer.deleted",
        providerCustomerId: customer.id,
      };
    }
    if (event.type === "customer.state_changed") {
      const customer = event.data;
      return {
        kind: "customer.state_changed",
        providerCustomerId: customer.id,
      };
    }
    if (
      event.type === "subscription.created" ||
      event.type === "subscription.active" ||
      event.type === "subscription.updated" ||
      event.type === "subscription.canceled" ||
      event.type === "subscription.revoked" ||
      event.type === "subscription.past_due" ||
      event.type === "subscription.uncanceled"
    ) {
      const sub = event.data;
      // Routing precedence: subscription metadata → DB lookup by sub id →
      // customer.externalId. We set `metadata.spaceId` on the checkout, so it
      // is the authoritative space binding for this subscription. The DB
      // lookup heals subsequent events for the same sub once the activation
      // has linked it. `customer.externalId` is the last fallback — Polar
      // enforces email uniqueness + external_id immutability per org, so a
      // user's second-space checkout reuses the existing customer record
      // (whose external_id points at the FIRST space) and trusting it
      // mis-routes the new subscription onto the wrong space.
      const fromMeta = spaceIdFromMetadata(sub.metadata);
      const fromDb = await spaceIdForProviderSubscriptionId(sub.id);
      const fromCustomer = sub.customer?.externalId ?? null;
      const spaceId = fromMeta ?? fromDb ?? fromCustomer;
      const planId = await planIdForPolarProductId(sub.productId ?? "");
      if (!spaceId || !planId) {
        return { kind: "ignored" };
      }
      if (fromCustomer && spaceId !== fromCustomer && (fromMeta || fromDb)) {
        console.warn(
          `[polar webhook] subscription ${sub.id}: routing by ${fromMeta ? "metadata" : "DB"} spaceId=${spaceId} (customer.externalId=${fromCustomer} differs — Polar customer shared across sibling spaces)`
        );
      }
      return {
        kind: "subscription.synced",
        providerSubscriptionId: sub.id,
        spaceId,
        providerCustomerId: sub.customer?.id ?? null,
        planId,
        periodStart: sub.currentPeriodStart ?? new Date(),
        periodEnd: sub.currentPeriodEnd ?? new Date(),
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
        providerStatus: sub.status,
        occurredAt: sub.modifiedAt ?? sub.createdAt ?? new Date(),
      };
    }
    return { kind: "ignored" };
  },

  async createPlanProduct(
    input: CreatePlanProductInput
  ): Promise<CreatePlanProductResult> {
    const polar = getPolarClient();
    const prices: Array<
      | { amountType: "fixed"; priceCurrency: "usd"; priceAmount: number }
      | {
          amountType: "metered_unit";
          priceCurrency: "usd";
          meterId: string;
          unitAmount: string;
        }
    > = [
      {
        amountType: "fixed",
        priceCurrency: "usd",
        priceAmount: Math.round(input.grossedUpPriceUsd * 100),
      },
    ];
    if (input.overageMeterId) {
      prices.push({
        amountType: "metered_unit",
        priceCurrency: "usd",
        meterId: input.overageMeterId,
        // Polar's `unit_amount` is in CENTS per meter unit. The overage meter
        // aggregates the `amount_cents` event metadata, so 1 meter unit = 1
        // cent of accrued overage. Pass-through billing therefore needs
        // unit_amount = "1" (one cent per meter unit). `"0.01"` would mean
        // 0.01 cents per unit = $0.0001/unit — undercharges by 100×.
        unitAmount: "1",
      });
    }
    const product = await polar.products.create({
      name: input.name,
      recurringInterval: "month",
      prices,
    });
    return { productId: product.id };
  },

  async updatePlanProduct(input: UpdatePlanProductInput): Promise<void> {
    const polar = getPolarClient();
    // Replace the fixed price with a new one. Polar grandfathers existing
    // subscribers automatically (their subscription stays on the old price).
    // Metered price (if any) is preserved via ExistingProductPrice reference.
    const product = await polar.products.get({ id: input.productId });
    const existingMeteredPrice = (product.prices ?? []).find(
      (p) => "amountType" in p && p.amountType === "metered_unit"
    );
    const prices: Array<
      | { id: string }
      | { amountType: "fixed"; priceCurrency: "usd"; priceAmount: number }
      | {
          amountType: "metered_unit";
          priceCurrency: "usd";
          meterId: string;
          unitAmount: string;
        }
    > = [
      {
        amountType: "fixed",
        priceCurrency: "usd",
        priceAmount: Math.round(input.grossedUpPriceUsd * 100),
      },
    ];
    if (existingMeteredPrice) {
      prices.push({ id: existingMeteredPrice.id });
    } else if (input.overageMeterId) {
      prices.push({
        amountType: "metered_unit",
        priceCurrency: "usd",
        meterId: input.overageMeterId,
        // 1 cent per meter unit — see comment in `createPlanProduct`.
        unitAmount: "1",
      });
    }
    await polar.products.update({
      id: input.productId,
      productUpdate: { prices },
    });
  },

  async archivePlanProduct(productId: string): Promise<void> {
    const polar = getPolarClient();
    await polar.products.update({
      id: productId,
      productUpdate: { isArchived: true },
    });
  },

  async unarchivePlanProduct(productId: string): Promise<void> {
    const polar = getPolarClient();
    await polar.products.update({
      id: productId,
      productUpdate: { isArchived: false },
    });
  },
};
