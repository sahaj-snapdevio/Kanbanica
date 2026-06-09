/**
 * Client-safe payment breakdown — base + processing fee + total. Mirrors the
 * integer-cent gross-up in `lib/billing/topup-checkout.ts` `computeTopupCents`
 * (the same math powers manual top-ups AND each paid subscription's monthly
 * charge — the customer pays `base + fee`, the space receives `base` as
 * credit). Kept separate from the server module because that one imports the
 * DB and cannot be bundled into a client component.
 *
 * Callers must pass the fee config explicitly — the server resolves it from
 * `platform_settings` (via `getPlatformSettings()`) and threads it through to
 * client components as props, so an operator's mid-day fee change takes
 * effect on the next page load without a redeploy.
 */

export interface PaymentBreakdown {
  baseUsd: number;
  feeUsd: number;
  totalUsd: number;
}

/** Compute the processing-fee breakdown for a base USD amount. */
export function paymentBreakdown(
  baseUsd: number,
  fee: { percent: number; flatUsd: number }
): PaymentBreakdown {
  if (!Number.isFinite(baseUsd) || baseUsd <= 0) {
    return { baseUsd: 0, feeUsd: 0, totalUsd: 0 };
  }
  const baseCents = Math.round(baseUsd * 100);
  const flatCents = Math.round(fee.flatUsd * 100);
  const totalCents = Math.ceil((baseCents + flatCents) / (1 - fee.percent));
  return {
    baseUsd: baseCents / 100,
    feeUsd: (totalCents - baseCents) / 100,
    totalUsd: totalCents / 100,
  };
}
