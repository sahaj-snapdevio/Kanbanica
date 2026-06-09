/**
 * Shared billing query helpers.
 * Centralizes billing summary, burn rate, and event count queries
 * to avoid duplication across pages and API routes.
 */

import { and, count, eq, inArray, sum } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  type CreditRateTier,
  calculateHourlyCost,
  calculateSleepHourlyCost,
  getTierMultiplier,
} from "@/lib/cost";
import { db } from "@/lib/db";

export interface BillingSummary {
  /**
   * Sum of every event type that DEBITS the space's credit balance:
   * `hourly_charge + prorated_charge + backup_storage_charge +
   *  sleep_storage_charge + overage_charge`. Must stay in lockstep with
   * `BILLING_DEBIT_TYPES` in `lib/billing-events.ts` (Rule 14) — the UI
   * paints +/- on the same Set, the summary aggregates here, so a missing
   * type would silently understate the customer-visible "Total charged".
   * `credit_refund` is broken out separately as `totalRefunds` (it debits
   * balance like a charge, but semantically REVERSES an earlier credit, so
   * it gets its own row).
   */
  totalCharged: number;
  /**
   * Sum of every event type that CREDITS the space's credit balance:
   * `credit_grant + credit_topup + plan_credit`. Refunds are reported
   * separately via `totalRefunds` rather than netted in here so the
   * customer-facing "Total credits received" stays a pure incoming sum.
   */
  totalCredited: number;
  totalGrants: number;
  totalPlanCredits: number;
  /**
   * Sum of `credit_refund` events — clawbacks written by the Polar refund
   * webhook when the customer was refunded a top-up or a subscription
   * invoice. Stored as positive USD amounts; subtract from `totalCredited`
   * for "net credits received" or add to `totalCharged` for "net spend"
   * depending on UI intent.
   */
  totalRefunds: number;
  totalTopups: number;
}

export interface BurnRate {
  /**
   * Disk across RUNNING cubes — what the running-compute disk component is
   * billed on (= sum of `cube.diskLimitGb` across running cubes). Sleeping
   * cubes are NOT included here — they pay on full disk and are surfaced
   * via `sleepBillableDiskGb` instead.
   */
  billableDiskGb: number;
  /**
   * Combined hourly burn = running-compute cost + sleep-storage cost. So the
   * customer-facing runway projection accounts for both active and idle
   * spend.
   */
  hourlyBurn: number;
  /** Sleep-storage cost component of `hourlyBurn` (sleeping cubes only). */
  hourlySleepStorageBurn: number;
  runningCubes: number;
  /** Sum of `diskLimitGb` across RUNNING cubes only. */
  runningDiskGb: number;
  /**
   * Disk billed for sleep storage = sum of `diskLimitGb` across sleeping
   * cubes (NO free-tier deduction — Rule 53). Equals the GB the customer
   * pays sleep-storage rent on each hour. Surfaced so the UI can render
   * the sleep-storage breakdown line with the same GB count + rate the
   * worker actually bills, instead of only the dollar total.
   */
  sleepBillableDiskGb: number;
  /** Number of cubes contributing to `hourlySleepStorageBurn`. */
  sleepingCubes: number;
  /** Sum of `diskLimitGb` across sleeping cubes only. */
  sleepingDiskGb: number;
  /** Sum of `diskLimitGb` across BOTH running and sleeping cubes. */
  totalDiskGb: number;
  totalRamMb: number;
  totalVcpus: number;
}

/**
 * Compute billing summary for a space (or platform-wide if no spaceId).
 * Note: Performance relies on the spaceId index on the billing_events table.
 * Ensure the index exists in the schema to avoid full table scans.
 */
export async function getBillingSummary(
  spaceId?: string
): Promise<BillingSummary> {
  const spaceFilter = spaceId
    ? eq(schema.billingEvents.spaceId, spaceId)
    : undefined;

  // Run all independent aggregation queries in parallel for better performance.
  // Charge-type list mirrors `BILLING_DEBIT_TYPES` in `lib/billing-events.ts`
  // — adding a new charge enum value means updating BOTH places (Rule 14).
  const [
    [creditedResult],
    [chargedResult],
    [grantsResult],
    [topupsResult],
    [planCreditsResult],
    [refundsResult],
  ] = await Promise.all([
    db
      .select({ total: sum(schema.billingEvents.amount) })
      .from(schema.billingEvents)
      .where(
        and(
          spaceFilter,
          // Every incoming-credit event type — Orbit grant, manual top-up,
          // and subscription plan credit.
          inArray(schema.billingEvents.type, [
            "credit_grant",
            "credit_topup",
            "plan_credit",
          ])
        )
      ),
    db
      .select({ total: sum(schema.billingEvents.amount) })
      .from(schema.billingEvents)
      .where(
        and(
          spaceFilter,
          inArray(schema.billingEvents.type, [
            "hourly_charge",
            "prorated_charge",
            "backup_storage_charge",
            "sleep_storage_charge",
            "overage_charge",
          ])
        )
      ),
    db
      .select({ total: sum(schema.billingEvents.amount) })
      .from(schema.billingEvents)
      .where(and(spaceFilter, eq(schema.billingEvents.type, "credit_grant"))),
    db
      .select({ total: sum(schema.billingEvents.amount) })
      .from(schema.billingEvents)
      .where(and(spaceFilter, eq(schema.billingEvents.type, "credit_topup"))),
    db
      .select({ total: sum(schema.billingEvents.amount) })
      .from(schema.billingEvents)
      .where(and(spaceFilter, eq(schema.billingEvents.type, "plan_credit"))),
    db
      .select({ total: sum(schema.billingEvents.amount) })
      .from(schema.billingEvents)
      .where(and(spaceFilter, eq(schema.billingEvents.type, "credit_refund"))),
  ]);

  return {
    totalCredited: Number.parseFloat(creditedResult?.total ?? "0"),
    totalCharged: Number.parseFloat(chargedResult?.total ?? "0"),
    totalGrants: Number.parseFloat(grantsResult?.total ?? "0"),
    totalTopups: Number.parseFloat(topupsResult?.total ?? "0"),
    totalPlanCredits: Number.parseFloat(planCreditsResult?.total ?? "0"),
    totalRefunds: Number.parseFloat(refundsResult?.total ?? "0"),
  };
}

