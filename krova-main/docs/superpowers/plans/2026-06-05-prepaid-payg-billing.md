# Prepaid Pay-As-You-Go Billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Krova's subscription-plan + postpaid-overage billing with a 100% prepaid, pay-as-you-go model: prepaid credit consumed hourly, a numbered quota ladder (Tier 0–4) unlocked by lifetime spend + admin override, threshold-based off-session auto-recharge, on direct Stripe (US LLC).

**Architecture:** Reuse the existing `plans` catalog (repurposed as the Tier 0–4 quota ladder), per-space overrides, `effectiveLimits()`, the credit engine, plan-limit guards, and zero-balance auto-sleep. Add a direct-Stripe provider behind the existing `PaymentProvider` interface (prepaid subset only), a pure `nextTierForSpend` promotion function, a prepaid affordability guard, and a `credit.auto-recharge` worker job. Delete the entire Polar subscription stack and the entire postpaid overage system (phased, additive-first per Rule 40). Tiers are pure Krova logic, never touching the payment provider.

**Tech Stack:** Next.js 16 / TypeScript strict · Drizzle ORM + PostgreSQL · pg-boss worker · Stripe (`stripe` node SDK, direct) · React Email + EmailIt · `tsx --test` (unit) + `node --test` integration.

**Spec:** [docs/superpowers/specs/2026-06-05-prepaid-payg-billing-redesign-design.md](../specs/2026-06-05-prepaid-payg-billing-redesign-design.md)

**Non-negotiable project rules in play:** Rule 1 (SSH/charges in worker, not routes — applies to off-session charges via the worker), 4 (Drizzle only), 5 (env via `lib/env.ts`), 6 (`db:generate`, never hand-write migrations; operator applies), 7 (idempotent handlers), 9 (audit every mutation), 10 (React Email), 30 (config in `config/platform.ts`), 40 (additive/non-locking DDL; live prod), 56 (every job in `QUEUE_OPTIONS`), 59 (tests ship; `pnpm test:all` is the gate), 60 (operator runs prod/migration/`db:migrate`), Third-party (pin + re-verify Stripe SDK before writing provider code).

---

## File Structure

**Created:**
- `lib/payments/stripe/client.ts` — `getStripeClient()` singleton, version-pinned.
- `lib/payments/stripe/provider.ts` — `stripeProvider: PaymentProvider` (prepaid subset).
- `lib/payments/stripe/normalize-webhook.ts` — pure Stripe-event → `NormalizedPaymentEvent` mapping (unit-tested).
- `app/api/webhooks/stripe/route.ts` — raw-body Stripe webhook receiver.
- `scripts/setup-stripe.ts` — operator one-shot: register webhook endpoint + top-up product/price.
- `lib/plan/promotion.ts` — pure `nextTierForSpend()` + `TIER_LADDER`.
- `lib/plan/promotion.test.ts` — unit tests.
- `lib/billing/auto-recharge-math.ts` — pure `computeRechargeAmountCents()`.
- `lib/billing/auto-recharge-math.test.ts` — unit tests.
- `lib/worker/handlers/credit-auto-recharge.ts` — off-session top-up job handler.
- `lib/email/templates/auto-recharge-failed.tsx`, `tier-promoted.tsx` — React Email templates.
- `scripts/seed-tiers.ts` — idempotent Tier 0–4 upsert (operator-run).
- `scripts/migrate-spaces-to-tiers.ts` — operator-run existing-customer mapping.
- `tests/integration/auto-recharge.test.ts`, `tests/integration/tier-promotion.test.ts`, `tests/integration/prepaid-guard.test.ts`.

**Modified:**
- `db/schema/spaces.ts` — new prepaid/auto-recharge/lifetime-spend columns.
- `db/schema/credit-purchases.ts` — `stripePaymentIntentId`, `source`.
- `lib/env.ts` — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- `config/platform.ts` — tier thresholds, auto-recharge defaults.
- `lib/payments/types.ts` — trim to prepaid subset + add `saveSetupIntent` / `chargeOffSession`.
- `lib/payments/index.ts` — `getPaymentProvider()` → Stripe.
- `lib/plan/limits.ts` — prepaid affordability guard.
- `lib/worker/handlers/billing-hourly.ts` — lifetime-spend increment, promotion call, auto-recharge trigger, **remove overage buckets**.
- `lib/worker/job-types.ts` + `lib/worker/ensure-queues.ts` — register `credit.auto-recharge` (Rule 56).
- `components/space-billing.tsx` + a new payment-method/auto-recharge Sheet.

**Deleted (Phase 4, after code refs gone):** Polar subscription stack + postpaid overage system (enumerated in Phase 4).

---

## PHASE 0 — Foundation & safety rails

### Task 0.1: Pin the Stripe SDK and re-verify API shapes (third-party rule)

**Files:** `package.json`, a scratch note in the PR description.

