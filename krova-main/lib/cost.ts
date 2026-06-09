/**
 * Centralized cost calculation utilities (server-side).
 * Pure functions are re-exported from lib/cost-shared.ts.
 * Client components should import from "@/lib/cost-shared" directly.
 */

import { eq } from "drizzle-orm";
import {
  CREDIT_RATE_TIERS,
  DISK_RATE,
  RAM_RATE,
  VCPU_RATE,
} from "@/config/platform";
import { billingEvents, cubes, lifecycleLogs, spaces } from "@/db/schema";
import { audit } from "@/lib/audit";
import {
  computeOverageCascade,
  reportOverageEventNow,
} from "@/lib/billing/overage";
import { db } from "@/lib/db";
import { effectiveLimits } from "@/lib/plan/limits";
import { getSpaceOverridesTx, getSpacePlanRowTx } from "@/lib/plan/usage";

// Re-export pure functions and types from the client-safe shared module
export {
  type CreditRates,
  type CreditRateTier,
  calculateHourlyCost,
  calculateSleepHourlyCost,
  getTierMultiplier,
} from "@/lib/cost-shared";

import type { CreditRates, CreditRateTier } from "@/lib/cost-shared";
import { calculateHourlyCost, getTierMultiplier } from "@/lib/cost-shared";

/**
 * Return credit rate config from the static platform config.
 */
export function getCreditRates(): CreditRates {
  return {
    vcpuRate: VCPU_RATE,
    ramRate: RAM_RATE,
    diskRate: DISK_RATE,
  };
}

/**
 * Return credit rate tiers from the static platform config.
 */
export function getCreditRateTiers(): CreditRateTier[] {
  return CREDIT_RATE_TIERS.map((t, i) => ({
    id: `tier-${i}`,
    minVcpus: t.minVcpus,
    maxVcpus: t.maxVcpus,
    multiplier: t.multiplier,
    label: t.label,
    sortOrder: i,
  }));
}

/**
 * Charge prorated usage for a cube based on time elapsed since last billing.
 * Called when a cube stops being billable (delete, sleep, state-sync → sleeping).
 *
 * Prorated billing ensures customers are charged fairly for partial hours:
 *   - Cube runs for 18 minutes then sleeps → charged for 0.30h, not a full hour
 *   - Formula: calculateHourlyCost(resources, rates, tierMultiplier) × elapsedHours
 *
 * Safety guards:
 *   - Skips if lastBilledAt is null (cube was never billed / never ran)
 *   - Skips if < 1 minute elapsed (prevents micro-charges from rapid state changes)
 *   - Skips negative elapsed time (clock skew protection)
 *   - Caps charge at remaining balance (never goes negative)
 *   - Locks both cube and space rows (FOR UPDATE) to prevent double-charging
 *     when concurrent handlers (e.g., hourly billing + cube delete) run simultaneously
 *
 * Callers: cube-delete, cube-sleep, cube-state-sync, snapshot-restore
 */
