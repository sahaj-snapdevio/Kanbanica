# Polar → Stripe Payment-Provider Evaluation (2026-06-05)

> Decision memo. All fees/capabilities verified against **first-party 2026 docs** (Stripe, Polar, RBI, IRS, Wise, Infinity) via a 5-workflow adversarial research pass (40 agents). No live infrastructure or production DB was touched (Rule 60).

## Founder context

Solo **India-based** founder. SaaS (Krova) priced in **USD**, **global** customers (mostly international cards), **mixed** ticket sizes (small prepaid top-ups + monthly subscriptions). Currently on **Polar** (Merchant of Record); observed **~10.5% all-in**. Goals: **minimum total cost**, plus a new **threshold-based auto-recharge** of the prepaid credit balance. Has formed a company + registered for Stripe.

---

## 1. Why the 10.5% on Polar is real (not a misconfig)

Polar org is **"Early Member"** (created before 2026-05-27) → **4% + 40¢** all-in MoR rate. Decomposed for this profile:

- Charge-side: base **4%** + subscription **+0.5%** + international-card **+1.5%** = **6.0% + a fixed $0.40**.
- Payout leg (Polar → INR via Stripe Connect): **~1.5–2%** cross-border + FX (India-specific 0.75% + 1% FX).
- The **fixed $0.40** dominates small tickets: it alone is 4% of a $10 charge, 2% of a $20 charge.

| Charge | Polar charge-side | + payout FX | **All-in** |
|---|---|---|---|
| $10 sub (intl) | $1.00 (10.0%) | ~$0.18 | **~11.8%** |
| $20 sub (intl) | $1.60 (8.0%) | ~$0.37 | **~9.8%** |
| $50 top-up | ~$3.15 (6.3%) | ~$0.9 | **~8.1%** |
| $100 sub | ~$7.7 (7.7%) | ~$1.8 | **~9.5%** |

Blended over small/mixed tickets → **~10.5%. Expected, not a bug.** The single biggest *reducible* lever without migrating: **bigger top-ups** (amortize the fixed fee) and/or a **paid Polar tier** (Pro $20/mo → 3.8%+40¢; breakeven ~$1,379/mo volume).

**What the 10.5% buys:** Polar is the **Merchant of Record** — it registers, collects, files, and **remits global VAT/GST/sales tax** for you, and carries the liability. For a global SaaS run by one person, self-running that compliance is the single most expensive thing to take on (see §3).

---

## 2. Cost comparison — all-in, USD card → INR, this profile

| Route | Effective all-in | Fixed fee | MoR / global tax | Auto-recharge | Notes |
|---|---|---|---|---|---|
| **Polar (current, Early Member)** | ~8–11.8% (10.5% blended) | $0.40 | ✅ handled for you | ❌ impossible | MoR. Reducible via paid tier / bigger top-ups |
| **Polar Pro ($20/mo)** | ~6–9% | $0.40 | ✅ | ❌ | +$20/mo; better at volume |
| **Stripe India** | **6.3%** (top-ups ≤~$23, GST-exempt) → **7.43%** (one-off >₹2k) → **8.26%** (subs) | **none (₹0)** | ❌ you become MoR | ✅ (intl cards) | INR-only settlement, **invite-only**, RBI paperwork, Stripe Tax **N/A in India** |
| **US LLC + Stripe US → Mercury → Wise/Infinity → INR** | **~5%** (US card) → **~6.5%** (intl) | $0.30 | ❌ you become MoR | ✅ cleanest | + **$900–1,800/yr compliance** (Form 5472/1120, registered agent, FEMA/ODI APR). Breakeven vs Polar ~$2–3.8k/mo |
| **Stripe Managed Payments (SMP)** | ~6.4% all-in | $0.30 | ✅ (80+ countries) | ❌ Checkout-only | **ELIMINATED**: India is not an eligible *seller* country; pricier than Polar; no off-session charging |

### Stripe India detail (verified `stripe.com/in/pricing`)
- USD-presented intl card: **4.3% + 2% currency conversion = 6.3%** base; **+18% GST on the fee** (waived per single charge ≤ ₹2,000 ≈ $23); **+0.7% Stripe Billing** on subscriptions.
- **Settles INR only** — cannot hold USD → **Infinity is irrelevant on this path** (Stripe converts to INR itself).
- Invite-only (apply via sales). Mandatory RBI **purpose code** (e.g. P0807). FIRA substitute = **Standard Chartered "Payment Advice"** emailed per payout. GST registration + monthly filing (export of services zero-rated under LUT). 2% TDS credit if TAN supplied.

