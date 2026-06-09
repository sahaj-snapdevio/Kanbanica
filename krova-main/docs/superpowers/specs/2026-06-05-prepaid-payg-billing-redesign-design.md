# Prepaid Pay-As-You-Go Billing Redesign — Design Spec

> **Status:** Draft for review (2026-06-05). Supersedes the subscription/plans + postpaid-overage model. Companion research: [docs/audits/2026-06-05-polar-to-stripe-evaluation.md](../../audits/2026-06-05-polar-to-stripe-evaluation.md).
>
> **Production safety:** Krova is live (30+ customer cubes, real balances). Every schema change is additive (Rule 40); all prod migration/cutover steps are **operator-run** (Rule 60). The agent prepares; the operator executes.

## Goal

Replace the subscription-plan + postpaid-overage billing model with a **100% prepaid, pay-as-you-go** model: customers add a card, hold prepaid credit, and credit is consumed hourly for usage. **Tiers govern limits only (never price)** and a space climbs a quota ladder automatically as its **cumulative lifetime credit spend** grows, with **Orbit admin override** for bespoke cases. No monthly base fee, no subscriptions, no postpaid/overage.

## Core principles

1. **One price dimension: prepaid credit consumed per hour.** No base/subscription fee on any tier.
2. **Strict prepaid.** `credit_balance > 0` → cubes run; `credit_balance` reaches 0 → cubes sleep. Customers never consume credit they have not already paid for.
3. **Auto-recharge is prepaid, not postpaid.** It tops up *above* zero (threshold → target) by charging the saved card and adding credit *before* it is consumed. If it fails, the cube sleeps — it never runs on owed money.
4. **Tiers = quota profiles, system-only.** A space's tier sets its caps; tiers are unlocked by usage (lifetime spend) and/or admin override, not purchased. The tier system is **pure Krova logic, fully decoupled from the payment provider** — tier limits are edited in Orbit, a tier change never calls Stripe (or any gateway), and the ladder would work identically with no payment provider at all. Tiers are about *limits*; the provider is only about *moving money into credit*.
5. **No free-for-all.** A new space gets a tiny restricted Free allotment; everything beyond requires a card; new card = lowest paid tier = small caps + a monthly auto-recharge ceiling, so blast radius is bounded.
6. **Maximize reuse, delete the fragile parts.** Keep the existing `plans` catalog, per-space overrides, `effectiveLimits()`, the credit engine, plan-limit guards, and zero-balance auto-sleep. Delete the entire Polar subscription stack and the entire postpaid overage system.

---

## 1. The tier catalog (`plans` table, repurposed as a quota ladder)