export async function chargeProratedUsage(cube: {
  id: string;
  spaceId: string;
  vcpus: number;
  ramMb: number;
  diskLimitGb: number;
  lastBilledAt: Date | null;
}): Promise<void> {
  // Quick check on passed-in data (avoids unnecessary DB round-trip)
  if (!cube.lastBilledAt) {
    return;
  }

  const rates = getCreditRates();

  if (rates.vcpuRate < 0 || rates.ramRate < 0 || rates.diskRate < 0) {
    console.error("[chargeProratedUsage] invalid negative rates, skipping");
    audit({
      action: "billing.invalid_rates",
      category: "billing",
      actorType: "system",
      entityType: "cube",
      entityId: cube.id,
      spaceId: cube.spaceId,
      description: `Prorated billing skipped — negative rates detected (vcpu=${rates.vcpuRate}, ram=${rates.ramRate}, disk=${rates.diskRate})`,
      metadata: { cubeId: cube.id, rates },
      source: "worker",
    });
    return;
  }

  // Load tiers outside the transaction to minimize lock duration
  const tiers = getCreditRateTiers();
  const multiplier = getTierMultiplier(cube.vcpus, tiers);

  // Lock the cube row and read fresh lastBilledAt inside a transaction to prevent
  // concurrent calls (e.g., billing-hourly + cube-delete) from double-charging.
  const overageEventIdToReport = await db.transaction(
    async (tx): Promise<string | null> => {
      const [freshCube] = await tx
        .select({ lastBilledAt: cubes.lastBilledAt })
        .from(cubes)
        .where(eq(cubes.id, cube.id))
        .for("update")
        .limit(1);

      if (!freshCube?.lastBilledAt) {
        return null;
      }

      const now = new Date();
      const elapsedMs = now.getTime() - freshCube.lastBilledAt.getTime();
      const elapsedHours = elapsedMs / (1000 * 60 * 60);

      // Skip if less than 1 minute elapsed (avoids micro-charges from rapid
      // state changes — e.g. customer sleeps the cube within seconds of an
      // hourly tick or a fresh wake). Also skip negative elapsed time (clock
      // skew). Emit a lifecycle log so the customer can see why no prorated
      // event landed on their billing page — Fix #7, was previously a silent
      // no-op that surfaced as "where's my charge?" support tickets.
      if (elapsedHours < 1 / 60) {
        if (elapsedHours > 0) {
          const elapsedSec = Math.round(elapsedMs / 1000);
          await tx.insert(lifecycleLogs).values({
            entityType: "cube",
            entityId: cube.id,
            message: `Prorated compute billing skipped — only ${elapsedSec}s since last billing tick (minimum 60s to avoid micro-charges)`,
          });
        }
        return null;
      }

      const hourlyCost = calculateHourlyCost(
        { vcpus: cube.vcpus, ramMb: cube.ramMb, diskLimitGb: cube.diskLimitGb },
        rates,
        multiplier
      );
      // Rule 55 — clamp to 1h, matching the hourly cron's
      // `Math.min(elapsedHours, 1)` (billing-hourly.ts). Both paths bill the
      // same elapsed window since `lastBilledAt`; without this clamp a stop
      // fired during a STALLED-cron window would bill the entire backlog here
      // while the cron caps each tick at 1h — the same time billed under two
      // different ceilings. Capping favors the customer when our own worker is
      // delayed. The cron + prorated paths MUST apply the same per-event hour
      // ceiling. Display + audit below use `billedHours`, not `elapsedHours`.
      const billedHours = Math.min(elapsedHours, 1);
      const proratedCost = Number.parseFloat(
        (hourlyCost * billedHours).toFixed(4)
      );
      if (proratedCost <= 0) {
        return null;
      }

      // Lock space row + read the cascade inputs (prepaid balance + overage
      // settings). Route the prorated charge through the same three-bucket
      // cascade the hourly worker uses — without this, a cube slept or deleted
      // mid-hour by a customer with overage ENABLED and prepaid at $0 would
      // silently NOT be billed for the running fraction (the previous bare
      // Math.min(cost, balance) clamped to 0).
      const [currentSpace] = await tx
        .select({
          creditBalance: spaces.creditBalance,
          overageEnabled: spaces.overageEnabled,
          overageCapUsd: spaces.overageCapUsd,
          thisPeriodOverageUsd: spaces.thisPeriodOverageUsd,
          subscriptionStatus: spaces.subscriptionStatus,
        })
        .from(spaces)
        .where(eq(spaces.id, cube.spaceId))
        .for("update")
        .limit(1);

      if (!currentSpace) {
        return null;
      }

      // Phase 5C — resolve effective allow_overage (plan default + per-space
      // override) inside the same locked transaction.
      const planRow = await getSpacePlanRowTx(tx, cube.spaceId);
      const spaceOverrides = await getSpaceOverridesTx(tx, cube.spaceId);
      const limits = effectiveLimits(planRow, spaceOverrides);

      const cascade = computeOverageCascade({
        space: {
          id: cube.spaceId,
          creditBalance: currentSpace.creditBalance ?? "0",
          allowOverage: limits.allowOverage,
          overageEnabled: currentSpace.overageEnabled,
          overageCapUsd: currentSpace.overageCapUsd,
          thisPeriodOverageUsd: currentSpace.thisPeriodOverageUsd,
          subscriptionStatus: currentSpace.subscriptionStatus,
        },
        totalCost: proratedCost,
      });

      await tx
        .update(spaces)
        .set({
          creditBalance: cascade.newCreditBalance,
          thisPeriodOverageUsd: cascade.newThisPeriodOverageUsd,
          updatedAt: now,
        })
        .where(eq(spaces.id, cube.spaceId));

      // The PREPAID-funded portion is written as a `prorated_charge` (per-cube
      // attribution preserved); the OVERAGE-funded portion is written as a
      // distinct `overage_charge` so it shows up correctly in the ledger and is
      // reported to Polar's meter for next-cycle invoicing.
      const refusedNote =
        cascade.refused > 0
          ? ` — refused $${cascade.refused.toFixed(4)} (no funding available)`
          : "";
      const descBase = `${billedHours.toFixed(2)}h (${cube.vcpus} vCPU, ${cube.ramMb}MB RAM, ${cube.diskLimitGb}GB disk @ $${hourlyCost.toFixed(4)}/h${multiplier < 1 ? `, ${multiplier}x tier discount` : ""})${refusedNote}`;

      if (cascade.fromPrepaid > 0) {
        await tx.insert(billingEvents).values({
          spaceId: cube.spaceId,
          cubeId: cube.id,
          amount: cascade.fromPrepaid.toFixed(4),
          type: "prorated_charge",
          description: `Prorated charge: ${descBase}`,
        });
      }

      // Fix #4 — if proratedCost > 0 but ZERO funding (no prepaid, no overage),
      // no billing event lands on the customer's page even though the cube did
      // consume the resource. Emit a lifecycle log so the customer can see what
      // they owed but couldn't pay. The cube will get auto-slept by the hourly
      // pass if it's still running on the next tick.
      // Use `<= 0` (not `=== 0`) — cascade values are constructed via
      // Math.min/Math.max + toFixed/parseFloat round-trips that can leave
      // sub-precision fp residue; a strict `=== 0` would miss e.g. 1e-15.
      if (cascade.fromPrepaid <= 0 && cascade.fromOverage <= 0) {
        await tx.insert(lifecycleLogs).values({
          entityType: "cube",
          entityId: cube.id,
          message: `Prorated compute billing waived — $${proratedCost.toFixed(4)} consumed but no funding available (prepaid balance $0, overage cap reached or disabled)`,
        });
      } else if (cascade.refused > 0) {
        // Partial funding — note the unfunded delta on the cube timeline so the
        // customer can correlate with the auto-sleep banner.
        await tx.insert(lifecycleLogs).values({
          entityType: "cube",
          entityId: cube.id,
          message: `Prorated compute billing partially funded — $${(cascade.fromPrepaid + cascade.fromOverage).toFixed(4)} paid of $${proratedCost.toFixed(4)} consumed ($${cascade.refused.toFixed(4)} unfunded)`,
        });
      }

      let overageEventId: string | null = null;
      if (cascade.fromOverage > 0) {
        const [row] = await tx
          .insert(billingEvents)
          .values({
            spaceId: cube.spaceId,
            cubeId: cube.id,
            amount: cascade.fromOverage.toFixed(4),
            type: "overage_charge",
            description: `Prorated overage: ${descBase} — this period $${cascade.newThisPeriodOverageUsd} of $${currentSpace.overageCapUsd}`,
          })
          .returning({ id: billingEvents.id });
        overageEventId = row.id;
      }

      // Update lastBilledAt so we don't double-charge
      await tx
        .update(cubes)
        .set({ lastBilledAt: now })
        .where(eq(cubes.id, cube.id));

      // Log outside transaction scope (audit is fire-and-forget)
      audit({
        action: "billing.prorated_charge",
        category: "billing",
        actorType: "system",
        entityType: "cube",
        entityId: cube.id,
        spaceId: cube.spaceId,
        description: `Prorated charge $${proratedCost.toFixed(4)} for ${billedHours.toFixed(2)}h (prepaid $${cascade.fromPrepaid.toFixed(4)}, overage $${cascade.fromOverage.toFixed(4)}, refused $${cascade.refused.toFixed(4)})`,
        metadata: {
          requestedAmount: proratedCost,
          fromPrepaid: cascade.fromPrepaid,
          fromOverage: cascade.fromOverage,
          refused: cascade.refused,
          billedHours,
          elapsedHours,
          cubeId: cube.id,
        },
        source: "worker",
      });

      console.log(
        `[billing] prorated charge $${proratedCost.toFixed(4)} for cube ${cube.id} (${elapsedHours.toFixed(2)}h)`
      );
      return overageEventId;
    }
  );

  // Post-commit: report the overage portion to Polar's meter. Best-effort —
  // a failure leaves `polar_meter_reported_at` null for the
  // `polar.meter-reconcile` cron to retry.
  if (overageEventIdToReport) {
    await reportOverageEventNow(overageEventIdToReport);
  }
}