- [ ] **Step 1:** Install and pin the SDK exact version: `pnpm add stripe@<latest>` then change the `package.json` entry to the exact version (no `^`). Record the version.
- [ ] **Step 2:** Re-verify, against the **installed** SDK's typings + current docs, the exact shapes this plan depends on (do NOT trust this doc's memory of them): `stripe.checkout.sessions.create` (`mode`, `line_items`/`price_data`, `payment_intent_data.setup_future_usage`), `stripe.setupIntents.create` (`usage:'off_session'`), `stripe.paymentIntents.create` (`off_session`, `confirm`, `payment_method`, `customer`, `amount`), `stripe.webhooks.constructEvent`, the error class for signature failure, and the error shape for off-session declines (`err.code`, `err.decline_code`, `err.raw.payment_intent`). Note any deltas from the spec in the PR description.
- [ ] **Step 3: Commit.** `git add package.json pnpm-lock.yaml && git commit -m "chore: pin stripe sdk for prepaid billing"`

### Task 0.2: Add Stripe env vars (Rule 5)

**Files:** `lib/env.ts`

- [ ] **Step 1:** Add to the Zod schema in `lib/env.ts` (match the existing optional-secret pattern used by `POLAR_ACCESS_TOKEN`):

```ts
STRIPE_SECRET_KEY: z.string().min(1).optional(),
STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
```

- [ ] **Step 2:** `pnpm typecheck` → PASS.
- [ ] **Step 3: Commit.** `git commit -am "feat(env): add STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET"`

### Task 0.3: Additive schema columns (Rule 40)

**Files:** `db/schema/spaces.ts`, `db/schema/credit-purchases.ts`, then `pnpm db:generate`.

- [ ] **Step 1:** Add to `db/schema/spaces.ts` (all nullable/defaulted; `polar_*` columns stay untouched for dual-run):

```ts
stripeCustomerId: text("stripe_customer_id"),
defaultPaymentMethodId: text("default_payment_method_id"),
autoRechargeEnabled: boolean("auto_recharge_enabled").default(false).notNull(),
autoRechargeThresholdUsd: numeric("auto_recharge_threshold_usd", { precision: 12, scale: 4 }),
autoRechargeTargetUsd: numeric("auto_recharge_target_usd", { precision: 12, scale: 4 }),
autoRechargeMonthlyCapUsd: numeric("auto_recharge_monthly_cap_usd", { precision: 12, scale: 4 }),
autoRechargeConsecutiveFailures: integer("auto_recharge_consecutive_failures").default(0).notNull(),
lifetimeCreditSpentUsd: numeric("lifetime_credit_spent_usd", { precision: 14, scale: 4 }).default("0").notNull(),
```

- [ ] **Step 2:** Add to `db/schema/credit-purchases.ts`:

```ts
stripePaymentIntentId: text("stripe_payment_intent_id"),
source: text("source").default("manual").notNull(), // 'manual' | 'auto_recharge'
```

- [ ] **Step 3:** Generate the migration: `pnpm db:generate`. Verify it produced one SQL file with `ADD COLUMN` (no table rewrite), a `meta/<idx>_snapshot.json`, and a `_journal.json` entry (Rule 6 — do NOT hand-edit). Confirm every `ADD COLUMN` is `IF NOT EXISTS` or wrap-safe.
- [ ] **Step 4:** `pnpm test:migrations` → PASS (migration chain smoke).
- [ ] **Step 5: Commit.** `git add db/schema db/migrations && git commit -m "feat(db): additive prepaid/auto-recharge/lifetime-spend columns"`
- [ ] **Step 6 (operator, Rule 60):** prepare `pnpm db:migrate` for the operator to run against prod in the deploy. Do NOT run it from dev.

### Task 0.4: Tier thresholds + auto-recharge defaults in config (Rule 30)

**Files:** `config/platform.ts`

- [ ] **Step 1:** Add a `BILLING_TIERS` block:

```ts
export const TIER_PROMOTION = {
  // cumulative lifetime credit spent (USD) required to reach each tier.
  // tier_0 = default, tier_1 = card-on-file (no spend gate), tiers 2-4 = spend.
  spendThresholdsUsd: { tier_2: 50, tier_3: 250, tier_4: 1000 } as const,
} as const;

export const AUTO_RECHARGE_DEFAULTS = {
  thresholdUsd: 20,
  targetUsd: 50,
  monthlyCapUsd: 500,
  maxConsecutiveFailures: 3,
} as const;
```

- [ ] **Step 2:** `pnpm typecheck` → PASS.
- [ ] **Step 3: Commit.** `git commit -am "feat(config): tier promotion thresholds + auto-recharge defaults"`

---

## PHASE 1 — Tier ladder + promotion + prepaid guard (pure Krova logic, NO Stripe)

> This phase is fully provider-agnostic and independently shippable. It changes limits/promotion only; billing still runs on the existing provider until Phase 3.

### Task 1.1: `nextTierForSpend` pure function

**Files:** Create `lib/plan/promotion.ts`; Test `lib/plan/promotion.test.ts`.

