/**
 * Provider-agnostic payment surface. Nothing outside `lib/payments/` imports
 * a payment-provider SDK directly — swapping the gateway means adding one new
 * implementation of `PaymentProvider`.
 */

/** Contact details used to pre-fill the provider's hosted checkout form so
 *  the customer doesn't have to re-type their email / name. The Krova space
 *  is the Polar customer (per-space scoping); these fields just save them
 *  some typing. */
export interface CustomerContact {
  /** Pre-fills the checkout email field. */
  email: string;
  /** Pre-fills the cardholder name field. Null when the user has no profile name. */
  name: string | null;
}

/** Input for creating a one-time top-up checkout. */
export interface TopupCheckoutInput {
  /** Pre-fill contact info for the checkout form (the human paying). */
  contact: CustomerContact;
  /** Krova user id of the initiator. Threaded into the provider customer's
   *  metadata so the Polar dashboard row links back to the Krova user. */
  initiatorUserId: string;
  /** The `credit_purchases` row id — round-tripped in provider metadata. */
  purchaseId: string;
  /** Krova space the credit is for. */
  spaceId: string;
  /** Where the provider redirects the browser after a successful payment. */
  successUrl: string;
  /** Total to charge the customer, in integer cents (base + processing fee). */
  totalCents: number;
}

/** Input for creating a recurring subscription checkout. */
export interface SubscriptionCheckoutInput {
  /** Pre-fill contact info for the checkout form. */
  contact: CustomerContact;
  /** Krova user id of the initiator — threaded into provider customer metadata. */
  initiatorUserId: string;
  /** The `subscription_intents` row id — round-tripped in provider metadata. */
  intentId: string;
  /** Phase 5 — the `plans.id` (CUID2) the customer is subscribing to. The
   *  provider implementation looks up the Polar product id from the plan row. */
  planId: string;
  /** Krova space the subscription is for. */
  spaceId: string;
  /** Where the provider redirects the browser after checkout. */
  successUrl: string;
}

/** Result of creating a checkout (top-up or subscription). */
export interface CheckoutResult {
  /** Provider-side checkout id. */
  checkoutId: string;
  /** Hosted checkout URL the customer is redirected to. */
  url: string;
}

/** Back-compat alias — top-up checkout result shape (identical to CheckoutResult). */
export type TopupCheckoutResult = CheckoutResult;

/** Result of a provider-side subscription plan change. Never `void` — a
 *  provider rejection of the change must surface to the caller. */
export type ChangeSubscriptionResult =
  | { ok: true }
  | { ok: false; reason: string };

/** A subscription's authoritative current state, fetched from the provider. */
export interface SubscriptionState {
  cancelAtPeriodEnd: boolean;
  periodEnd: Date;
  periodStart: Date;
  /** Phase 5 — `plans.id` resolved from the provider's product id via DB lookup. */
  planId: string;
  /**
   * Provider's canonical customer id (e.g. Polar `cus_…` / UUID), or null
   * when the provider response did not expand the customer. Threaded so the
   * reconcile path can persist `spaces.polar_customer_id` from the same
   * authoritative read it uses to heal plan/period state.
   */
  providerCustomerId: string | null;
  /** Raw provider status string (active|past_due|canceled|unpaid|…). */
  providerStatus: string;
}

/** A single overage usage event reported to the provider's meter. */
export interface MeterUsageEvent {
  /** The overage amount, in integer cents. */
  amountCents: number;
  /**
   * Idempotency key — the provider dedupes on this. Krova uses the
   * `billing_events.id` (CUID2) of the row that recorded the debit, so a
   * redelivered call is a no-op.
   */
  eventId: string;
  /** When the usage occurred — the hourly tick's `billedAt`. */
  occurredAt: Date;
  /** The provider's external_customer_id — Krova's space id. */
  spaceId: string;
}

/** Result of reporting one or more meter events. */
export interface MeterReportResult {
  /** Events the provider deduped on `eventId`. */
  duplicates: number;
  /** Events the provider accepted. */
  inserted: number;
}

/** Input for creating a new subscription product in the provider. */
export interface CreatePlanProductInput {
  /** Face price of the plan (USD). Krova grosses up to the customer-charge total. */
  facePriceUsd: number;
  /** The grossed-up customer charge (USD), computed via paymentBreakdown. */
  grossedUpPriceUsd: number;
  /** Display name (mirrors the Krova plan name). */
  name: string;
  /** Meter id used by the metered price for overage. May be null — operator
   *  unconfigured; the product is created WITHOUT a metered price (overage
   *  is inert until configured). */
  overageMeterId: string | null;
}

