/**
 * One-shot bootstrap of every Polar resource Krova needs, driven entirely
 * via the Polar API. Idempotent — safe to re-run; existing resources are
 * detected (by name / URL / metadata) and reused, with only missing pieces
 * created.
 *
 * Usage:
 *   pnpm setup:polar <app-url>
 *   pnpm setup:polar https://app.krova.cloud
 *
 * What it does:
 *   1. Creates the `krova_overage_usd` meter (filter: event name match,
 *      aggregation: sum of `metadata.amount_cents`).
 *   2. Creates the credit top-up product (one-time, pay-what-you-want).
 *   3. Creates the webhook endpoint at `<app-url>/api/webhooks/polar` and
 *      prints the signing secret (Polar only returns it at creation time).
 *   4. Writes the meter id + top-up product id into the `platform_settings`
 *      singleton so the runtime reads them without any env vars.
 *   5. Provisions every paid plan in the `plans` table that does not yet
 *      have a `polar_product_id` (subscription products with a fixed price
 *      at the grossed-up amount + a metered price on the overage meter).
 *
 * What you (the operator) must still do by hand — there is no API path:
 *   • Create the Polar organization in the dashboard and complete billing
 *     details (KYC, payout, tax). The org is what your API token is scoped
 *     to; without it everything 401s.
 *   • Generate the API access token in the dashboard
 *     (Settings → Developer → API access tokens) and set `POLAR_ACCESS_TOKEN`
 *     in env before running this script.
 *   • Choose `POLAR_SERVER=sandbox` or `production` and set in env.
 *   • After the script prints the webhook secret, set
 *     `POLAR_WEBHOOK_SECRET=<printed value>` in env and restart the worker
 *     + Next.js process so the signature verifier picks it up.
 *
 * Everything else (meter, top-up product, webhook endpoint, every plan's
 * Polar product) is handled here.
 */
import { existsSync } from "fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

const APP_URL = process.argv[2];
if (!APP_URL || !/^https?:\/\//.test(APP_URL)) {
  console.error(
    "Usage: pnpm setup:polar <app-url>\nExample: pnpm setup:polar https://app.krova.cloud"
  );
  process.exit(1);
}
const WEBHOOK_URL = `${APP_URL.replace(/\/$/, "")}/api/webhooks/polar`;

if (!process.env.POLAR_ACCESS_TOKEN) {
  console.error(
    "POLAR_ACCESS_TOKEN is not set. Generate one in the Polar dashboard (Settings → Developer → API access tokens) and put it in your .env before re-running."
  );
  process.exit(1);
}

const SUBSCRIBED_EVENTS = [
  "order.paid",
  "order.refunded",
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
] as const;

/** The event-name our worker ingests + the filter clause that matches it.
 *  Must equal `POLAR_OVERAGE_EVENT_NAME` in `config/platform.ts`. */
const OVERAGE_EVENT_NAME = "krova_overage_usd";
/** Customer-visible name for the meter — shows up on invoices + the
 *  checkout's "Additional metered usage" row. Friendlier than the raw
 *  event name. */
const OVERAGE_METER_DISPLAY_NAME = "Overage";
/** Custom-unit label so the price displays as "$1.00 / $1 of overage"
 *  instead of "$0.01 / unit". */
const OVERAGE_CUSTOM_LABEL = "$1 of overage";
/** Meter aggregates `amount_cents` (1 unit = 1 cent of accrued overage).
 *  Multiplier of 100 makes Polar display the meter in dollars (100 cents
 *  per displayed unit). */
const OVERAGE_CUSTOM_MULTIPLIER = 100;
/** Polar `unit_amount` is in CENTS per meter unit. 1 cent per unit gives
 *  pass-through billing ($1 of overage → $1 charged). */
const OVERAGE_UNIT_AMOUNT = "1";

const TOPUP_PRODUCT_METADATA_KEY = "krova_kind";
const TOPUP_PRODUCT_METADATA_VALUE = "credit_topup";