### US LLC route detail (verified IRS / Wise / FEMA)
- Stripe US: 2.9% + 30¢ (+1.5% intl, +1% conversion for non-USD). Pays out **USD via ACH to a verified US business bank** (Mercury/Brex/Relay) — **not** to Infinity (see §4).
- Then USD→INR via **Wise (~0.57%)** or **Infinity (0.5% + free FIRA)**.
- Compliance: **Form 5472 + pro-forma 1120 mandatory** ($25k penalty if missed, mail-only, CPA ~$300–800/yr); registered agent ~$50–300/yr; state fee (WY $60 / NM $0 / DE $300). **India FEMA/ODI**: UIN before first remittance + annual APR (CA ~₹15–40k/yr). India taxes worldwide income.

---

## 3. The unavoidable trade-off (the core finding)

**Auto-recharge requires a direct (non-MoR) Stripe integration — and going direct means you take on global sales-tax/VAT compliance.** These are linked:

- **No Merchant of Record can do off-session auto-recharge.** Verified against Polar's full API: Polar has no `payments`/`charges`/`payment_intents` resource; charges happen only via interactive checkout (customer present) or Polar-scheduled subscription renewals. It "cannot set arbitrary one-time charges." Same structural limit applies to Paddle/Lemon Squeezy/SMP. **This is why it's "not possible with Polar" — it's structural, not a missing endpoint.**
- **Stripe (direct) does it natively**: `SetupIntent {usage: off_session}` to save the card with consent → later `PaymentIntent {off_session: true, confirm: true, amount}` for an arbitrary amount. The AWS/OpenAI/Twilio pattern.
- **Therefore:** want auto-recharge ⟹ direct Stripe ⟹ **you become Merchant of Record** ⟹ you owe global VAT/GST/sales-tax registration + remittance (Polar did this for you). Realistic self-MoR compliance for a small global SaaS: **$600–8,000/yr** in tax software (Quaderno/Anrok/Sphere — Stripe Tax is **not available in India**) + per-jurisdiction registration + accountant time. EU has a **zero** VAT threshold for non-EU B2C digital sellers.

**Pure-minimum-total-cost (ignoring the feature)** for a solo India founder = **stay on a MoR** (cheapest = Polar paid tier). **But the auto-recharge requirement overrides that** — it forces direct Stripe.

### Silver lining: the feature *is* the cost fix
Your 10.5% is dominated by the **fixed per-transaction fee on small top-ups**. Auto-recharging to **$50** instead of manual $10 top-ups amortizes that fixed fee (40¢ on $50 = 0.8% vs 4% on $10). So the feature you want is *also* your biggest cost lever — and it only exists on direct Stripe.

---

## 4. Infinity (infinityapp.in) — corrects a key assumption

**Infinity is NOT a Stripe payout target.** The assumed chain `Stripe → Infinity → INR` does **not** work:

- It's an **inward-collection rail** (YC W24, ~15 people, $1.9M pre-seed): you get a **virtual account** to share with **clients/marketplaces** who *push* money to you; Infinity converts at **0.5% flat, 0% FX markup, free FIRA**, ~1-day INR settlement. It markets itself as a **Stripe *alternative***, not an add-on.
- **Stripe India** pays INR-only to an Indian bank → nothing for Infinity to receive.
- **Stripe US** pays USD via ACH to a **verified US business bank**; Infinity's virtual collection account will likely **fail Stripe's payout-bank verification** ("non-standard account" — exactly the trap to avoid). No source documents a successful Stripe→Infinity payout.