/**
 * `chargeProratedUsage` + structural audit-on-failure (Rule 51).
 *
 * Every customer-initiated stop path (`cube.sleep` / `cube.power-off` /
 * `cube.cold-restart` / `cube.delete` / `cube.resize` / `cube.transfer` /
 * `snapshot.restore` / `deleteSpace`) wraps the call in a `.catch` that
 * writes a `cube.billing_prorated_failed` audit row. Without this row a
 * silent billing failure on cube-delete or deleteSpace is unrecoverable
 * (the cube row is gone before any retry could fire). This helper
 * encapsulates that catch so Rule 51 is structural, not policy.
 *
 * **Non-fatal**: the wrapped operation never throws. A billing-system
 * failure must not block the cube state change that triggered it; the
 * audit row + console warning is the recovery surface.
 *
 * Caller supplies `flow` (the human-readable label used in the audit
 * description), `logPrefix` (the `[cube-sleep]`-style tag used in the
 * console warning), optional `actor` info (for handlers that have a real
 * user actor like `cube.transfer` / `cube.cold-restart`), and optional
 * `metadata` (extra context like `serverId`, `snapshotId`, etc.).
 *
 * Call-site guards (`if (cube.lastBilledAt)`, `if (sinceLastBillMs > 30s)`)
 * STAY at the call site because they vary by flow.
 */