/** Result of creating a subscription product. */
export interface CreatePlanProductResult {
  productId: string;
}

/** Input for updating an existing subscription product's fixed price. */
export interface UpdatePlanProductInput {
  /** New face price (USD). Krova grosses up. */
  facePriceUsd: number;
  grossedUpPriceUsd: number;
  /** Meter id; if present, the metered price is preserved. */
  overageMeterId: string | null;
  productId: string;
}

/**
 * A provider webhook event, normalized to Krova's domain. The webhook route
 * dispatches on `kind` and never sees provider-specific shapes.
 */
export type NormalizedPaymentEvent =
  | {
      kind: "topup.paid";
      providerOrderId: string;
      providerCheckoutId: string;
    }
  | {
      kind: "topup.refunded";
      providerOrderId: string;
      providerCheckoutId: string;
      /** Cumulative amount refunded on the order so far, in integer cents. */
      cumulativeRefundedCents: number;
    }
  | {
      /** subscription.created / .active / .updated — current full state. */
      kind: "subscription.synced";
      providerSubscriptionId: string;
      /** Krova space id — resolved by the provider implementation
       *  (metadata-first, then DB, then customer.externalId). */
      spaceId: string;
      /**
       * The provider's canonical customer id (e.g. Polar `cus_…` / UUID). Used
       * by the handler to populate `spaces.polar_customer_id` so subsequent
       * Polar lookups (meter events, customer profile updates) address the
       * right customer record — never the (sibling-shared) `external_id`.
       * Null only if the event payload did not include a customer object.
       */
      providerCustomerId: string | null;
      /** Phase 5 — `plans.id` resolved from the subscription's product id via DB lookup. */
      planId: string;
      periodStart: Date;
      periodEnd: Date;
      cancelAtPeriodEnd: boolean;
      /** Raw provider status string (active|past_due|canceled|unpaid|…). */
      providerStatus: string;
      /** Provider event timestamp — the staleness key. */
      occurredAt: Date;
    }
  | {
      /** A renewal order was paid — triggers the period's credit grant. */
      kind: "subscription.renewal_paid";
      providerSubscriptionId: string;
      spaceId: string;
      /** See `subscription.synced` — same rationale. */
      providerCustomerId: string | null;
      /** The Polar order id of the subscription_cycle order. Stored on the
       *  grant row so a subsequent `order.refunded` can look it up in O(1). */
      providerOrderId: string;
      occurredAt: Date;
    }
  | {
      /**
       * A subscription invoice (activation or renewal) was refunded — claw
       * back the proportional plan-credit fraction from the space's balance.
       * Idempotent on (providerOrderId, cumulativeRefundedCents): the handler
       * compares against `subscription_credit_grants.refunded_amount` to
       * compute the newly-refunded delta.
       */
      kind: "subscription.refunded";
      providerSubscriptionId: string;
      providerOrderId: string;
      /** Cumulative amount refunded on the order so far, in integer cents. */
      cumulativeRefundedCents: number;
    }
  | {
      /**
       * A hosted checkout link expired without completion. Marks the matching
       * `subscription_intents` or `credit_purchases` row failed so the
       * customer can retry immediately instead of waiting for the 24h reaper.
       */
      kind: "checkout.expired";
      providerCheckoutId: string;
    }
  | {
      /**
       * A Polar customer record was deleted (operator action, GDPR). Clears
       * `spaces.polar_customer_id` for every space that referenced it so
       * future meter / customer-update calls don't 404 against a dead id.
       */
      kind: "customer.deleted";
      providerCustomerId: string;
    }
  | {
      /**
       * Backup heartbeat — Polar fires this whenever a customer's overall
       * state changes (active subscriptions / granted benefits). We use it
       * to re-reconcile every Krova space that maps to this customer,
       * catching anything a dropped subscription.* event missed.
       */
      kind: "customer.state_changed";
      providerCustomerId: string;
    }
  /** Any event Krova does not act on (the route returns 200). */
  | { kind: "ignored" };

/** Back-compat alias for the pre-Phase-3 name. */
export type NormalizedTopupEvent = NormalizedPaymentEvent;

