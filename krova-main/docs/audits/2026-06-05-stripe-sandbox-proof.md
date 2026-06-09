# Stripe Sandbox Proof — Prepaid + Off-Session Auto-Recharge (2026-06-05)

> Pre-build de-risking. Proves, against the **real Stripe test API** on the project's own sandbox account, every Stripe mechanic the [prepaid pay-as-you-go redesign](../superpowers/specs/2026-06-05-prepaid-payg-billing-redesign-design.md) depends on — **before** writing the full integration. Satisfies the third-party rule (verify against the *installed* SDK, not memory) and the "solid proof" gate.

## Result: 9/9 PASS

```
PASS  1 connectivity — livemode=false
PASS  2 setupintent off_session — status=succeeded
PASS  3 off-session charge (auto-recharge) — status=succeeded amount=4500
PASS  4 idempotency — same id reused on same idempotency key
PASS  5 off-session SCA surfaces — code=authentication_required (carries PaymentIntent for re-auth)
PASS  6 off-session hard decline surfaces — code=card_declined decline_code=generic_decline
PASS  7 topup checkout session — mode=payment, url present
PASS  8 refund — status=succeeded amount=4500
PASS  9 webhook signature verify — valid parsed; tampered rejected
```

## Environment

- **SDK:** `stripe` **22.2.0**, pinned exact in `package.json` (no `^`).
- **Keys:** test-mode (`sk_test_…` / `pk_test_…`) in `.env.stripe-sandbox` (gitignored via `.env*`). The script **refuses to run** on a non-`sk_test_` key (hard guard against ever hitting live).
- **Script:** [scripts/stripe-sandbox-proof.ts](../../scripts/stripe-sandbox-proof.ts). Re-run: `node --env-file=.env.stripe-sandbox --import tsx scripts/stripe-sandbox-proof.ts`.
- No Elements / no real card needed — uses Stripe's documented test PaymentMethods (`pm_card_visa`, `pm_card_authenticationRequired`, `pm_card_chargeDeclined`).

## What each check proves (→ which plan task it de-risks)

| # | Proves | De-risks |
|---|---|---|
| 1 | Account reachable, **test mode** | Phase 0 connectivity |
| 2 | **Save a card off-session** (SetupIntent `usage:'off_session'`, confirm) | card-save UI (3.6) + migration card re-entry (5.2) |
| 3 | **Off-session charge of an arbitrary amount** while customer absent (`off_session:true, confirm:true`) — *the core auto-recharge primitive* | auto-recharge handler (3.2) |
| 4 | **Idempotency** — same `idempotencyKey` returns the same PaymentIntent (no double-charge on worker retry, Rule 7) | auto-recharge handler (3.2) |
| 5 | **SCA soft-decline surfaces** as `authentication_required` and carries the PaymentIntent → we can email the customer to re-auth on-session | decline handling (3.2/3.5) |
| 6 | **Hard decline surfaces** with `code/decline_code` → disable-after-N-failures branch | decline handling (3.2/3.5) |
| 7 | **Top-up Checkout Session** (`mode:'payment'`, inline `price_data`, `setup_future_usage:'off_session'` saves the card on first top-up) | top-up checkout (2.4) |
| 8 | **Refund** a charge → top-up refund clawback | refund path (2.5) |
| 9 | **Webhook signature verify** — valid event parses, tampered body rejected (SDK `generateTestHeaderString` + `constructEvent`) | webhook route (2.5) |

## Verified API shapes (installed SDK 22.2.0 — supersedes the spec's from-research shapes)

- `new Stripe(secretKey)` — no explicit `apiVersion` needed; SDK default works.
- `stripe.setupIntents.create({ customer, payment_method, payment_method_types:['card'], usage:'off_session', confirm:true })` → `status:'succeeded'`, `payment_method` populated.
- `stripe.paymentIntents.create({ amount, currency:'usd', customer, payment_method, off_session:true, confirm:true }, { idempotencyKey })` → `status:'succeeded'`; arbitrary `amount` accepted; idempotency honored.
- Off-session decline → **throws** `Stripe.errors.StripeError`; `err.code` / `err.decline_code` carry the reason; `err.raw.payment_intent` carries the PI for re-auth.
- `stripe.checkout.sessions.create({ mode:'payment', line_items:[{ price_data:{ currency, product_data, unit_amount }, quantity:1 }], success_url, payment_intent_data:{ setup_future_usage:'off_session', metadata }, metadata })` → returns `url`.
- `stripe.refunds.create({ payment_intent })` → `status:'succeeded'`.
- `stripe.webhooks.generateTestHeaderString({ payload, secret })` + `stripe.webhooks.constructEvent(payload, header, secret)` — verify works; tamper throws.

## Notes

- This created a few **test-mode** customers / PaymentIntents / a refund in the sandbox — harmless fake data; ignore or clear in the Stripe test dashboard.
- For production: mint a **restricted key** (Customers/PaymentIntents/SetupIntents/Refunds/Charges = Write, Checkout Sessions = Write, Events = Read, Webhook Endpoints = Write only if `setup:stripe` creates the endpoint; Billing/Products/Connect = None). Publishable key has no permissions. Webhook signing secret (`whsec_…`) comes from creating the endpoint.

**Conclusion:** the prepaid + off-session auto-recharge approach is fully supported on this Stripe account. Cleared to build [Phase 1+ of the plan](../superpowers/plans/2026-06-05-prepaid-payg-billing.md).