The `plans` table is kept; rows are re-seeded as a **5-rung numbered ladder (Tier 0–Tier 4)**. Every tier has `price_usd = 0` and `included_credit_usd = 0` (except Tier 0's one-time starter grant — see §2). Limits below are grounded in the current seed ([migration 0037](../../../db/migrations/0037_lonely_thanos.sql)) and are **operator-tunable in Orbit** (you change the numbers per tier any time, with no Stripe involvement); the numbers here are the migration defaults.

| Tier (slug) | Unlock condition | max cubes | max vCPU | max RAM | max disk | seats | backups | domains | card? |
|---|---|---|---|---|---|---|---|---|---|
| **Tier 0** (`tier_0`, default) | automatic on signup | 1 | 2 | 4096 | 20 | 1 | 0 | 0 | no |
| **Tier 1** (`tier_1`) | valid card on file | 2 | 4 | 8192 | 40 | 3 | 3 | 1 | yes |
| **Tier 2** (`tier_2`) | lifetime spend ≥ **$50** | 6 | 8 | 16384 | 100 | 10 | 15 | 5 | yes |
| **Tier 3** (`tier_3`) | lifetime spend ≥ **$250** | 15 | 16 | 32768 | 100 | 25 | 50 | 25 | yes |
| **Tier 4** (`tier_4`) | lifetime spend ≥ **$1,000** | **unlimited** | 16 | 32768 | 100 | unlimited | unlimited | unlimited | yes |

- **Tier 0** is the free/trial tier (replaces `Trial`): $5 starter credit, 1 restricted cube, no card. **Tier 1** is the card-on-file entry tier (Starter shape). **Tier 2/3** reuse the Pro/Business limit shapes. **Tier 4** is the top tier with **unlimited cube creation** (`max_concurrent_cubes = NULL`); per-cube hardware caps still apply (bounded by `config/platform.ts` ranges).
- **The abuse gate still holds:** unlimited (Tier 4) is reached only after **$1,000 lifetime spend** — i.e. a heavily-proven paying customer, never a fresh signup. New spaces sit at Tier 0 (1 cube) and a new card only reaches Tier 1 (2 cubes).
- `max_concurrent_cubes = NULL` means "unlimited" in `effectiveLimits()` (already how the current Business plan encodes it); `seats`/`backups`/`domains = NULL` likewise.
- `is_default_for_new_spaces = true` on **Tier 0** (one row, existing partial unique index enforces it).
- `allow_overage` is removed entirely (see §6). `allow_topup = true` on Tiers 1–4; **`allow_topup = false` on Tier 0** — a Tier 0 space has no card, so the *act of adding a card to put money in* is exactly what promotes it to Tier 1 (there is no card-less top-up). Tier 0 is purely the one-time $5 grant until a card is added.
- **Admin override (not a tier):** beyond the ladder, an operator can raise any individual space's caps via the existing per-space `override_*` columns (and/or a `visibility='custom'` plan). Overridden/custom-pinned spaces are **excluded from auto-promotion** (their `plan_id` is never auto-changed).

---

## 2. Prepaid billing rules

- **Tier 0 grant:** a new Tier 0 space receives a one-time **$5** credit grant (existing `default credit grant` mechanism; idempotent per space). No other tier grants credit.
- **Hourly consumption** is unchanged: `billing-hourly` charges running compute + sleep-storage from `credit_balance` (existing `DISK_RATE` / compute rates in `config/platform.ts`, Rules 38/53/55). The only change is that the **overage cascade buckets 2 & 3 are removed** — there is only bucket 1 (debit prepaid balance) and, when it can't cover the tick, the cube sleeps.
- **Provisioning / wake guard (prepaid enforcement):** a cube may be created or woken only if `credit_balance ≥ projected first-hour cost` of that cube (so a cube never starts and immediately sleeps). Enforced in the existing plan-limit guard path (`lib/plan/`), acquired under the per-space advisory lock alongside the cube-count check.
- **Zero-balance behavior:** unchanged — when a running cube's tick can't be covered, it auto-sleeps (data preserved). This is the prepaid backstop.

### Auto-recharge (prepaid top-up)

Per-space settings (all on the `spaces` row):
- `auto_recharge_enabled` (bool)
- `auto_recharge_threshold_usd` (when `credit_balance <` this → recharge; default $20, floored by `low_balance_threshold_min_usd`)
- `auto_recharge_target_usd` (refill so post-charge balance ≈ this; default $50, bounded by `credit_topup_min/max`)
- `auto_recharge_monthly_cap_usd` (hard ceiling on total auto-recharge $ per rolling 30 days; spend-protection)
- `default_payment_method_id` (the saved Stripe `pm_…`)

Flow (worker only, Rule 1): the existing low-balance check in [billing-hourly.ts:639](../../../lib/worker/handlers/billing-hourly.ts#L639) is extended — if `auto_recharge_enabled && balance < threshold && monthly auto-recharge spent < cap`, enqueue a `credit.auto-recharge` pg-boss job. That handler creates an **off-session** Stripe PaymentIntent (`off_session: true, confirm: true, amount = target − balance`) with a per-attempt idempotency key (Rule 7), under the per-space lock. On `payment_intent.succeeded` (webhook, authoritative + idempotent), credit the balance and write a `credit_purchase` + `billing_events` ledger row.

Decline handling: `authentication_required` → EmailIt the customer to return on-session and confirm the same PaymentIntent; hard decline (`card_declined`/`insufficient_funds`/`expired_card`) → notify + **disable auto-recharge after N consecutive failures** (default 3) to stop hammering a dead card. Every branch writes an `audit()` row (Rule 9; mirror Rule 51's billing-fail audit). If recharge never succeeds and the balance hits 0, the cube sleeps (strict prepaid).

> India note (Rule context): off-session auto-recharge is clean on **international cards** (your global customers). India-issued cards would need RBI e-mandate (₹15k/debit cap, 24h pre-debit notice) — out of scope; steer Indian-card customers to manual top-up.

---

## 3. Usage-based tier promotion

- Track **`spaces.lifetime_credit_spent_usd`** — incremented inside the `billing-hourly` charge transaction (and the prorated-charge path) whenever credit is consumed, in the same tx that debits `credit_balance` (so it can never drift).
- After incrementing, a pure function `nextTierForSpend(currentTierSlug, lifetimeSpentUsd)` (in `lib/plan/promotion.ts`) returns the tier the space *should* be on. If it's higher than the current tier, set `spaces.plan_id` to it and `invalidatePlanCache`. **One-way only — never auto-demote** (a customer never loses limits from spending). Idempotent (compares tier ladder index; re-running is a no-op).
- **Tier 0 → Tier 1 is the exception:** it's triggered by **card-on-file**, not spend (a new card with $0 spend gets Tier 1 immediately). Implemented in the SetupIntent-success path, not the spend check.
- **Spend thresholds:** Tier 1 → Tier 2 at **$50**, Tier 2 → Tier 3 at **$250**, Tier 3 → Tier 4 at **$1,000** (cumulative lifetime spend). These live in `config/platform.ts` (Rule 30), tunable without a logic change.
- **Custom / overridden spaces are skipped** by the promotion check.
- On promotion: write lifecycle + audit rows and send a "limits unlocked" email (React Email, Rule 10).

---

## 4. Payment provider — Stripe direct (US LLC)

Per the evaluation doc, the provider is **direct Stripe** (US LLC + Stripe US; payout via Mercury → Infinity/Wise → INR). Because subscriptions and metered overage are deleted, the Stripe integration is **the small subset**:

- `createTopupCheckout` — one-time Checkout Session (`mode: payment`, inline `price_data` with `unit_amount = totalCents`), with `setup_future_usage: off_session` so the **first manual top-up also saves the card** (no separate SetupIntent needed for those users).
- `saveSetupIntent` — standalone SetupIntent (`usage: off_session`) for "add a card without paying" (e.g. enabling auto-recharge or migrating an existing customer).
- `chargeOffSession(spaceId, amountCents, idempotencyKey)` — the auto-recharge PaymentIntent (`off_session, confirm`).
- `refundTopup` — `charge.refunded` / refund flow (clawback mirrors existing top-up refund).
- `verifyWebhook` — Stripe signature (`stripe.webhooks.constructEvent`) → normalized events: `checkout.session.completed` (→ topup.paid + card saved), `payment_intent.succeeded`/`payment_intent.payment_failed` (auto-recharge), `charge.refunded` (refund), `setup_intent.succeeded` (card saved), `customer.deleted`.
- **Not implemented (deleted):** subscription products/prices/proration/change/cancel/resume, customer-portal plan management, meter events. The `PaymentProvider` interface is trimmed to the prepaid subset.

`getPaymentProvider()` selects Stripe. Stripe SDK version is **pinned and its API shapes re-verified as task 1** (third-party rule). `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` added to `lib/env.ts` (Rule 5). New route `app/api/webhooks/stripe/route.ts` (raw body). `scripts/setup-stripe.ts` registers the webhook endpoint + the top-up product/price.

---

## 5. Data model changes (additive — Rule 40)

**New columns on `spaces`** (all nullable / defaulted; keep `polar_*` for dual-run/rollback):
- `stripe_customer_id text`
- `default_payment_method_id text`
- `auto_recharge_enabled boolean default false`
- `auto_recharge_threshold_usd numeric(12,4)`
- `auto_recharge_target_usd numeric(12,4)`
- `auto_recharge_monthly_cap_usd numeric(12,4)`
- `auto_recharge_consecutive_failures integer default 0`
- `lifetime_credit_spent_usd numeric(14,4) default '0' not null`

**`credit_purchases`:** add `stripe_payment_intent_id text` (alongside the provider-neutral columns it already has). Add a `source` discriminator (`manual` | `auto_recharge`) for reporting.

**`plans`:** no new columns. Re-seed rows (new migration, idempotent `INSERT … ON CONFLICT (slug) DO NOTHING` + an Orbit-safe data update for the rename Trial→Free). `polar_product_id` becomes unused (kept until the drop phase).

**`platform_settings`:** `auto_recharge_*` defaults already covered by config; mark `overage_*` and `polar_*` columns deprecated (dropped in the cleanup phase).

Generated via `pnpm db:generate` (Rule 6); the agent generates, the **operator applies** `db:migrate` (Rule 60).

---

## 6. What gets deleted (phased, Rule 40: remove code refs → deploy → drop objects)

**Polar subscription stack:** `app/actions/subscriptions.ts`, `lib/billing/subscription-handler.ts`, `reconcile-subscription.ts`, `apply-plan-credit.ts`, `apply-subscription-refund.ts`, the `subscription.reconcile` cron, `subscription_intents` + `subscription_credit_grants` tables, the subscription columns on `spaces`, the Polar webhook subscription branches, `components/billing/plan-selection-sheet.tsx` / `plan-comparison.tsx` subscription UI, the Orbit subscriptions pages.

**Postpaid overage system:** `lib/billing/overage.ts`, `overage-cascade.ts`, `lib/worker/handlers/polar-meter-reconcile.ts`, the `overage_*` columns on `spaces`, `overage_cap_*` on `platform_settings`, `polar_meter_reported_at` on `billing_events`, the overage threshold emails, `POLAR_OVERAGE_EVENT_NAME`, and the bucket-2/3 logic in `billing-hourly.ts`.

Tables/columns are **dropped in a later migration after the referencing code is gone and deployed** (Rule 40). Status-display enums, `JOB_NAMES`/`QUEUE_OPTIONS` (Rule 56), and `lib/billing-events.ts` debit classifications are updated in lockstep so typecheck stays green (Rules 44/54/56).

---

## 7. Existing-customer migration (the live spaces)

For each existing space (operator-run, batched, idempotent):
1. **Map plan → tier** so no one loses capability: Trial→Tier 0; Starter→Tier 1; Pro→Tier 2; Business→Tier 3; any custom stays a per-space override. Seed `lifetime_credit_spent_usd` from historical `billing_events` debits so spend-based tiers are already correct (a customer who has already spent ≥ a threshold lands on the matching tier — never lower than their pre-migration capability).
2. **Preserve `credit_balance` as-is** (prepaid balance carries over unchanged).
3. **Cancel active Polar subscriptions** at period end (stop recurring charges + included-credit grants). Communicate the change: no more monthly fee; pay only for usage via prepaid credit + auto-recharge.
4. **Card re-entry:** cards cannot transfer off Polar (it's the MoR; no export). Email each active customer a Stripe **SetupIntent** link — which *is* the auto-recharge consent. Frame: "add your card so your cubes never pause." 30–60 day window.
5. **Dual-run** until migrated: Polar webhooks still processed for in-flight items; new top-ups/cards route to Stripe.
6. **Decommission Polar** after stabilization (archive, then drop deprecated columns/tables).

---

## 8. Component / file map

- **Schema:** `db/schema/spaces.ts`, `credit-purchases.ts`, `plans.ts`, `platform-settings.ts`; new migration via `db:generate`.
- **Provider:** `lib/payments/stripe/{client,provider}.ts`, trimmed `lib/payments/types.ts`, `lib/payments/index.ts`; `app/api/webhooks/stripe/route.ts`; `scripts/setup-stripe.ts`.
- **Prepaid + promotion:** `lib/plan/promotion.ts` (pure `nextTierForSpend`), guards in `lib/plan/limits.ts` (+ provisioning affordability check), `lib/worker/handlers/billing-hourly.ts` (lifetime-spend increment + promotion call + auto-recharge trigger; overage removal), new `lib/worker/handlers/credit-auto-recharge.ts`.
- **Auto-recharge settings + card UI:** customer billing page (`components/space-billing.tsx`), a "payment method + auto-recharge" Sheet (Rule 12, react-hook-form Rule 19).
- **Orbit:** plans/tier editor (exists), per-space override editor (exists), remove subscription pages.
- **Config:** `config/platform.ts` (tier thresholds, auto-recharge defaults); `lib/env.ts` (`STRIPE_*`).
- **Deletions:** per §6.

## 9. Error handling & edge cases

- Auto-recharge decline → see §2 (re-auth email / disable after N).
- Balance race: hourly debit + auto-recharge run under the per-space advisory lock; idempotency keys on every charge (Rule 7).
- Promotion idempotency: ladder-index compare; one-way; skip custom/overridden.
- Webhook authority: credit only on `payment_intent.succeeded` / `checkout.session.completed`, idempotent on the PI/session id (never the sync response).
- Monthly auto-recharge cap exhausted → stop auto-recharging, low-balance email, cube sleeps at $0.
- Provisioning with insufficient balance → blocked at the guard with a clear "add credit" error.

## 10. Testing strategy (Rule 59)

- **Unit (`pnpm test`):** `nextTierForSpend` (every threshold boundary, one-way, custom-skip), auto-recharge amount math (target − balance, cap clamp), prepaid affordability guard, webhook→normalized-event mapping, decline classification, the trimmed gross-up.
- **Integration (`pnpm test:integration`):** lifetime-spend increment + promotion under the per-space lock (real rows), auto-recharge idempotency (redelivered PI = no double-credit), zero-balance auto-sleep, provisioning guard against a seeded balance, migration mapping (plan→tier, lifetime backfill).
- Third-party (Stripe) calls are stubbed; only the DB is real. `pnpm test:all` is the gate.

## 11. Tuning knobs (config, decide/adjust anytime)

Tier 0 starter grant ($5), Tier 0 caps (1 cube / 2 / 4GB / 20GB), every tier's limits (editable per-tier in Orbit), promotion thresholds (Tier 2 $50, Tier 3 $250, Tier 4 $1,000), Tier 4 = unlimited cubes, auto-recharge defaults (threshold $20 / target $50 / monthly cap), failure-disable count (3). All in `config/platform.ts` or Orbit — none touch Stripe.

## 12. Out of scope / future

- Volume discounts (cheaper per-hour at higher tiers) — deliberately omitted; tiers are limits-only for now.
- Optional prepaid commitment/discount bundles.
- Auto-demotion / inactivity downgrades.
- Non-card payment methods; Indian-card e-mandate auto-recharge.

## 13. Rollout phases (detailed plan follows via writing-plans)

0. Stripe SDK pin + verify; `STRIPE_*` env; additive schema.
1. StripeProvider (prepaid subset) + webhook route + setup script.
2. Prepaid enforcement + tier re-seed + promotion + remove overage.
3. Auto-recharge (card-save UI + off-session worker + decline handling).
4. Delete subscription stack (code) + Orbit/UI updates; dual-run.
5. Existing-customer migration (operator-run) → cutover → drop deprecated objects.