/**
 * Compute current hourly burn rate from a space's cubes.
 *
 * Two cost components, summed into `hourlyBurn`:
 *   - Running compute (vCPU + RAM + FULL allocated disk, with tier
 *     multiplier). Only `status='running'` cubes.
 *   - Sleep storage: DISK_RATE × diskLimitGb × tier multiplier per hour —
 *     same per-GB rate AND full-disk basis as running disk (Rule 53: disk is
 *     sold 1:1 with the host, there is NO free-disk allowance — a sleeping
 *     rootfs occupies real bytes on the host regardless). Only
 *     `status='sleeping'` cubes. Source: config/platform.ts (DISK_RATE) via
 *     the shared `rates` arg.
 *
 * Including sleep storage in the burn keeps the customer-facing runway
 * projection honest — without it, a customer with 0 running cubes and a
 * pile of sleeping cubes would see "infinite runway" while their balance
 * was actively shrinking each hour.
 */
export async function getSpaceBurnRate(
  spaceId: string,
  rates: {
    vcpuRate: number;
    ramRate: number;
    diskRate: number;
  },
  tiers: CreditRateTier[] = []
): Promise<BurnRate> {
  // Query individual cubes so per-cube tier multipliers apply correctly.
  // Sleeping cubes need vcpus too so we can apply the same tier multiplier as
  // the running disk component (cube's vCPU count determines tier; the
  // multiplier doesn't disappear when the cube sleeps).
  const [runningCubeRows, sleepingCubeRows] = await Promise.all([
    db
      .select({
        vcpus: schema.cubes.vcpus,
        ramMb: schema.cubes.ramMb,
        diskLimitGb: schema.cubes.diskLimitGb,
      })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.spaceId, spaceId),
          eq(schema.cubes.status, "running")
        )
      ),
    db
      .select({
        vcpus: schema.cubes.vcpus,
        diskLimitGb: schema.cubes.diskLimitGb,
      })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.spaceId, spaceId),
          eq(schema.cubes.status, "sleeping")
        )
      ),
  ]);

  const runningCubes = runningCubeRows.length;
  let totalVcpus = 0;
  let totalRamMb = 0;
  let runningDiskGb = 0;
  let billableDiskGb = 0;
  let hourlyBurn = 0;

  for (const cube of runningCubeRows) {
    totalVcpus += cube.vcpus;
    totalRamMb += cube.ramMb;
    runningDiskGb += cube.diskLimitGb;
    billableDiskGb += cube.diskLimitGb;

    const multiplier = getTierMultiplier(cube.vcpus, tiers);
    hourlyBurn += calculateHourlyCost(
      { vcpus: cube.vcpus, ramMb: cube.ramMb, diskLimitGb: cube.diskLimitGb },
      rates,
      multiplier
    );
  }

  // Sleep storage = DISK_RATE × diskLimitGb × tier multiplier per hour —
  // identical per-GB rate and full-disk basis as the running-disk component
  // (running and sleeping cubes both occupy the full allocated disk on the
  // host). The shared formula lives in cost-shared.ts so the worker
  // (billing.hourly) and the UI (this burn-rate query) always agree on the
  // price. Always billed — no operator toggle; `DISK_RATE` in
  // config/platform.ts is the single source of truth (zero rate = free, by
  // the same lever that zeroes running-disk billing).
  let hourlySleepStorageBurn = 0;
  let sleepingDiskGb = 0;
  for (const cube of sleepingCubeRows) {
    sleepingDiskGb += cube.diskLimitGb;
    const multiplier = getTierMultiplier(cube.vcpus, tiers);
    hourlySleepStorageBurn += calculateSleepHourlyCost(
      { diskLimitGb: cube.diskLimitGb },
      rates,
      multiplier
    );
  }
  hourlySleepStorageBurn = Math.round(hourlySleepStorageBurn * 10_000) / 10_000;
  hourlyBurn += hourlySleepStorageBurn;

  // Round final sum to 4 decimal places
  hourlyBurn = Math.round(hourlyBurn * 10_000) / 10_000;

  return {
    hourlySleepStorageBurn,
    sleepingCubes: sleepingCubeRows.length,
    runningCubes,
    totalVcpus,
    totalRamMb,
    runningDiskGb,
    sleepingDiskGb,
    totalDiskGb: runningDiskGb + sleepingDiskGb,
    billableDiskGb,
    // Sleeping disk is billed at the same per-GB rate as running disk;
    // equals sleepingDiskGb but exposed as its own field so the UI can
    // render "Sleep storage: X GB × $rate/hr" without re-deriving it.
    sleepBillableDiskGb: sleepingDiskGb,
    hourlyBurn,
  };
}

/**
 * Count billing events for a space, optionally filtered.
 */
export async function getBillingEventCount(
  ...conditions: Parameters<typeof and>
): Promise<number> {
  const [result] = await db
    .select({ count: count(schema.billingEvents.id) })
    .from(schema.billingEvents)
    .where(and(...conditions));

  return Number(result?.count ?? 0);
}