async function main() {
  const [
    { Polar },
    { db },
    schema,
    { eq },
    { getPlatformSettings, invalidatePlatformSettingsCache },
    { paymentBreakdown },
  ] = await Promise.all([
    import("@polar-sh/sdk"),
    import("@/lib/db"),
    import("@/db/schema"),
    import("drizzle-orm"),
    import("@/lib/platform-settings"),
    import("@/components/billing/topup-math"),
  ]);

  const polar = new Polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN!,
    server:
      (process.env.POLAR_SERVER as "sandbox" | "production" | undefined) ??
      "sandbox",
  });

  console.log(`\nPolar setup against ${APP_URL}`);
  console.log(`Server: ${process.env.POLAR_SERVER ?? "sandbox"}\n`);

  // 1. Overage meter -------------------------------------------------------
  // Look up by either the new display name OR the legacy event-name name —
  // older setups created the meter named after the event filter literal,
  // and we want to detect + heal those rather than create a duplicate.
  console.log("→ Overage meter");
  let meterId: string | null = null;
  let existingMeter: {
    id: string;
    name: string;
    unit?: string;
    customLabel?: string | null;
    customMultiplier?: number | null;
  } | null = null;
  const meterList = await polar.meters.list({});
  for await (const page of meterList) {
    const hit = page.result.items.find(
      (m) =>
        m.name === OVERAGE_METER_DISPLAY_NAME || m.name === OVERAGE_EVENT_NAME
    );
    if (hit) {
      meterId = hit.id;
      existingMeter = {
        id: hit.id,
        name: hit.name,
        unit: (hit as { unit?: string }).unit,
        customLabel: (hit as { customLabel?: string | null }).customLabel,
        customMultiplier: (hit as { customMultiplier?: number | null })
          .customMultiplier,
      };
      break;
    }
  }
  if (existingMeter && meterId) {
    // Heal an out-of-date meter — re-running the script after a bug fix
    // should leave the meter in the desired shape without manual dashboard
    // edits. The FILTER + AGGREGATION are NOT touched (changing them on a
    // live meter would corrupt historical readings — only the display
    // metadata is safe to migrate in place).
    const driftsName = existingMeter.name !== OVERAGE_METER_DISPLAY_NAME;
    const driftsUnit = existingMeter.unit !== "custom";
    const driftsLabel = existingMeter.customLabel !== OVERAGE_CUSTOM_LABEL;
    const driftsMultiplier =
      existingMeter.customMultiplier !== OVERAGE_CUSTOM_MULTIPLIER;
    if (driftsName || driftsUnit || driftsLabel || driftsMultiplier) {
      await polar.meters.update({
        id: meterId,
        meterUpdate: {
          name: OVERAGE_METER_DISPLAY_NAME,
          unit: "custom",
          customLabel: OVERAGE_CUSTOM_LABEL,
          customMultiplier: OVERAGE_CUSTOM_MULTIPLIER,
        },
      });
      console.log(`  healed  (${meterId}) — switched to custom unit display`);
    } else {
      console.log(`  exists  (${meterId})`);
    }
  } else {
    const created = await polar.meters.create({
      name: OVERAGE_METER_DISPLAY_NAME,
      unit: "custom",
      customLabel: OVERAGE_CUSTOM_LABEL,
      customMultiplier: OVERAGE_CUSTOM_MULTIPLIER,
      filter: {
        conjunction: "and",
        clauses: [
          {
            property: "name",
            operator: "eq",
            value: OVERAGE_EVENT_NAME,
          },
        ],
      },
      aggregation: { func: "sum", property: "amount_cents" },
    });
    meterId = created.id;
    console.log(`  created (${meterId})`);
  }

  // 2. Credit top-up product ----------------------------------------------
  console.log("→ Credit top-up product");
  let topupProductId: string | null = null;
  const productList = await polar.products.list({ isArchived: false });
  for await (const page of productList) {
    const hit = page.result.items.find(
      (p) =>
        p.metadata?.[TOPUP_PRODUCT_METADATA_KEY] ===
        TOPUP_PRODUCT_METADATA_VALUE
    );
    if (hit) {
      topupProductId = hit.id;
      break;
    }
  }
  if (topupProductId) {
    console.log(`  exists  (${topupProductId})`);
  } else {
    const created = await polar.products.create({
      name: "Krova credit top-up",
      recurringInterval: null,
      prices: [
        {
          amountType: "custom",
          priceCurrency: "usd",
          // Minimum 50¢ — Polar rejects 1–49¢ on custom prices. The actual
          // floor used by the customer-facing top-up sheet is
          // `platform_settings.creditTopupMinUsd` (default $10), so this is
          // just the API floor.
          minimumAmount: 50,
        },
      ],
      metadata: {
        [TOPUP_PRODUCT_METADATA_KEY]: TOPUP_PRODUCT_METADATA_VALUE,
      },
    });
    topupProductId = created.id;
    console.log(`  created (${topupProductId})`);
  }

  // 3. Webhook endpoint ---------------------------------------------------
  console.log("→ Webhook endpoint");
  let webhookExists = false;
  let webhookSecret: string | null = null;
  const endpointList = await polar.webhooks.listWebhookEndpoints({});
  for await (const page of endpointList) {
    const hit = page.result.items.find((e) => e.url === WEBHOOK_URL);
    if (hit) {
      webhookExists = true;
      console.log(
        `  exists  (${hit.id}) — signing secret unavailable on re-run`
      );
      console.log(
        "          Polar only returns the secret at creation time. If you have lost it,"
      );
      console.log(
        "          rotate via Polar dashboard → Settings → Webhooks → Reset signing secret."
      );
      break;
    }
  }
  if (!webhookExists) {
    const created = await polar.webhooks.createWebhookEndpoint({
      url: WEBHOOK_URL,
      format: "raw",
      events: [...SUBSCRIBED_EVENTS],
    });
    webhookSecret = created.secret;
    console.log(`  created (${created.id})`);
  }

  // 4. Persist meter id + top-up product id to platform_settings ---------
  console.log("→ Writing platform_settings");
  await db
    .update(schema.platformSettings)
    .set({
      polarCreditProductId: topupProductId,
      polarOverageMeterId: meterId,
      updatedAt: new Date(),
    })
    .where(eq(schema.platformSettings.id, 1));
  invalidatePlatformSettingsCache();
  console.log("  saved");

  // 5. Provision paid plans without a polar_product_id -------------------
  console.log("→ Subscription products (paid plans)");
  const settings = await getPlatformSettings();
  const plans = await db
    .select()
    .from(schema.plans)
    .where(eq(schema.plans.isArchived, false));
  let plansProvisioned = 0;
  let plansHealed = 0;
  for (const plan of plans) {
    const priceUsd = Number.parseFloat(plan.priceUsd);
    if (priceUsd <= 0) {
      continue;
    }
    if (plan.polarProductId) {
      // Already provisioned — heal the metered price if its unit_amount is
      // drifted (e.g. set by an older buggy code path that used "0.01"
      // instead of "1"). Polar's `products.update` REPLACES the prices
      // array, but pricing references via `{ id }` preserve existing
      // grandfathered subscribers on the old price — only new subscribers
      // see the corrected metered price. Sandbox / no-subscribers-yet is
      // unaffected.
      const existing = await polar.products.get({ id: plan.polarProductId });
      const meteredPrice = (existing.prices ?? []).find(
        (p): p is typeof p & { id: string; unitAmount?: string | number } =>
          "amountType" in p && p.amountType === "metered_unit"
      );
      const fixedPrice = (existing.prices ?? []).find(
        (p): p is typeof p & { id: string } =>
          "amountType" in p && p.amountType === "fixed"
      );
      if (!meteredPrice) {
        console.log(
          `  ${plan.slug.padEnd(10)} exists  (${plan.polarProductId}) — no metered price; skipping`
        );
        continue;
      }
      const currentUnitAmount =
        meteredPrice.unitAmount === undefined
          ? null
          : String(meteredPrice.unitAmount);
      if (currentUnitAmount === OVERAGE_UNIT_AMOUNT) {
        console.log(
          `  ${plan.slug.padEnd(10)} exists  (${plan.polarProductId})`
        );
        continue;
      }
      // Heal: keep fixed price by id, replace metered with corrected one.
      const newPrices: Array<
        | { id: string }
        | {
            amountType: "metered_unit";
            priceCurrency: "usd";
            meterId: string;
            unitAmount: string;
          }
      > = [];
      if (fixedPrice) {
        newPrices.push({ id: fixedPrice.id });
      }
      newPrices.push({
        amountType: "metered_unit",
        priceCurrency: "usd",
        meterId,
        unitAmount: OVERAGE_UNIT_AMOUNT,
      });
      await polar.products.update({
        id: plan.polarProductId,
        productUpdate: { prices: newPrices },
      });
      console.log(
        `  ${plan.slug.padEnd(10)} healed  (${plan.polarProductId}) — metered unit_amount ${currentUnitAmount} → ${OVERAGE_UNIT_AMOUNT}`
      );
      plansHealed += 1;
      continue;
    }
    const breakdown = paymentBreakdown(priceUsd, {
      percent: settings.paymentFeePercent,
      flatUsd: settings.paymentFeeFlatUsd,
    });
    const product = await polar.products.create({
      name: plan.name,
      recurringInterval: "month",
      prices: [
        {
          amountType: "fixed",
          priceCurrency: "usd",
          priceAmount: Math.round(breakdown.totalUsd * 100),
        },
        {
          amountType: "metered_unit",
          priceCurrency: "usd",
          meterId,
          unitAmount: OVERAGE_UNIT_AMOUNT,
        },
      ],
    });
    await db
      .update(schema.plans)
      .set({ polarProductId: product.id, updatedAt: new Date() })
      .where(eq(schema.plans.id, plan.id));
    console.log(`  ${plan.slug.padEnd(10)} created (${product.id})`);
    plansProvisioned += 1;
  }

  // 6. Summary ------------------------------------------------------------
  console.log("\n──────────────────────────────────────────────────");
  console.log("Polar setup complete.");
  console.log(`  Meter id:              ${meterId}`);
  console.log(`  Top-up product id:     ${topupProductId}`);
  console.log(`  Webhook URL:           ${WEBHOOK_URL}`);
  console.log(`  Plans provisioned:     ${plansProvisioned}`);
  console.log(`  Plans healed:          ${plansHealed}`);
  console.log("──────────────────────────────────────────────────");
  if (webhookSecret) {
    console.log("\n⚠ ONE-TIME SECRET — copy this into your env now:\n");
    console.log(`  POLAR_WEBHOOK_SECRET=${webhookSecret}\n`);
    console.log(
      "Restart the worker + Next.js after setting the env var. Polar will NOT"
    );
    console.log("show this secret again; rotation requires a manual reset.\n");
  } else {
    console.log(
      "\nWebhook endpoint already existed — keep your existing POLAR_WEBHOOK_SECRET."
    );
    console.log(
      "Lost the secret? Rotate it in the Polar dashboard, then update your env.\n"
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("setup:polar failed:", err);
  process.exit(1);
});
