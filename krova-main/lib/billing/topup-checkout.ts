/**
 * Top-up checkout core: the processing-fee gross-up math and the
 * row-before-checkout creation sequence. Used by the `createCreditCheckout`
 * server action.
 */
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getPaymentProvider } from "@/lib/payments";
import type { CheckoutResult } from "@/lib/payments/types";
import { getPlatformSettings } from "@/lib/platform-settings";

/**
 * Integer-cent processing-fee gross-up. See the top-up spec, Checkout
 * creation step 4. Reads the fee percent + flat from `platform_settings` so
 * the operator can tune it without a redeploy.
 */
export async function computeTopupCents(baseUsd: number): Promise<{
  baseCents: number;
  feeCents: number;
  totalCents: number;
}> {
  const settings = await getPlatformSettings();
  const baseCents = Math.round(baseUsd * 100);
  const flatCents = Math.round(settings.paymentFeeFlatUsd * 100);
  const totalCents = Math.ceil(
    (baseCents + flatCents) / (1 - settings.paymentFeePercent)
  );
  return { baseCents, feeCents: totalCents - baseCents, totalCents };
}

export interface CreateTopupResult {
  checkoutUrl: string;
  purchaseId: string;
}

/**
 * Insert a `credit_purchases` row, create the provider checkout, back-link the
 * provider checkout id. Inserting the row FIRST guarantees the webhook always
 * finds it. On a provider failure the row is marked `failed`.
 */
export async function createTopupCheckout(opts: {
  spaceId: string;
  initiatedByUserId: string;
  /** Email of the user clicking "Add credits" — pre-fills the Polar form. */
  initiatedByUserEmail: string;
  /** Display name of the user — pre-fills cardholder name (null if unset). */
  initiatedByUserName: string | null;
  baseUsd: number;
}): Promise<CreateTopupResult> {
  const {
    spaceId,
    initiatedByUserId,
    initiatedByUserEmail,
    initiatedByUserName,
    baseUsd,
  } = opts;
  const { baseCents, feeCents, totalCents } = await computeTopupCents(baseUsd);

  const purchaseId = createId();
  await db.insert(schema.creditPurchases).values({
    id: purchaseId,
    spaceId,
    initiatedByUserId,
    paymentProvider: getPaymentProvider().name,
    amount: (baseCents / 100).toFixed(4),
    // DB column kept as `surcharge_amount` for backward compatibility (the
    // value semantics — processing fee — are unchanged; renaming the column
    // would require a migration on a live table for no functional gain).
    surchargeAmount: (feeCents / 100).toFixed(4),
    status: "pending",
  });

  let checkout: CheckoutResult;
  try {
    checkout = await getPaymentProvider().createTopupCheckout({
      spaceId,
      purchaseId,
      initiatorUserId: initiatedByUserId,
      contact: {
        email: initiatedByUserEmail,
        name: initiatedByUserName,
      },
      totalCents,
      successUrl: `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/billing?topup=success`,
    });
  } catch (err) {
    await db
      .update(schema.creditPurchases)
      .set({ status: "failed" })
      .where(eq(schema.creditPurchases.id, purchaseId));
    throw err;
  }

  await db
    .update(schema.creditPurchases)
    .set({ providerCheckoutId: checkout.checkoutId })
    .where(eq(schema.creditPurchases.id, purchaseId));

  return { checkoutUrl: checkout.url, purchaseId };
}