- [ ] **Step 1: Write the failing test** (`lib/plan/promotion.test.ts`):

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { nextTierForSpend, TIER_LADDER } from "@/lib/plan/promotion";

test("ladder order is tier_0..tier_4", () => {
  assert.deepEqual(TIER_LADDER, ["tier_0", "tier_1", "tier_2", "tier_3", "tier_4"]);
});

test("never demotes: tier_3 with $0 spend stays tier_3", () => {
  assert.equal(nextTierForSpend("tier_3", 0), "tier_3");
});

test("tier_1 promotes to tier_2 exactly at $50", () => {
  assert.equal(nextTierForSpend("tier_1", 49.99), "tier_1");
  assert.equal(nextTierForSpend("tier_1", 50), "tier_2");
});

test("tier_1 jumps straight to tier_4 at $1000", () => {
  assert.equal(nextTierForSpend("tier_1", 1000), "tier_4");
});

test("tier_0 is never spend-promoted (card-gate only)", () => {
  assert.equal(nextTierForSpend("tier_0", 9999), "tier_0");
});

test("unknown/custom slug is returned unchanged (skip)", () => {
  assert.equal(nextTierForSpend("custom_acme", 9999), "custom_acme");
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm test -- lib/plan/promotion.test.ts` → "Cannot find module".
- [ ] **Step 3: Implement** (`lib/plan/promotion.ts`):

```ts
import { TIER_PROMOTION } from "@/config/platform";

export const TIER_LADDER = ["tier_0", "tier_1", "tier_2", "tier_3", "tier_4"] as const;
export type TierSlug = (typeof TIER_LADDER)[number];

/**
 * One-way, idempotent tier promotion by cumulative lifetime spend.
 * - tier_0 is NEVER spend-promoted (Tier 0 -> Tier 1 happens on card-on-file, elsewhere).
 * - custom/unknown slugs are returned unchanged (excluded from auto-promotion).
 * - never demotes: returns max(current, spend-derived).
 */
export function nextTierForSpend(currentSlug: string, lifetimeSpentUsd: number): string {
  const idx = (TIER_LADDER as readonly string[]).indexOf(currentSlug);
  if (idx === -1) return currentSlug; // custom/unknown -> skip
  if (currentSlug === "tier_0") return "tier_0"; // card-gate only
  const t = TIER_PROMOTION.spendThresholdsUsd;
  let earned: TierSlug = "tier_1";
  if (lifetimeSpentUsd >= t.tier_4) earned = "tier_4";
  else if (lifetimeSpentUsd >= t.tier_3) earned = "tier_3";
  else if (lifetimeSpentUsd >= t.tier_2) earned = "tier_2";
  const earnedIdx = TIER_LADDER.indexOf(earned);
  return earnedIdx > idx ? earned : currentSlug; // one-way
}
```

- [ ] **Step 4: Run → PASS.** `pnpm test -- lib/plan/promotion.test.ts`
- [ ] **Step 5: Commit.** `git add lib/plan/promotion.ts lib/plan/promotion.test.ts && git commit -m "feat(plan): nextTierForSpend promotion ladder"`

### Task 1.2: Auto-recharge amount math (pure)

**Files:** Create `lib/billing/auto-recharge-math.ts`; Test `lib/billing/auto-recharge-math.test.ts`.

- [ ] **Step 1: Failing test:**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeRechargeAmountCents } from "@/lib/billing/auto-recharge-math";

test("tops up to target", () => {
  // balance $5, target $50 -> charge $45 = 4500c
  assert.equal(computeRechargeAmountCents({ balanceUsd: 5, targetUsd: 50, monthlyRemainingUsd: 1000 }), 4500);
});
test("clamps to monthly remaining cap", () => {
  assert.equal(computeRechargeAmountCents({ balanceUsd: 0, targetUsd: 50, monthlyRemainingUsd: 30 }), 3000);
});
test("returns 0 when balance already >= target", () => {
  assert.equal(computeRechargeAmountCents({ balanceUsd: 60, targetUsd: 50, monthlyRemainingUsd: 1000 }), 0);
});
test("returns 0 when cap exhausted", () => {
  assert.equal(computeRechargeAmountCents({ balanceUsd: 0, targetUsd: 50, monthlyRemainingUsd: 0 }), 0);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:**

```ts
export function computeRechargeAmountCents(input: {
  balanceUsd: number;
  targetUsd: number;
  monthlyRemainingUsd: number;
}): number {
  const needUsd = Math.max(0, input.targetUsd - input.balanceUsd);
  const allowedUsd = Math.max(0, Math.min(needUsd, input.monthlyRemainingUsd));
  return Math.round(allowedUsd * 100);
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat(billing): auto-recharge amount math"`

### Task 1.3: Re-seed the Tier 0–4 catalog (idempotent seed script)

**Files:** Create `scripts/seed-tiers.ts` (Drizzle upsert by `slug`); add `"seed:tiers": "tsx scripts/seed-tiers.ts"` to `package.json`.

- [ ] **Step 1:** Implement an idempotent upsert that inserts/updates the five tier rows by `slug` using Drizzle (`onConflictDoUpdate` on `slug`), with `priceUsd: "0"`, `includedCreditUsd: "0"` (except `tier_0` → `"5"`), `isDefaultForNewSpaces: true` only on `tier_0`, `allowTopup: false` on `tier_0` else `true`, `allowOverage: false` everywhere, `visibility: "public"`. Limits per the spec table; `tier_4` uses `maxConcurrentCubes: null`, `maxSeats: null`, `maxBackups: null`, `maxDomains: null` (= unlimited). Rename: also update the existing `plan_trial` row's display name if present, or insert `tier_0` and repoint defaults — see Task 5.x for the live remap; on a fresh DB this script alone seeds correctly. (Rule 4: Drizzle only; Rule 18: no bulk seeding — five rows is fine.)
- [ ] **Step 2:** Add an integration test `tests/integration/tier-promotion.test.ts` seed hook that runs this against the throwaway DB and asserts five rows exist with the right limits and exactly one `is_default_for_new_spaces=true`.
- [ ] **Step 3: Run → PASS** (`pnpm test:integration -- tier-promotion`).
- [ ] **Step 4: Commit.** `git commit -am "feat(plan): seed Tier 0-4 quota ladder"`

### Task 1.4: Prepaid affordability guard at provision/wake

**Files:** Modify `lib/plan/limits.ts` (add guard); wire into the cube create + wake guard paths; Test `tests/integration/prepaid-guard.test.ts`.

- [ ] **Step 1: Failing integration test:** seed a space with `creditBalance="0.50"` and assert that the provision guard rejects a cube whose projected first-hour cost is `$1.00`, and accepts when balance is `$2.00`. (Use the existing per-space-lock + guard harness pattern from the current plan-limit integration tests.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** a pure guard `assertCanAffordFirstHour(balanceUsd, firstHourCostUsd)` returning the standard allow/deny shape used by the other `*V2` guards in `lib/plan/limits.ts`, and call it inside the cube-create and cube-wake guard transactions (where `checkSpaceFitsPlanV2` / the cube-count guard already run under `acquireSpaceLock`). First-hour cost = the existing per-hour cost calc for the requested cube spec (reuse `lib/cost-shared.ts`).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat(plan): prepaid affordability guard at provision/wake"`

### Task 1.5: Track lifetime spend + auto-promote in the hourly billing pass

**Files:** Modify `lib/worker/handlers/billing-hourly.ts`; Test `tests/integration/tier-promotion.test.ts`.

- [ ] **Step 1: Failing integration test:** seed a `tier_1` space with `lifetimeCreditSpentUsd="49.00"`; run one hourly charge of `$2.00`; assert `lifetimeCreditSpentUsd` becomes `"51.0000"` AND `plan_id` is promoted to `tier_2`; re-run the same tick (idempotency) and assert no further promotion / no double increment for the same billed window.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:** inside the existing per-space charge transaction (where `creditBalance` is debited), `UPDATE` `lifetimeCreditSpentUsd = lifetimeCreditSpentUsd + <amountCharged>` in the SAME tx (read-then-set per Rule 16; never raw SQL arithmetic on the column). After commit, compute `nextTierForSpend(currentSlug, newLifetime)`; if different AND the space is not custom/overridden, set `plan_id` + `invalidatePlanCache`, write lifecycle + `audit()` rows, enqueue the `tier-promoted` email. Skip promotion when `plan_id` slug is not in `TIER_LADDER`.
- [ ] **Step 4: Run → PASS.** Then `pnpm test:all`.
- [ ] **Step 5: Commit.** `git commit -am "feat(billing): lifetime-spend tracking + auto tier promotion"`

### Task 1.6: `tier-promoted` email

**Files:** Create `lib/email/templates/tier-promoted.tsx` (React Email, Rule 10); render via `lib/email/renderer.ts`.

- [ ] **Step 1:** Build the template following an existing template (e.g. `lib/email/templates/low-balance`) — props: space name, new tier label, the unlocked caps (cubes/vCPU/RAM). Use `formatEmailDateUtc` if a date is shown (Rule 25).
- [ ] **Step 2:** Add a render smoke test next to existing email tests.
- [ ] **Step 3: Commit.** `git commit -am "feat(email): tier-promoted notification"`

---

## PHASE 2 — Stripe provider (prepaid subset) + webhook route

### Task 2.1: Trim the `PaymentProvider` interface to the prepaid subset

**Files:** Modify `lib/payments/types.ts`.

- [ ] **Step 1:** Remove subscription/meter members (`createPlanProduct`, `updatePlanProduct`, `archive/unarchivePlanProduct`, `changeSubscription`, `cancel/resumeSubscription`, `getSubscription`, `getActiveSubscriptionForSpace`, `reportMeterEvents`, `createCustomerPortalSession` if not reused). Keep `createTopupCheckout`, `verifyWebhook`, `name`, `updateCustomerForSpace`. **Add:**

```ts
saveSetupIntent(input: { spaceId: string; contact: CustomerContact }): Promise<{ clientSecret: string; setupIntentId: string }>;
chargeOffSession(input: { spaceId: string; amountCents: number; idempotencyKey: string }): Promise<{ status: "succeeded" | "requires_action" | "failed"; paymentIntentId: string; declineCode?: string }>;
```

Trim `NormalizedPaymentEvent` to: `topup.paid`, `topup.refunded`, `auto_recharge.succeeded`, `auto_recharge.failed`, `card.saved`, `customer.deleted`, `ignored`.

- [ ] **Step 2:** `pnpm typecheck` will now fail in Polar provider + callers — that's expected; the Polar provider is deleted in Phase 4. To keep the tree green during Phases 2–3, keep `lib/payments/polar/provider.ts` compiling by having it implement only the trimmed interface (delete its now-removed methods) — it stays the active provider until Phase 3 cutover. Fix call sites that referenced removed methods (subscription actions) by guarding them behind a feature flag OR moving their deletion earlier if simpler. Run `pnpm typecheck` → PASS.
- [ ] **Step 3: Commit.** `git commit -am "refactor(payments): trim PaymentProvider to prepaid subset + add setupintent/offsession"`

### Task 2.2: Stripe client singleton

**Files:** Create `lib/payments/stripe/client.ts`.

- [ ] **Step 1:** Implement `getStripeClient()` mirroring `lib/payments/polar/client.ts` (lazy singleton from `env.STRIPE_SECRET_KEY`; throw a clear error if unset; pin `apiVersion` to the value verified in Task 0.1).
- [ ] **Step 2:** `pnpm typecheck` → PASS.
- [ ] **Step 3: Commit.** `git commit -am "feat(payments): stripe client singleton"`

### Task 2.3: Webhook normalization (pure, unit-tested)

**Files:** Create `lib/payments/stripe/normalize-webhook.ts`; Test `lib/payments/stripe/normalize-webhook.test.ts`.

- [ ] **Step 1: Failing test:** feed fixture Stripe event objects (`checkout.session.completed` mode=payment, `payment_intent.succeeded` with `metadata.kind='auto_recharge'`, `payment_intent.payment_failed`, `charge.refunded`, `setup_intent.succeeded`, `customer.deleted`, and an unhandled type) into `normalizeStripeEvent(event)` and assert the resulting `NormalizedPaymentEvent.kind` + key ids. Verify the unhandled type → `{ kind: "ignored" }`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `normalizeStripeEvent(event: Stripe.Event): NormalizedPaymentEvent` — a pure switch over `event.type` using the shapes confirmed in Task 0.1 (read `metadata.spaceId` / `metadata.purchaseId` / `metadata.kind`; use `payment_intent.id`, `charge.amount_refunded`, `setup_intent.payment_method`). No network, no signature check here (that's the route).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat(payments): stripe webhook normalization"`

### Task 2.4: Stripe provider methods

**Files:** Create `lib/payments/stripe/provider.ts`.

- [ ] **Step 1:** Implement `stripeProvider: PaymentProvider`:
  - `name = "stripe"`.
  - `createTopupCheckout` → `stripe.checkout.sessions.create({ mode:"payment", line_items:[{ price_data:{ currency:"usd", product_data:{ name:"Krova credit" }, unit_amount: totalCents }, quantity:1 }], success_url, customer_email, payment_intent_data:{ setup_future_usage:"off_session", metadata:{ spaceId, purchaseId, kind:"topup" } }, metadata:{ spaceId, purchaseId } })`; return `{ checkoutId, url }`.
  - `saveSetupIntent` → ensure a Stripe customer for the space (create if `stripe_customer_id` null; persist it), `stripe.setupIntents.create({ customer, usage:"off_session", metadata:{ spaceId } })`; return `{ clientSecret, setupIntentId }`.
  - `chargeOffSession` → resolve `stripe_customer_id` + `default_payment_method_id`; `stripe.paymentIntents.create({ amount, currency:"usd", customer, payment_method, off_session:true, confirm:true, metadata:{ spaceId, kind:"auto_recharge" } }, { idempotencyKey })`; map result/exception to `{ status, paymentIntentId, declineCode }` using the error shape from Task 0.1.
  - `verifyWebhook(rawBody, headers)` → `stripe.webhooks.constructEvent(rawBody, headers["stripe-signature"], env.STRIPE_WEBHOOK_SECRET)` (throw → 403), then `normalizeStripeEvent`.
  - `updateCustomerForSpace` → `stripe.customers.update`.
- [ ] **Step 2:** `pnpm typecheck` → PASS.
- [ ] **Step 3: Commit.** `git commit -am "feat(payments): stripe provider (prepaid subset)"`

### Task 2.5: Stripe webhook route

**Files:** Create `app/api/webhooks/stripe/route.ts`.

- [ ] **Step 1:** Mirror `app/api/webhooks/polar/route.ts`: read the **raw** request text, call `getPaymentProvider().verifyWebhook(raw, headers)` (catch → 403), dispatch on `kind` to the existing apply-* handlers (`topup.paid` → `applyPaidTopup`; `topup.refunded` → refund clawback). Return 503 when `STRIPE_*` unset. `auto_recharge.*` / `card.saved` dispatch added in Phase 3.
- [ ] **Step 2:** Integration test: POST a signed fixture `checkout.session.completed` and assert the matching `credit_purchases` row flips `pending → paid` and `credit_balance` increments (idempotent on re-POST).
- [ ] **Step 3: Run → PASS.**
- [ ] **Step 4: Commit.** `git commit -am "feat(payments): stripe webhook route"`

### Task 2.6: setup-stripe operator script

**Files:** Create `scripts/setup-stripe.ts`; add `"setup:stripe"` to `package.json`.

- [ ] **Step 1:** Implement (operator-run, Rule 60): create/ensure the webhook endpoint subscribed to `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `setup_intent.succeeded`, `customer.deleted`; print the signing secret to paste into env. (No top-up Product needed — we use inline `price_data`.)
- [ ] **Step 2:** `pnpm typecheck` → PASS. (No live call from dev; operator runs it — Rule 60.)
- [ ] **Step 3: Commit.** `git commit -am "feat(payments): setup-stripe operator script"`

---

## PHASE 3 — Auto-recharge + provider cutover

### Task 3.1: Register the `credit.auto-recharge` job (Rule 56)

**Files:** `lib/worker/job-types.ts` (add to `JOB_NAMES`), `lib/worker/ensure-queues.ts` (explicit `QUEUE_OPTIONS` entry).

- [ ] **Step 1:** Add `CREDIT_AUTO_RECHARGE: "credit.auto-recharge"` to `JOB_NAMES` and an explicit `QUEUE_OPTIONS` entry (`retryLimit`, `expireInMinutes`, `localConcurrency: 1`) — the `Record<JobName,…>` type forces this or the build fails (Rule 56).
- [ ] **Step 2:** `pnpm typecheck` + `pnpm test -- ensure-queues` → PASS.
- [ ] **Step 3: Commit.** `git commit -am "feat(worker): register credit.auto-recharge queue"`

### Task 3.2: Auto-recharge worker handler

**Files:** Create `lib/worker/handlers/credit-auto-recharge.ts`; register in the worker; Test `tests/integration/auto-recharge.test.ts`.

- [ ] **Step 1: Failing integration test:** seed a space (`autoRechargeEnabled=true`, `defaultPaymentMethodId` set, balance below threshold); stub `chargeOffSession` to return `succeeded`; run the handler; assert a `credit_purchases` row (`source='auto_recharge'`) is created `pending`, and that a redelivered job with the same idempotency key does NOT create a second charge (Rule 7). Add a second test where the stub returns `failed` (`card_declined`) and assert `autoRechargeConsecutiveFailures` increments + an `audit()` row is written + balance untouched + after 3 failures `autoRechargeEnabled` flips false.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `runHandler` (Rule 1: worker only; Rule 7: idempotent): acquire per-space advisory lock; recompute `computeRechargeAmountCents(balance, target, monthlyRemaining)` (monthlyRemaining = cap − auto-recharge spent in trailing 30d, queried from `credit_purchases source='auto_recharge'`); if 0 → no-op. Insert `credit_purchases` (`source='auto_recharge'`, `pending`) BEFORE the charge (so the webhook finds it); call `chargeOffSession({ idempotencyKey: purchaseId })`. On `succeeded` → rely on the `payment_intent.succeeded` webhook to flip→paid + credit (do NOT credit here — webhook is authoritative, Rule 7). On `requires_action` (`authentication_required`) → mark row `failed`, enqueue `auto-recharge-failed` email (re-auth variant). On `failed` → mark row `failed`, increment `autoRechargeConsecutiveFailures` (read-then-set, Rule 16), `audit({action:"credit.auto_recharge_failed"})`; if `>= maxConsecutiveFailures` set `autoRechargeEnabled=false` + send "auto-recharge disabled" email. All branches write `audit()` (Rule 9).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat(worker): credit.auto-recharge off-session handler"`

### Task 3.3: Trigger auto-recharge from the hourly low-balance check

**Files:** Modify `lib/worker/handlers/billing-hourly.ts` (the low-balance branch ~line 639).

- [ ] **Step 1: Failing integration test:** space with `autoRechargeEnabled=true`, balance just under threshold after a tick → assert a `credit.auto-recharge` job is enqueued exactly once (debounced); with `autoRechargeEnabled=false` → assert the existing low-balance email path runs instead (unchanged).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:** in the low-balance branch, if `autoRechargeEnabled && balance < autoRechargeThresholdUsd` → `boss.send(JOB_NAMES.CREDIT_AUTO_RECHARGE, { spaceId })` (debounced via a `singletonKey` so one in-flight per space); else keep the existing low-balance email. Auto-recharge top-up is prepaid (fires above zero), so it never violates the strict-prepaid rule.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `git commit -am "feat(billing): trigger auto-recharge on low balance"`

### Task 3.4: Webhook dispatch for auto-recharge + card-saved

**Files:** Modify `app/api/webhooks/stripe/route.ts`.

- [ ] **Step 1:** Dispatch `auto_recharge.succeeded` (`payment_intent.succeeded` with `metadata.kind='auto_recharge'`) → flip the `credit_purchases` row `pending→paid` + credit the balance idempotently (key off PI id) + reset `autoRechargeConsecutiveFailures=0`; `auto_recharge.failed` → mark row failed (mirror handler decline path); `card.saved` (`setup_intent.succeeded`) → persist `default_payment_method_id` + promote `tier_0 → tier_1` (call the card-on-file promotion) + `audit()`.
- [ ] **Step 2:** Integration test: signed `payment_intent.succeeded` fixture → balance credited once (idempotent on replay); signed `setup_intent.succeeded` → `default_payment_method_id` set + space promoted to `tier_1`.
- [ ] **Step 3: Run → PASS.**
- [ ] **Step 4: Commit.** `git commit -am "feat(payments): webhook dispatch for auto-recharge + card-saved"`

### Task 3.5: `auto-recharge-failed` email

**Files:** Create `lib/email/templates/auto-recharge-failed.tsx`.

- [ ] **Step 1:** Two variants (props `reason: "authentication_required" | "declined"`): re-auth (link back to confirm the PaymentIntent on-session) and update-card. React Email (Rule 10), follow existing template patterns.
- [ ] **Step 2:** Render smoke test.
- [ ] **Step 3: Commit.** `git commit -am "feat(email): auto-recharge-failed notifications"`

### Task 3.6: Card-save + auto-recharge settings UI

**Files:** New Sheet under `components/billing/` + wire into `components/space-billing.tsx`.

- [ ] **Step 1:** A right-side `Sheet` (Rule 12) with: "Add / update card" (Stripe Elements confirming the `saveSetupIntent` client secret) and an auto-recharge form (`react-hook-form` + `zodResolver`, Rule 19): `enabled` toggle, `threshold`, `target`, `monthlyCap` (number inputs per Rule 19; inline `<FormMessage/>`; submit disabled until valid+dirty). Server action persists the `auto_recharge_*` columns + `audit()`.
- [ ] **Step 2:** Component renders without type errors; add a unit test for the zod schema (valid/invalid threshold < target etc.).
- [ ] **Step 3: Commit.** `git commit -am "feat(ui): card-save + auto-recharge settings sheet"`

### Task 3.7: Cut the provider over to Stripe

**Files:** `lib/payments/index.ts`.

- [ ] **Step 1:** `getPaymentProvider()` returns `stripeProvider` when `STRIPE_SECRET_KEY` is set, else `polarProvider` (dual-run during migration). `pnpm typecheck`.
- [ ] **Step 2:** `pnpm test:all` → PASS.
- [ ] **Step 3: Commit.** `git commit -am "feat(payments): select stripe provider when configured"`

---

## PHASE 4 — Delete subscriptions + overage (code first; Rule 40)

### Task 4.1: Remove postpaid overage system

**Files:** delete `lib/billing/overage.ts`, `lib/billing/overage-cascade.ts`, `lib/worker/handlers/polar-meter-reconcile.ts`; edit `billing-hourly.ts` (remove bucket-2/3 logic → single prepaid debit + sleep), `app/actions/billing.ts` (`updateOverageSettings`), `lib/billing-events.ts` (drop overage event types from the debit set, Rule 54), `lib/status-display.ts` if needed, `config/platform.ts` (`POLAR_OVERAGE_EVENT_NAME`), and remove the overage threshold emails. Remove the `polar.meter-reconcile` schedule.

- [ ] **Step 1:** Delete the modules + references; update the overage tests to assert the new behavior (balance can't cover tick → cube sleeps, no overage accrual). Keep columns in the DB for now (drop in Phase 5).
- [ ] **Step 2:** `pnpm test:all` → PASS (overage tests rewritten to the prepaid-only expectation).
- [ ] **Step 3: Commit.** `git commit -am "refactor(billing): remove postpaid overage (prepaid-only)"`

### Task 4.2: Remove the Polar subscription stack

**Files:** delete `app/actions/subscriptions.ts`, `lib/billing/subscription-handler.ts`, `reconcile-subscription.ts`, `apply-plan-credit.ts`, `apply-subscription-refund.ts`, `lib/worker/handlers/subscription-reconcile.ts`, the subscription branches in the Polar webhook route, `components/billing/plan-selection-sheet.tsx` / `plan-comparison.tsx`, the Orbit subscription + credit-purchase-subscription pages; remove `subscription.reconcile` + Polar schedules from the worker; delete `lib/payments/polar/*` and `scripts/setup-polar.ts` once `getPaymentProvider` no longer references Polar.

- [ ] **Step 1:** Delete + grep for residual references (`subscription`, `polar`, `overage`) until `pnpm typecheck` + `pnpm lint` are green. Update `JOB_NAMES`/`QUEUE_OPTIONS` (Rule 56), `lib/status-display.ts` (drop subscription status), `lib/billing-events.ts`.
- [ ] **Step 2:** `pnpm test:all` → PASS.
- [ ] **Step 3:** Update docs (Rule 22): `docs/architecture/billing-plans.md`, CLAUDE.md billing summary, the Architecture map.
- [ ] **Step 4: Commit.** `git commit -am "refactor(billing): remove Polar subscription stack"`

---

## PHASE 5 — Existing-customer migration + cutover (operator-run, Rule 60)

### Task 5.1: Live tier remap + lifetime-spend backfill script

**Files:** Create `scripts/migrate-spaces-to-tiers.ts`.

- [ ] **Step 1:** Idempotent, batched (Rule 40): for each space, map legacy `plan_id` → new tier (`plan_trial→tier_0`, `plan_starter→tier_1`, `plan_pro→tier_2`, `plan_business→tier_3`; custom stays). Backfill `lifetime_credit_spent_usd` from summed historical debit `billing_events` (so a heavy spender lands on their earned tier, never lower than pre-migration capability). `WHERE lifetime_credit_spent_usd = 0` guard for re-run safety.
- [ ] **Step 2:** Integration test against seeded legacy rows asserting the mapping + backfill + that no space is demoted below its old caps.
- [ ] **Step 3: Run → PASS.** `pnpm test:integration -- migrate-spaces`.
- [ ] **Step 4: Commit.** `git commit -am "feat(migration): map legacy plans to Tier 0-4 + backfill lifetime spend"`
- [ ] **Step 5 (operator, Rule 60):** prepare the command for the operator to run against prod; agent does not run it.

### Task 5.2: Cancel Polar subscriptions + card re-entry campaign

- [ ] **Step 1:** Prepare an operator runbook (in the PR / `docs/commands.md`): cancel active Polar subscriptions at period end; send each active customer the Stripe SetupIntent "add your card so your cubes never pause" email (the SetupIntent doubles as auto-recharge consent). 30–60 day window. Dual-run (Polar webhooks still processed for in-flight) until each space has `stripe_customer_id` + a saved card.
- [ ] **Step 2:** Implement the campaign email (React Email) + an Orbit view of per-space migration status (`stripe_customer_id` present? card saved?).
- [ ] **Step 3: Commit.** `git commit -am "feat(migration): card re-entry campaign + status view"`

### Task 5.3: Decommission Polar + drop deprecated columns

**Files:** schema edits → `pnpm db:generate`.

- [ ] **Step 1 (after dual-run stabilizes):** remove the now-dead `polar_*` / `overage_*` / `subscription_*` columns and the `subscription_intents` / `subscription_credit_grants` tables from the Drizzle schema; `pnpm db:generate` (Rule 6). These are `DROP`s — only safe now because no deployed code references them (Rule 40). Keep `credit_purchases` provider-neutral columns.
- [ ] **Step 2:** `pnpm test:migrations` + `pnpm test:all` → PASS.
- [ ] **Step 3: Commit.** `git commit -am "chore(db): drop deprecated polar/overage/subscription objects"`
- [ ] **Step 4 (operator, Rule 60):** operator runs `db:migrate` in the deploy after the code that stopped referencing these objects is live.

---

## Self-Review

**1. Spec coverage:** Tier 0–4 ladder (Task 1.3) ✓; price-0/system-only tiers (1.3) ✓; prepaid-only + no overage (4.1, 1.4) ✓; auto-recharge prepaid threshold→target + monthly cap + decline handling (1.2, 3.2–3.5) ✓; usage promotion by lifetime spend + one-way + Tier 0→1 on card (1.1, 1.5, 3.4) ✓; admin override excluded from promotion (1.1, 1.5) ✓; Stripe prepaid subset + webhook + setup (2.x) ✓; additive schema (0.3) ✓; deletions phased (4.x, 5.3) ✓; existing-customer migration (5.x) ✓; tests at every step (Rule 59) ✓; operator-run prod steps (0.3, 2.6, 5.x) ✓.

**2. Placeholder scan:** No TBD/TODO; pure-logic tasks have full code + tests; UI/boilerplate tasks reference concrete existing patterns with exact files (allowed for an existing codebase). Stripe SDK exact shapes are gated on Task 0.1 re-verification by design (third-party rule), not left vague.

**3. Type consistency:** `nextTierForSpend(currentSlug, lifetimeSpentUsd)`, `computeRechargeAmountCents({balanceUsd,targetUsd,monthlyRemainingUsd})`, `chargeOffSession({spaceId,amountCents,idempotencyKey})`, `saveSetupIntent({spaceId,contact})`, slugs `tier_0..tier_4`, columns `auto_recharge_*` / `lifetime_credit_spent_usd` — used consistently across tasks.

**Gap noted for the executor:** Stripe Elements client wiring (Task 3.6) depends on the pinned SDK + `@stripe/stripe-js`; add that dependency in Task 3.6 step 1 and follow the installed version's current Elements API.
