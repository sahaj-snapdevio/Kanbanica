/**
 * Pure postpaid-overage cascade math — NO DB / payment-provider imports, so it
 * is import-safe and unit-testable in isolation (same discipline as
 * lib/cost-shared.ts). `lib/billing/overage.ts` re-exports these and wraps
 * `computeOverageCascade` with the transactional writes + Polar reporting.
 *
 * The three-bucket cascade the hourly worker runs per space:
 *   1. prepaid `creditBalance`           (bucket 1 — `fromPrepaid`)
 *   2. the remaining overage budget      (bucket 2 — `fromOverage`)
 *   3. whatever can't be funded          (`refused` → triggers auto-sleep)
 */

export interface CascadeInput {
  /** Already-locked space row read at the top of the worker tx. */
  space: {
    id: string;
    creditBalance: string; // numeric → string
    /**
     * The resolved per-space `allow_overage` (the plan's value unless
     * overridden by `spaces.override_allow_overage`). The cascade only needs
     * the boolean, not the plan tier.
     */
    allowOverage: boolean;
    overageEnabled: boolean;
    overageCapUsd: string;
    thisPeriodOverageUsd: string;
    subscriptionStatus: string | null;
  };
  /** Total Cube-hour cost this tick is trying to debit (USD). */
  totalCost: number;
}

export interface CascadeResult {
  /** USD debited from the overage budget (bucket 2). 0 if disabled. */
  fromOverage: number;
  /** USD debited from prepaid balance (bucket 1). */
  fromPrepaid: number;
  /** The new prepaid balance after the debit. */
  newCreditBalance: string;
  /** The new this-period overage total. */
  newThisPeriodOverageUsd: string;
  /** USD that COULD NOT be funded — triggers the auto-sleep path. */
  refused: number;
}

/** Pure: compute the cascade. No DB writes. Caller applies the updates. */
export function computeOverageCascade(input: CascadeInput): CascadeResult {
  const { space, totalCost } = input;
  const balance = Number.parseFloat(space.creditBalance);

  // Clamp to [0, totalCost]. A negative `balance` (theoretically possible
  // via an admin manual adjustment or a clawback that overshoots) would
  // otherwise produce a negative `fromPrepaid`, making `newCreditBalance =
  // balance − fromPrepaid` MORE positive than `balance` (a free top-up at
  // the customer's expense) AND overstating `remaining`, which would draw
  // extra from the overage budget. The FOR UPDATE row lock makes this
  // unlikely in normal flow, but defensive clamping is free.
  const fromPrepaid = Math.max(0, Math.min(balance, totalCost));
  const remaining = totalCost - fromPrepaid;
  const overageAllowed =
    remaining > 0 &&
    space.overageEnabled &&
    space.allowOverage &&
    space.subscriptionStatus === "active";

  let fromOverage = 0;
  if (overageAllowed) {
    const cap = Number.parseFloat(space.overageCapUsd);
    const used = Number.parseFloat(space.thisPeriodOverageUsd);
    const capRemaining = Math.max(0, cap - used);
    fromOverage = Math.min(capRemaining, remaining);
  }
  const refused = remaining - fromOverage;

  return {
    fromPrepaid,
    fromOverage,
    refused,
    newCreditBalance: (balance - fromPrepaid).toFixed(4),
    newThisPeriodOverageUsd: (
      Number.parseFloat(space.thisPeriodOverageUsd) + fromOverage
    ).toFixed(4),
  };
}

/**
 * Split the PREPAID-funded portion of a billing tick across its per-item charge
 * rows so that `sum(returned) === fromPrepaid` (to 4dp). Charge-event rows
 * represent the prepaid-funded amount; the cascade writes a SEPARATE
 * `overage_charge` row for `fromOverage`, and `refused` is never charged. So
 * `sum(per-item rows) + overage_charge = fromPrepaid + fromOverage` — matching
 * the prorated-billing convention and fixing the ledger double-count where each
 * item was recorded at full cost AND the overage row was added on top.
 *
 * Common case (no overage — `fromPrepaid >= totalCost`): every item keeps its
 * FULL cost unchanged, so the itemized per-cube/backup display is identical to
 * before. Only when overage funds part of the tick are amounts scaled by
 * `fromPrepaid/totalCost`, with the LAST item absorbing the rounding remainder
 * so the sum is exact. Items whose scaled amount rounds to 0 are returned as 0;
 * the caller should drop $0 rows (the sum is unaffected).
 */
export function prepaidChargeSplit(
  itemCosts: number[],
  fromPrepaid: number,
  totalCost: number
): number[] {
  const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
  if (itemCosts.length === 0) {
    return [];
  }
  // Full prepaid coverage (common, non-overage path) → unscaled. Also guards
  // totalCost <= 0 (no division) and any fromPrepaid overshoot.
  if (totalCost <= 0 || fromPrepaid >= totalCost) {
    return itemCosts.map(round4);
  }
  const scale = fromPrepaid / totalCost;
  const out: number[] = [];
  let allocated = 0;
  for (let i = 0; i < itemCosts.length; i++) {
    if (i === itemCosts.length - 1) {
      // Last item absorbs the rounding remainder so the sum equals fromPrepaid.
      out.push(Math.max(0, round4(fromPrepaid - allocated)));
    } else {
      const a = round4(itemCosts[i] * scale);
      out.push(a);
      allocated += a;
    }
  }
  return out;
}