export async function chargeProratedUsageWithAudit(
  cube: {
    id: string;
    spaceId: string;
    vcpus: number;
    ramMb: number;
    diskLimitGb: number;
    lastBilledAt: Date | null;
  },
  context: {
    /** Human-readable flow label inserted into the audit description.
     *  e.g. "sleep" → "Prorated billing during sleep failed: ..." */
    flow: string;
    /** `[cube-sleep]`-style tag for the `console.warn` line. */
    logPrefix: string;
    /** Actor identity for the audit row. Omit (or pass `{ type: "system" }`)
     *  for cron / system-triggered flows. Mirrors `auditActorType`:
     *  `"user" | "admin" | "system"`. `id` is omitted for `system`. */
    actor?:
      | { type: "system" }
      | { type: "user" | "admin"; id: string | null; email?: string | null };
    /** Extra metadata mixed into the audit row alongside the standard
     *  `lastBilledAt` + `error` fields. */
    metadata?: Record<string, unknown>;
    /** Defaults to `"worker"` (the common case). Server actions like
     *  `deleteSpace` pass `"web"`; admin API routes pass `"api"`. */
    source?: "worker" | "web" | "api";
  }
): Promise<void> {
  await chargeProratedUsage(cube).catch((err: unknown) => {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `${context.logPrefix} prorated billing failed (non-fatal):`,
      err
    );
    const actor = context.actor ?? { type: "system" };
    audit({
      action: "cube.billing_prorated_failed",
      category: "billing",
      actorType: actor.type,
      actorId: actor.type === "system" ? null : (actor.id ?? null),
      actorEmail: actor.type === "system" ? null : (actor.email ?? null),
      entityType: "cube",
      entityId: cube.id,
      spaceId: cube.spaceId,
      description: `Prorated billing during ${context.flow} failed: ${reason.slice(0, 200)}`,
      metadata: {
        ...context.metadata,
        lastBilledAt: cube.lastBilledAt?.toISOString() ?? null,
        error: reason.slice(0, 1000),
      },
      source: context.source ?? "worker",
    });
  });
}
