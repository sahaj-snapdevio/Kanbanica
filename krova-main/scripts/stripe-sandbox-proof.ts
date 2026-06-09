/**
 * Stripe SANDBOX proof-of-concept (NOT app code; throwaway de-risking script).
 *
 * Proves — against the real Stripe test API — every mechanic the prepaid
 * pay-as-you-go + off-session auto-recharge model depends on, BEFORE we build
 * the full feature. Reads keys from .env.stripe-sandbox (gitignored).
 *
 * Run:
 *   node --env-file=.env.stripe-sandbox --import tsx scripts/stripe-sandbox-proof.ts
 *
 * Exits non-zero if any check fails. Uses Stripe's documented test
 * PaymentMethods (pm_card_visa, pm_card_chargeDeclined,
 * pm_card_authenticationRequired) so no real card / no Elements is needed.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error(
    "STRIPE_SECRET_KEY missing (load .env.stripe-sandbox via --env-file)"
  );
  process.exit(2);
}
if (!key.startsWith("sk_test_")) {
  console.error(
    "Refusing to run: key is not a sk_test_ sandbox key. This proof must never run against live."
  );
  process.exit(2);
}

const stripe = new Stripe(key);

type Check = { name: string; ok: boolean; detail: string };

/** Structural shape of a Stripe SDK error — avoids using the runtime error
 *  class as a type (TS2749). We only read these fields. */
type StripeErrLike = {
  code?: string;
  decline_code?: string;
  payment_intent?: unknown;
  raw?: { decline_code?: string; payment_intent?: unknown };
};

const results: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

async function newCustomerWithCard(
  pmToken: string
): Promise<{ customer: string; pm: string }> {
  const customer = await stripe.customers.create({
    metadata: { proof: "krova-sandbox", spaceId: "space_proof" },
  });
  const pm = await stripe.paymentMethods.attach(pmToken, {
    customer: customer.id,
  });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: pm.id },
  });
  return { customer: customer.id, pm: pm.id };
}