**Where Infinity genuinely fits:**
1. As the **USD→INR conversion leg** *after* a real US bank: `Stripe US → Mercury → Infinity (0.5% + free FIRA) → INR`. Competitive with Wise, and the free FIRA is cleaner for GST export than the US-LLC repatriation path.
2. As a **card-checkout replacement** for **B2B customers who can pay by bank transfer/invoice** (0.5% all-in beats any card rate) — but no card convenience, higher friction for self-serve SaaS, and **no auto-recharge** (it's not a card processor).

---

## 5. Auto-recharge feature design (on Krova's existing system)

**What exists today:** per-space `lowBalanceThreshold` ([db/schema/spaces.ts](../../db/schema/spaces.ts)) + a low-balance **email** in [lib/worker/handlers/billing-hourly.ts:639](../../lib/worker/handlers/billing-hourly.ts#L639). **No saved payment method / off-session code** (Polar can't provide it).

**What to add (direct Stripe):**
- **Schema (additive, Rule 40):** `spaces.stripe_customer_id`, `spaces.default_payment_method_id`, `spaces.auto_recharge_enabled`, `spaces.auto_recharge_threshold_usd`, `spaces.auto_recharge_target_usd` (or `_amount_usd`), `spaces.auto_recharge_consecutive_failures`.
- **Save the card:** at first manual top-up (or a portal "enable auto-reload" action), confirm a `SetupIntent {usage: off_session}`; persist `customer` + `payment_method` ids. This **doubles as** the off-session consent.
- **Provider interface:** add `saveSetupIntent()` + `chargeOffSession(spaceId, amountCents, idempotencyKey)` to [lib/payments/types.ts](../../lib/payments/types.ts) (these don't exist today).
- **Trigger:** extend the existing low-balance branch in `billing-hourly.ts` — when `auto_recharge_enabled && balance < threshold`, enqueue a pg-boss `credit.auto-recharge` job (Rule 1: worker, not route). Handler creates `PaymentIntent {off_session, confirm, amount = target − balance}` with a per-attempt **idempotency key** (Rule 7); credits the space on `payment_intent.succeeded` **webhook** (idempotent, key off PI id), not the sync response.
- **Decline handling:** `authentication_required` → EmailIt the customer a link to re-confirm on-session (then future charges are exempt); hard decline → email + **disable auto-reload after N consecutive failures**; write `audit()` rows on every branch (Rule 9; mirror the Rule 51 billing-fail audit pattern).
- **India note:** international cards = no RBI e-mandate (clean). India-issued cards would need an e-mandate (₹15k/debit cap, 24h pre-debit notice) — treat as a separate path or steer to manual top-up.

---

## 6. Migration effort (from the codebase audit)

Architecture is **good** — a provider-agnostic `PaymentProvider` interface ([lib/payments/index.ts](../../lib/payments/index.ts)) — but it is **not a one-file swap**:

- **Abstraction leaks to fix:** [billing-topup-reconcile.ts](../../lib/worker/handlers/billing-topup-reconcile.ts) imports the Polar SDK directly (missing a checkout-status method); webhook route uses Polar's error type.
- **Interface broadening:** Stripe **prices are immutable** (price edit = create-new + archive; plans must store a price id); `changeSubscription` operates on subscription *items* (read-then-update); webhook event re-mapping; meter semantics (dollar-as-quantity, epoch-seconds, 35-day cap); no `customer.state_changed` heartbeat; **+ the new off-session methods for auto-recharge**.
- **New surface:** `/api/webhooks/stripe` + signature verify, `lib/payments/stripe/{client,provider}.ts`, `scripts/setup-stripe.ts`, `STRIPE_*` env (Rule 5), additive `stripe_*` columns (Rule 40 — keep `polar_*` for dual-run).
- **Rule 42 reframe:** Stripe has no metadata filter on list → persist a hard `spaceId ↔ stripe id` mapping.
- **Tests:** parallel provider + webhook-normalization suite (Rule 59).
- **Estimate:** ~**4–6 weeks** for one engineer with full coverage, bulk in provider + webhook normalizer (+ ~1 week for the auto-recharge feature on top).

---

## 7. Customer-move plan (helping current customers onto Stripe)

**Cards cannot transfer off Polar.** Polar is the MoR and owns the cardholder data in its PCI environment; it exposes **no payment-method export**, and you're not the owning Stripe account — so a PCI processor-to-processor import is off the table. **Every active customer must re-enter their card.**

**Silver lining:** the re-entry uses a Stripe **SetupIntent**, which *is* the off-session consent capture — so the migration step and the auto-recharge enablement are the **same action**. Frame it to customers as "set up auto top-up so your cubes never pause."

**Runbook:** dual-run window (both providers; new signups on Stripe) → per-space migration email with a re-card link + deadline (~30–60 days) → recreate the Stripe subscription anchored to the Polar renewal date (`billing_cycle_anchor` + `proration_behavior=none`), cancel Polar before its next charge → archive Polar at ~T+90. Put **"will Polar export PANs for my account?"** to Polar support in writing first, but plan for "no."

---

## 8. Recommendation

1. **Auto-recharge is a hard requirement → go direct Stripe.** No MoR can do it. Accept that you become MoR for global tax (use a calculate-and-register-where-forced approach early; budget a tax tool + CA).
2. **Which Stripe entity:**
   - **If your company is Indian → Stripe India** is the pragmatic minimum-cost path: ~6.3% on small top-ups already beats 10.5%, no US-LLC/FEMA overhead, auto-recharge works on global cards, INR direct (no Infinity needed). Caveats: invite-only, RBI paperwork, Stripe Tax unavailable.
   - **If you have / want a US LLC → Stripe US + Mercury + Infinity(0.5%+free FIRA) or Wise** is lowest-rate at scale, cleanest auto-recharge, USD float, Stripe Tax available — worth it above **~$2–3k/mo**; below that the compliance overhead eats the savings.
3. **Regardless of provider, ship auto-recharge with a $50-ish target** — it's your biggest fee lever (kills the fixed-fee drag on small top-ups).
4. **Infinity** = use as the USD→INR leg *after* Mercury (US-LLC route) or for B2B bank-transfer customers — **not** as a Stripe payout bank.

## Sources
Polar fees/payouts/API, Stripe pricing (US + India) / Billing / Tax / Managed Payments / SetupIntent+PaymentIntent / payouts / data-migrations, IRS Form 5472, RBI e-mandate framework (2026), Wise pricing, Infinity (infinityapp.in) + independent reviews. Full URLs in the workflow transcripts.