/** Result of opening a hosted customer portal session for a space. */
export type CustomerPortalResult =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/** The operations Krova needs from a payment provider. */
export interface PaymentProvider {
  /** Archive a subscription product. Existing subs continue; new checkouts blocked. */
  archivePlanProduct(productId: string): Promise<void>;
  /** Cancel a subscription at period end (not an immediate revoke). The
   *  optional reason + comment are forwarded to the provider for analytics
   *  (Polar's SubscriptionCancel schema accepts customer_cancellation_reason
   *  + customer_cancellation_comment). */
  cancelSubscription(
    providerSubscriptionId: string,
    opts?: {
      reason?: string | null;
      comment?: string | null;
    }
  ): Promise<void>;
  /**
   * Switch an existing subscription to a different plan's product. Returns a
   * result — a provider-side rejection surfaces to the caller, never throws
   * for an expected rejection. `newPlanId` is the `plans.id` (CUID2); the
   * provider resolves the Polar product id via DB lookup.
   */
  changeSubscription(
    providerSubscriptionId: string,
    newPlanId: string
  ): Promise<ChangeSubscriptionResult>;
  /**
   * Open a pre-authenticated customer portal session for a space. Customer
   * uses it to update payment method, download invoices, cancel/resume, and
   * change plan (when enabled in the provider dashboard). The URL is
   * short-lived and bound to one customer.
   *
   * Returns `{ ok: false }` when the space has no provider customer yet
   * (free-plan space that never subscribed) — the caller surfaces this as a
   * UX error rather than throwing.
   */
  createCustomerPortalSession(
    spaceId: string,
    returnUrl: string
  ): Promise<CustomerPortalResult>;
  /** Create a recurring subscription product for a new plan. */
  createPlanProduct(
    input: CreatePlanProductInput
  ): Promise<CreatePlanProductResult>;
  /** Create a hosted checkout for a recurring plan subscription. */
  createSubscriptionCheckout(
    input: SubscriptionCheckoutInput
  ): Promise<CheckoutResult>;
  /** Create a one-time hosted checkout for a credit top-up. */
  createTopupCheckout(input: TopupCheckoutInput): Promise<CheckoutResult>;
  /**
   * The space's current active subscription as the provider sees it, or null
   * if the space's customer has none. Used by the reconcile cron to heal a
   * lost activation webhook. `providerSubscriptionId` is included so the
   * caller can record it.
   */
  getActiveSubscriptionForSpace(
    spaceId: string
  ): Promise<(SubscriptionState & { providerSubscriptionId: string }) | null>;
  /**
   * Fetch a subscription's authoritative current state. Used by the renewal
   * handler to key the credit grant on the real current period, and by the
   * reconcile cron. Returns null if the subscription is unknown to the provider.
   */
  getSubscription(
    providerSubscriptionId: string
  ): Promise<SubscriptionState | null>;
  /** Stable provider name, stored on `*.payment_provider`. */
  readonly name: string;
  /**
   * Report a batch of overage events to the provider's meter. Idempotent on
   * each event's `eventId` — the provider dedupes server-side. Throws on a
   * provider error so the caller can retry. A no-op if the provider has not
   * been configured for metered billing (return inserted=0, duplicates=0).
   */
  reportMeterEvents(events: MeterUsageEvent[]): Promise<MeterReportResult>;
  /**
   * Resume a subscription that was previously set to cancel at period end
   * (clears the pending-cancel flag). Only valid while the original period
   * has not ended yet — once the cancel has actually fired, the customer
   * must start a fresh checkout.
   */
  resumeSubscription(providerSubscriptionId: string): Promise<void>;
  /** Reverse `archivePlanProduct` — re-open the product to new checkouts. */
  unarchivePlanProduct(productId: string): Promise<void>;
  /**
   * Update the contact details on the provider customer record for a space.
   * Called after a space ownership transfer: the original owner's payment
   * method stays on file (Polar binds payment methods to a customer at
   * checkout time, and we don't have the new owner's card), but invoice +
   * dunning emails now route to the new owner. The new owner uses Polar's
   * hosted customer portal to swap the payment method.
   *
   * No-ops gracefully if the space has no provider customer yet (free-plan
   * space that has never been billed).
   */
  updateCustomerForSpace(
    spaceId: string,
    contact: CustomerContact
  ): Promise<void>;
  /** Update a subscription product's fixed price. Existing subscribers
   *  grandfathered (provider-side behavior). */
  updatePlanProduct(input: UpdatePlanProductInput): Promise<void>;
  /**
   * Verify a webhook's signature and normalize it. MUST throw if the
   * signature is invalid (the route maps a throw to HTTP 403). Async because
   * normalizing a subscription event resolves the Polar product id to a
   * `plans.id` via a DB lookup.
   */
  verifyWebhook(
    rawBody: string,
    headers: Record<string, string>
  ): Promise<NormalizedPaymentEvent>;
}