async function main() {
  console.log("=== Stripe sandbox proof (test mode) ===\n");

  // 1. Connectivity + confirm test mode.
  try {
    const bal = await stripe.balance.retrieve();
    record(
      "1 connectivity",
      bal.livemode === false,
      `livemode=${bal.livemode} (must be false)`
    );
  } catch (e) {
    record("1 connectivity", false, `error: ${(e as Error).message}`);
  }

  // 2. SetupIntent — save a card off-session (the "add card" / migration consent flow).
  let savedCustomer = "";
  let savedPm = "";
  try {
    const c = await stripe.customers.create({
      metadata: { proof: "krova-sandbox" },
    });
    const si = await stripe.setupIntents.create({
      customer: c.id,
      payment_method: "pm_card_visa",
      payment_method_types: ["card"],
      usage: "off_session",
      confirm: true,
    });
    savedCustomer = c.id;
    savedPm =
      typeof si.payment_method === "string"
        ? si.payment_method
        : (si.payment_method?.id ?? "");
    record(
      "2 setupintent off_session",
      si.status === "succeeded" && !!savedPm,
      `status=${si.status} pm=${savedPm.slice(0, 12)}…`
    );
  } catch (e) {
    record(
      "2 setupintent off_session",
      false,
      `error: ${(e as Error).message}`
    );
  }

  // 3. Off-session PaymentIntent — auto-recharge HAPPY PATH (arbitrary amount, customer absent).
  let happyPiId = "";
  const idemKey = "proof-autorecharge-" + savedCustomer;
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: 4500, // $45 top-up to refill to $50
        currency: "usd",
        customer: savedCustomer,
        payment_method: savedPm,
        off_session: true,
        confirm: true,
        metadata: { kind: "auto_recharge", spaceId: "space_proof" },
      },
      { idempotencyKey: idemKey }
    );
    happyPiId = pi.id;
    record(
      "3 off-session charge (auto-recharge)",
      pi.status === "succeeded",
      `status=${pi.status} amount=${pi.amount} id=${pi.id.slice(0, 14)}…`
    );
  } catch (e) {
    record(
      "3 off-session charge (auto-recharge)",
      false,
      `error: ${(e as Error).message}`
    );
  }

  // 4. Idempotency — same key returns the SAME PaymentIntent (no double charge).
  try {
    const pi2 = await stripe.paymentIntents.create(
      {
        amount: 4500,
        currency: "usd",
        customer: savedCustomer,
        payment_method: savedPm,
        off_session: true,
        confirm: true,
        metadata: { kind: "auto_recharge", spaceId: "space_proof" },
      },
      { idempotencyKey: idemKey }
    );
    record(
      "4 idempotency",
      pi2.id === happyPiId,
      `same id reused: ${pi2.id === happyPiId} (${pi2.id.slice(0, 14)}…)`
    );
  } catch (e) {
    record("4 idempotency", false, `error: ${(e as Error).message}`);
  }

  // 5. Off-session SCA decline — authentication_required (must surface so we can email the customer to re-auth).
  try {
    const { customer, pm } = await newCustomerWithCard(
      "pm_card_authenticationRequired"
    );
    await stripe.paymentIntents.create({
      amount: 4500,
      currency: "usd",
      customer,
      payment_method: pm,
      off_session: true,
      confirm: true,
    });
    record(
      "5 off-session SCA surfaces",
      false,
      "expected an authentication_required error, got success"
    );
  } catch (e) {
    const err = e as StripeErrLike;
    const code = err.code ?? err.decline_code ?? "";
    const hasPi = !!err.payment_intent || !!err.raw?.payment_intent;
    record(
      "5 off-session SCA surfaces",
      code === "authentication_required" && hasPi,
      `code=${code} carriesPaymentIntentForReauth=${hasPi}`
    );
  }

  // 6. Off-session hard decline — card_declined (must surface so we can disable after N failures).
  try {
    const { customer, pm } = await newCustomerWithCard(
      "pm_card_chargeDeclined"
    );
    await stripe.paymentIntents.create({
      amount: 4500,
      currency: "usd",
      customer,
      payment_method: pm,
      off_session: true,
      confirm: true,
    });
    record(
      "6 off-session hard decline surfaces",
      false,
      "expected a card decline, got success"
    );
  } catch (e) {
    const err = e as StripeErrLike;
    const declineCode = err.decline_code ?? err.raw?.decline_code ?? "";
    record(
      "6 off-session hard decline surfaces",
      err.code === "card_declined" || !!declineCode,
      `code=${err.code} decline_code=${declineCode}`
    );
  }

  // 7. Top-up Checkout Session (mode=payment, inline price_data, saves card for future off-session).
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Krova credit" },
            unit_amount: 5000,
          },
          quantity: 1,
        },
      ],
      success_url: "https://example.com/success",
      payment_intent_data: {
        setup_future_usage: "off_session",
        metadata: { kind: "topup", spaceId: "space_proof" },
      },
      metadata: { spaceId: "space_proof", purchaseId: "purchase_proof" },
    });
    record(
      "7 topup checkout session",
      !!session.url && session.mode === "payment",
      `mode=${session.mode} url=${session.url ? "present" : "MISSING"}`
    );
  } catch (e) {
    record("7 topup checkout session", false, `error: ${(e as Error).message}`);
  }

  // 8. Refund the happy-path charge (top-up refund clawback path).
  try {
    if (!happyPiId) {
      throw new Error("no successful PaymentIntent to refund");
    }
    const refund = await stripe.refunds.create({ payment_intent: happyPiId });
    record(
      "8 refund",
      refund.status === "succeeded" || refund.status === "pending",
      `status=${refund.status} amount=${refund.amount}`
    );
  } catch (e) {
    record("8 refund", false, `error: ${(e as Error).message}`);
  }

  // 9. Webhook signature verify — valid passes, tampered throws (uses SDK test signer; no real whsec needed).
  try {
    const secret = "whsec_test_proof_secret";
    const payload = JSON.stringify({
      id: "evt_proof",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_x" } },
    });
    const header = stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    });
    const evt = stripe.webhooks.constructEvent(payload, header, secret);
    let tamperRejected = false;
    try {
      stripe.webhooks.constructEvent(payload + "x", header, secret);
    } catch {
      tamperRejected = true;
    }
    record(
      "9 webhook signature verify",
      evt.type === "payment_intent.succeeded" && tamperRejected,
      `validParsed=${evt.type} tamperedRejected=${tamperRejected}`
    );
  } catch (e) {
    record(
      "9 webhook signature verify",
      false,
      `error: ${(e as Error).message}`
    );
  }

  // Summary
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  if (passed !== results.length) {
    console.log(
      "FAILED:",
      results
        .filter((r) => !r.ok)
        .map((r) => r.name)
        .join(", ")
    );
    process.exit(1);
  }
  console.log(
    "ALL PROOF CHECKS PASSED — the Stripe prepaid/auto-recharge mechanics work on this account."
  );
}

main().catch((e) => {
  console.error("proof crashed:", e);
  process.exit(1);
});
