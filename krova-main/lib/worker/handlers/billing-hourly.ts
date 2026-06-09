import { and, eq, gte, inArray } from "drizzle-orm";
import type { Job } from "pg-boss";
import {
  billingEvents,
  cubeBackups,
  cubes,
  lifecycleLogs,
  platformSettings,
  spaces,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import {
  applyOverageCascadeTx,
  reportOverageEventNow,
} from "@/lib/billing/overage";
import { prepaidChargeSplit } from "@/lib/billing/overage-cascade";
import {
  calculateHourlyCost,
  calculateSleepHourlyCost,
  getCreditRates,
  getCreditRateTiers,
  getTierMultiplier,
} from "@/lib/cost";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { getSpaceOwner } from "@/lib/email/helpers";
import { lowBalanceEmailTemplate } from "@/lib/email/templates/low-balance";
import { overage50EmailTemplate } from "@/lib/email/templates/overage-50";
import { overage80EmailTemplate } from "@/lib/email/templates/overage-80";
import { overageCapHitEmailTemplate } from "@/lib/email/templates/overage-cap-hit";
import { overageStartedEmailTemplate } from "@/lib/email/templates/overage-started";
import { zeroBalanceEmailTemplate } from "@/lib/email/templates/zero-balance";
import { env } from "@/lib/env";
import { effectiveLimits } from "@/lib/plan/limits";
import {
  getSpaceOverridesTx,
  getSpacePlanRow,
  getSpacePlanRowTx,
} from "@/lib/plan/usage";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/** Minimum hours between low-balance warning emails per space. */
const LOW_BALANCE_EMAIL_DEBOUNCE_HOURS = 24;

// Marker strings written to `lifecycle_logs` to debounce the four cascade
// overage emails (started / 50% / 80% / cap hit) to once per BILLING PERIOD.
// The marker is keyed on the period's `currentPeriodEnd` ISO string, so:
//   - Within a period: same key → exact-message lookup finds the marker →
//     duplicate-suppressed.
//   - Period advances (new currentPeriodEnd) → new key → marker absent →
//     emails fire fresh for the new period.
// Same-period status flips (active → past_due → active) do NOT advance
// currentPeriodEnd, so the markers remain valid — fixing the previous
// `subscriptionEventAt`-based scheme that wrongly re-armed emails on flip.
function overageEmailMarker(
  kind: "started" | "50" | "80" | "cap_hit",
  periodEnd: Date
): string {
  return `overage email: ${kind} (period ${periodEnd.toISOString()})`;
}

/**
 * Returns true if an overage-threshold email keyed on `(kind, periodEnd)` has
 * already been written to `lifecycle_logs` for this space. Exact-message
 * lookup; the periodEnd key makes the check intrinsically per-period.
 */
async function wasOverageEmailSentThisPeriod(
  spaceId: string,
  kind: "started" | "50" | "80" | "cap_hit",
  periodEnd: Date
): Promise<boolean> {
  const marker = overageEmailMarker(kind, periodEnd);
  const [existing] = await db
    .select({ id: lifecycleLogs.id })
    .from(lifecycleLogs)
    .where(
      and(
        eq(lifecycleLogs.entityType, "space"),
        eq(lifecycleLogs.entityId, spaceId),
        eq(lifecycleLogs.message, marker)
      )
    )
    .limit(1);
  return !!existing;
}

/** Returns true if a low-balance email was already sent for this space within the debounce window. */
async function wasLowBalanceEmailRecentlySent(
  spaceId: string
): Promise<boolean> {
  const since = new Date(
    Date.now() - LOW_BALANCE_EMAIL_DEBOUNCE_HOURS * 60 * 60 * 1000
  );
  const [existing] = await db
    .select({ id: lifecycleLogs.id })
    .from(lifecycleLogs)
    .where(
      and(
        eq(lifecycleLogs.entityType, "space"),
        eq(lifecycleLogs.entityId, spaceId),
        eq(lifecycleLogs.message, "low-balance warning email sent"),
        gte(lifecycleLogs.createdAt, since)
      )
    )
    .limit(1);
  return !!existing;
}

/**
 * Hourly billing handler — runs every hour via pg-boss scheduled job.
 *
 * Billing flow:
 *   1. Load credit rates (vcpuRate, ramRate, diskRate) from config/platform.ts
 *   2. Query all running cubes, group by space
 *   3. For each space:
 *      a. Calculate per-cube cost: calculateHourlyCost() × elapsed hours since lastBilledAt
 *      b. Elapsed time is capped at 1h max to prevent runaway charges from delayed jobs
 *      c. Deduct total from space credit balance inside a transaction (FOR UPDATE lock)
 *      d. Write a billing event per cube with full breakdown in the description
 *      e. Update lastBilledAt on each charged cube
 *      f. If balance hits zero: auto-sleep all running cubes, notify owner
 *      g. If balance is low (< $5): send warning email (debounced to once per 24h)
 *   4. Backup storage billing (separate pass):
 *      - Charges all spaces with complete backups: diskSizeGb × diskRate per hour
 *      - Can also trigger zero-balance auto-sleep if it exhausts credits
 *   5. Sleep storage billing (separate pass — ALWAYS-ON, no operator toggle):
 *      - Charges every cube with `status='sleeping'` for its on-disk rootfs
 *        footprint: DISK_RATE × diskLimitGb × tier multiplier per hour.
 *        Same per-GB rate and full-disk basis as the running-disk component
 *        — running and sleeping cubes both occupy the full allocated disk on
 *        the host.
 *      - Single source of truth: `config/platform.ts` (DISK_RATE). Setting
 *        DISK_RATE to 0 there is the ONLY way to disable sleep-storage
 *        billing — and it disables running-disk billing in lockstep. No
 *        per-installation override.
 *      - Independent of `lastBilledAt` — that flag tracks running-compute
 *        billing only. Every sleeping cube joins the rotation on every tick.
 *      - Routed through `applyOverageCascadeTx` so customers with overage
 *        enabled can pay for sleep storage from their overage budget when
 *        prepaid is empty. Refused funding triggers the same auto-sleep
 *        path as compute exhaustion.
 */
export async function handleBillingHourly(_jobs: Job[]): Promise<void> {
  void _jobs;
  console.log("[billing-hourly] starting hourly billing cycle");

  // 1. Load credit rate config using shared helper
  const rates = await getCreditRates();
  if (!rates) {
    console.error(
      "[billing-hourly] no credit rate config found (id=1), skipping"
    );
    return;
  }

  // 1b. Validate rates are not negative
  if (rates.vcpuRate < 0 || rates.ramRate < 0 || rates.diskRate < 0) {
    console.error(
      "[billing-hourly] invalid negative rates in config, aborting billing cycle"
    );
    return;
  }

  // 1c. Load volume discount tiers
  const tiers = await getCreditRateTiers();

  // 2. Query all running Cubes with their space info
  const runningCubes = await db
    .select({
      cubeId: cubes.id,
      spaceId: cubes.spaceId,
      serverId: cubes.serverId,
      vcpus: cubes.vcpus,
      ramMb: cubes.ramMb,
      diskLimitGb: cubes.diskLimitGb,
      lastBilledAt: cubes.lastBilledAt,
    })
    .from(cubes)
    .where(eq(cubes.status, "running"));

  if (runningCubes.length === 0) {
    // No running cubes anywhere — the running-compute loop is a no-op for
    // this tick, but DO NOT return: sleeping cubes still pay sleep storage
    // and `cube_backups` rows still accrue backup-storage rent. Without
    // continuing past this point, those passes are skipped fleet-wide
    // whenever utilization briefly drops to zero (every customer who slept
    // their cubes to save money would silently get free storage). Fall
    // through; the empty `cubesBySpace` loop trivially does nothing and
    // execution reaches the backup + sleep passes below.
    console.log(
      "[billing-hourly] no running Cubes — skipping compute pass, continuing to backup + sleep storage passes"
    );
  }

  // 3. Group Cubes by spaceId
  const cubesBySpace = new Map<string, typeof runningCubes>();
  for (const cube of runningCubes) {
    const existing = cubesBySpace.get(cube.spaceId) ?? [];
    existing.push(cube);
    cubesBySpace.set(cube.spaceId, existing);
  }

  // 4. Process each space (wrapped in try/catch to prevent one space failure from breaking the entire cycle)
  let spacesFailed = 0;
  for (const [spaceId, spaceCubes] of cubesBySpace) {
    try {
      // Re-verify each cube is still running before charging.
      // Prevents billing cubes that were deleted between the initial query and now.
      const cubeIds = spaceCubes.map((c) => c.cubeId);
      const stillRunning = await db
        .select({ id: cubes.id })
        .from(cubes)
        .where(and(eq(cubes.status, "running"), inArray(cubes.id, cubeIds)));
      const stillRunningIds = new Set(stillRunning.map((c) => c.id));
      const activeCubes = spaceCubes.filter((c) =>
        stillRunningIds.has(c.cubeId)
      );

      if (activeCubes.length === 0) {
        continue;
      }

      // Calculate per-cube cost prorated by elapsed time since lastBilledAt.
      // This prevents overcharging cubes that started mid-hour and makes
      // retries safe (a retry only charges for the tiny window since the last charge).
      const cubeCosts: Array<{
        cubeId: string;
        serverId: string;
        cost: number;
        vcpus: number;
        ramMb: number;
        diskLimitGb: number;
        elapsedHours: number;
        multiplier: number;
      }> = [];

      const now = new Date();
      for (const cube of activeCubes) {
        const multiplier = getTierMultiplier(cube.vcpus, tiers);
        const hourlyCost = calculateHourlyCost(
          {
            vcpus: cube.vcpus,
            ramMb: cube.ramMb,
            diskLimitGb: cube.diskLimitGb,
          },
          rates,
          multiplier
        );
        // Prorate: charge only for elapsed time since lastBilledAt.
        // If lastBilledAt is null, skip (cube never started billing clock).
        if (!cube.lastBilledAt) {
          continue;
        }
        const elapsedMs = now.getTime() - cube.lastBilledAt.getTime();
        const elapsedHours = elapsedMs / (1000 * 60 * 60);
        // Skip if less than 1 minute elapsed (prevents micro-charges from retries/rapid state changes)
        if (elapsedHours < 1 / 60) {
          continue;
        }
        // Cap at 1 hour maximum per billing cycle to prevent runaway charges
        // from delayed billing (e.g., if the job was stuck for hours)
        const clampedHours = Math.min(elapsedHours, 1);
        const cost = Math.round(hourlyCost * clampedHours * 10_000) / 10_000;
        if (cost <= 0) {
          continue;
        }
        cubeCosts.push({
          cubeId: cube.cubeId,
          serverId: cube.serverId,
          cost,
          vcpus: cube.vcpus,
          ramMb: cube.ramMb,
          diskLimitGb: cube.diskLimitGb,
          elapsedHours: clampedHours,
          multiplier,
        });
      }

      if (cubeCosts.length === 0) {
        continue;
      }

      // Deduct from space credit balance atomically (FOR UPDATE prevents concurrent overwrites)
      const billedAt = new Date();
      const txResult = await db.transaction(async (tx) => {
        const [currentSpace] = await tx
          .select({
            creditBalance: spaces.creditBalance,
            lowBalanceThreshold: spaces.lowBalanceThreshold,
            overageEnabled: spaces.overageEnabled,
            overageCapUsd: spaces.overageCapUsd,
            thisPeriodOverageUsd: spaces.thisPeriodOverageUsd,
            subscriptionStatus: spaces.subscriptionStatus,
            currentPeriodEnd: spaces.currentPeriodEnd,
            subscriptionEventAt: spaces.subscriptionEventAt,
          })
          .from(spaces)
          .where(eq(spaces.id, spaceId))
          .for("update")
          .limit(1);

        if (!currentSpace) {
          return null;
        }

        // Phase 5C — resolve effective allow_overage (plan default merged with
        // any per-space override). Single source of truth for the cascade.
        const planRow = await getSpacePlanRowTx(tx, spaceId);
        const spaceOverrides = await getSpaceOverridesTx(tx, spaceId);
        const limits = effectiveLimits(planRow, spaceOverrides);
        // Free plans (priceUsd === "0") get the "Choose a plan" CTA in zero/
        // low-balance emails instead of "Add Credits".
        const isFreePlan = Number.parseFloat(planRow.priceUsd) <= 0;

        // Re-verify cubes are still running inside the transaction (prevents double-charge
        // race where a cube is deleted/slept between our initial read and this transaction).
        // Also check lastBilledAt to skip cubes already charged by concurrent prorated billing.
        const stillRunningInTx = await tx
          .select({ id: cubes.id, lastBilledAt: cubes.lastBilledAt })
          .from(cubes)
          .where(
            and(
              eq(cubes.status, "running"),
              inArray(
                cubes.id,
                activeCubes.map((c) => c.cubeId)
              )
            )
          );
        const stillRunningTxMap = new Map(
          stillRunningInTx.map((c) => [c.id, c.lastBilledAt])
        );

        // Filter to only cubes still running within transaction lock AND whose lastBilledAt
        // hasn't been cleared (null = already charged and stopped by another handler)
        const chargeableCubes = cubeCosts.filter((c) => {
          const txLastBilledAt = stillRunningTxMap.get(c.cubeId);
          if (txLastBilledAt === undefined) {
            return false; // No longer running
          }
          if (txLastBilledAt === null) {
            return false; // Already charged and cleared by another handler
          }
          return true;
        });
        if (chargeableCubes.length === 0) {
          return null;
        }

        // Round accumulated total to 4 decimals to prevent floating point drift across many cubes
        const actualTotalCost =
          Math.round(
            chargeableCubes.reduce((sum, c) => sum + c.cost, 0) * 10_000
          ) / 10_000;

        const { result: cascade, overageEventId } = await applyOverageCascadeTx(
          {
            tx,
            input: {
              space: {
                id: spaceId,
                creditBalance: currentSpace.creditBalance ?? "0",
                allowOverage: limits.allowOverage,
                overageEnabled: currentSpace.overageEnabled,
                overageCapUsd: currentSpace.overageCapUsd,
                thisPeriodOverageUsd: currentSpace.thisPeriodOverageUsd,
                subscriptionStatus: currentSpace.subscriptionStatus,
              },
              totalCost: actualTotalCost,
            },
            billedAt,
          }
        );

        // Write billing events for each Cube. The amount is the PREPAID-funded
        // portion of the cube's cost — the cascade above already wrote a
        // separate overage_charge for fromOverage, so recording full cost here
        // too would double-count the overage slice (and the refused slice) in
        // "Total charged". prepaidChargeSplit keeps amounts UNCHANGED when
        // prepaid covers the tick (the common case) and scales them to sum to
        // fromPrepaid otherwise; $0 rows (fully overage-funded) are dropped.
        const prepaidAmounts = prepaidChargeSplit(
          chargeableCubes.map((c) => c.cost),
          cascade.fromPrepaid,
          actualTotalCost
        );
        const hourlyRows = chargeableCubes
          .map((vc, i) => ({ vc, amount: prepaidAmounts[i] }))
          .filter((r) => r.amount > 0)
          .map(({ vc, amount }) => ({
            spaceId,
            cubeId: vc.cubeId,
            amount: amount.toFixed(4),
            type: "hourly_charge" as const,
            description: `Hourly charge (${vc.elapsedHours.toFixed(2)}h): ${vc.vcpus} vCPU, ${vc.ramMb}MB RAM, ${vc.diskLimitGb}GB disk @ $${calculateHourlyCost({ vcpus: vc.vcpus, ramMb: vc.ramMb, diskLimitGb: vc.diskLimitGb }, rates, vc.multiplier).toFixed(4)}/h${vc.multiplier < 1 ? ` (${vc.multiplier}x tier discount)` : ""}`,
          }));
        if (hourlyRows.length > 0) {
          await tx.insert(billingEvents).values(hourlyRows);
        }

        // Update lastBilledAt for all charged cubes (batch update)
        await tx
          .update(cubes)
          .set({ lastBilledAt: billedAt })
          .where(
            inArray(
              cubes.id,
              chargeableCubes.map((c) => c.cubeId)
            )
          );

        return {
          cascade,
          overageEventId,
          chargedCubes: chargeableCubes,
          lowBalanceThreshold: currentSpace.lowBalanceThreshold,
          isFreePlan,
          overageCapUsd: currentSpace.overageCapUsd,
          overageEnabled: currentSpace.overageEnabled,
          // The billing-period key for the overage-email debouncer. The
          // marker strings are keyed on this ISO timestamp so a NEW period
          // (currentPeriodEnd advances on renewal) means a fresh key and
          // emails can fire again. Same-period status flips do NOT change
          // currentPeriodEnd, so the markers stay valid (no duplicate emails).
          currentPeriodEnd: currentSpace.currentPeriodEnd,
        };
      });

      if (!txResult) {
        console.warn(
          `[billing-hourly] space ${spaceId} not found or no chargeable cubes, skipping`
        );
        continue;
      }

      const {
        cascade,
        overageEventId,
        chargedCubes,
        lowBalanceThreshold,
        isFreePlan,
        overageCapUsd,
        overageEnabled,
        currentPeriodEnd,
      } = txResult;

      // Audit only actually charged cubes (not the full cubeCosts list)
      for (const vc of chargedCubes) {
        audit({
          action: "billing.hourly_charge",
          category: "billing",
          actorType: "system",
          entityType: "space",
          entityId: spaceId,
          spaceId,
          description: `Hourly charge $${vc.cost.toFixed(4)} for cube ${vc.cubeId} (${vc.elapsedHours.toFixed(2)}h)`,
          metadata: {
            cubeId: vc.cubeId,
            amount: vc.cost.toFixed(4),
            elapsedHours: vc.elapsedHours,
          },
          source: "worker",
        });
      }

      const actualTotalCharged = chargedCubes.reduce(
        (sum, c) => sum + c.cost,
        0
      );
      console.log(
        `[billing-hourly] space=${spaceId} charged=${actualTotalCharged.toFixed(4)} newBalance=${cascade.newCreditBalance} fromPrepaid=${cascade.fromPrepaid.toFixed(4)} fromOverage=${cascade.fromOverage.toFixed(4)} refused=${cascade.refused.toFixed(4)}`
      );

      // Auto-sleep when the hour could not be fully paid for — either the
      // prepaid balance is exhausted and overage is off/blocked, or overage
      // is on but its cap has been hit. From the customer's view both
      // outcomes are the same: no funding for this hour → sleep every Cube.
      const newBalance = Number.parseFloat(cascade.newCreditBalance);
      if (cascade.refused > 0) {
        console.log(
          `[billing-hourly] space ${spaceId} balance exhausted, sleeping all Cubes`
        );

        // Sleep EVERY running cube in the space — not only the ones charged
        // this cycle. A cube billed under a minute ago (skipped above) or one
        // whose lastBilledAt was cleared by a concurrent handler is still
        // running and must not keep running on a zero balance.
        const runningInSpace = await db
          .select({ id: cubes.id, serverId: cubes.serverId })
          .from(cubes)
          .where(and(eq(cubes.spaceId, spaceId), eq(cubes.status, "running")));

        audit({
          action: "billing.zero_balance_sleep",
          category: "billing",
          actorType: "system",
          entityType: "space",
          entityId: spaceId,
          spaceId,
          description: "Zero balance — sleeping all cubes in space",
          metadata: { spaceId, cubeCount: runningInSpace.length },
          source: "worker",
        });

        if (runningInSpace.length > 0) {
          for (const rc of runningInSpace) {
            audit({
              action: "billing.zero_balance_sleep",
              category: "billing",
              actorType: "system",
              entityType: "cube",
              entityId: rc.id,
              spaceId,
              description: "Cube auto-slept due to zero balance",
              metadata: { spaceId, cubeId: rc.id },
              source: "worker",
            });
          }

          // Mark all running Cubes for zero-balance sleep (single batched update)
          await db
            .update(cubes)
            .set({ zeroBalanceSleep: true, updatedAt: new Date() })
            .where(
              inArray(
                cubes.id,
                runningInSpace.map((rc) => rc.id)
              )
            );

          // Enqueue sleep jobs in parallel (independent per cube)
          await Promise.all(
            runningInSpace.map((rc) =>
              enqueueJob(JOB_NAMES.CUBE_SLEEP, {
                cubeId: rc.id,
                spaceId,
                serverId: rc.serverId,
              })
            )
          );

          // Write lifecycle log for each Cube (single batched insert)
          await db.insert(lifecycleLogs).values(
            runningInSpace.map((rc) => ({
              entityType: "cube" as const,
              entityId: rc.id,
              message: "Cube slept — insufficient credits",
            }))
          );

          // Write space-level lifecycle log
          await db.insert(lifecycleLogs).values({
            entityType: "space",
            entityId: spaceId,
            message: "All Cubes slept — credit balance exhausted",
          });

          // Notify space owner: zero-balance OR overage cap reached.
          // When overage was actively funding (`cascade.fromOverage > 0`) and
          // got refused, the customer hit their CAP — send the dedicated
          // cap-hit email (more accurate than "credit reached $0"). Otherwise
          // (refused without any overage spend) the prepaid balance is just
          // exhausted, so the existing zero-balance email is correct.
          const capWasHit = cascade.fromOverage > 0 && cascade.refused > 0;
          try {
            const owner = await getSpaceOwner(spaceId);
            if (owner) {
              const spaceUrl = `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/billing`;
              if (capWasHit && currentPeriodEnd) {
                // Debounce: at most one cap-hit email per billing period.
                // Without this, raising the cap mid-period and re-hitting it
                // would trigger another email in the same period.
                const sentCapHit = await wasOverageEmailSentThisPeriod(
                  spaceId,
                  "cap_hit",
                  currentPeriodEnd
                );
                if (!sentCapHit) {
                  const { html, text } = await overageCapHitEmailTemplate({
                    userName: owner.name,
                    spaceName: owner.spaceName,
                    cap: Number.parseFloat(overageCapUsd).toFixed(2),
                    pausedCubeCount: runningInSpace.length,
                    spaceUrl,
                  });
                  await enqueueEmail({
                    to: owner.email,
                    subject: `Overage cap reached — ${owner.spaceName} Cubes paused`,
                    html,
                    text,
                  });
                  await db.insert(lifecycleLogs).values({
                    entityType: "space",
                    entityId: spaceId,
                    message: overageEmailMarker("cap_hit", currentPeriodEnd),
                  });
                }
              } else {
                const { html, text } = await zeroBalanceEmailTemplate({
                  userName: owner.name,
                  spaceName: owner.spaceName,
                  pausedCubeCount: runningInSpace.length,
                  spaceUrl,
                  isFreePlan,
                });
                await enqueueEmail({
                  to: owner.email,
                  subject: `Cubes paused — ${owner.spaceName} credit balance exhausted`,
                  html,
                  text,
                });
              }
            }
          } catch (err) {
            console.error(
              `[billing-hourly] failed to send zero-balance email for space ${spaceId}:`,
              err
            );
            // Critical: customer won't know to top up — audit for admin visibility
            audit({
              action: "billing.email_failure",
              category: "billing",
              actorType: "system",
              entityType: "space",
              entityId: spaceId,
              spaceId,
              description:
                "CRITICAL: Failed to send zero-balance email — customer unaware cubes are paused",
              metadata: {
                error: err instanceof Error ? err.message : String(err),
              },
              source: "worker",
            });
          }
        }
      } else if (
        newBalance > 0 &&
        newBalance <= Number.parseFloat(lowBalanceThreshold) &&
        // Suppress the "credit running low — top up or your cubes will sleep"
        // warning when overage is actively funding this tick. The customer
        // gets the dedicated overage threshold emails (50%/80%/cap-hit)
        // instead, which describe the real situation accurately.
        cascade.fromOverage === 0
      ) {
        audit({
          action: "billing.low_balance_warning",
          category: "billing",
          actorType: "system",
          entityType: "space",
          entityId: spaceId,
          spaceId,
          description: `Low balance warning: $${newBalance.toFixed(2)} remaining`,
          metadata: { spaceId, balance: newBalance.toFixed(2) },
          source: "worker",
        });

        // Notify space owner: low balance warning (at most once every 24 hours)
        try {
          const alreadySent = await wasLowBalanceEmailRecentlySent(spaceId);
          if (!alreadySent) {
            const owner = await getSpaceOwner(spaceId);
            if (owner) {
              const spaceUrl = `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/billing`;
              const { html, text } = await lowBalanceEmailTemplate({
                userName: owner.name,
                spaceName: owner.spaceName,
                currentBalance: newBalance.toFixed(2),
                spaceUrl,
                isFreePlan,
              });
              await enqueueEmail({
                to: owner.email,
                subject: `Low credit balance warning — ${owner.spaceName}`,
                html,
                text,
              });
              // Record that we sent the email to enforce the debounce window
              await db.insert(lifecycleLogs).values({
                entityType: "space",
                entityId: spaceId,
                message: "low-balance warning email sent",
              });
            }
          }
        } catch (err) {
          console.error(
            `[billing-hourly] failed to send low-balance email for space ${spaceId}:`,
            err
          );
        }
      }

      // Post-commit: report the overage event to Polar. Best-effort — a
      // failure leaves `polar_meter_reported_at` null for the
      // `polar.meter-reconcile` cron to retry.
      if (overageEventId) {
        await reportOverageEventNow(overageEventId);
      }

      // Overage threshold emails (started / 50% / 80%). The cap-hit email is
      // sent inline above when `cascade.refused > 0 && cascade.fromOverage > 0`.
      // All four are debounced once per billing period via period-keyed
      // lifecycle_logs markers — skipped entirely if currentPeriodEnd is null
      // (no active subscription, in which case overage shouldn't be running).
      if (overageEnabled && cascade.fromOverage > 0 && currentPeriodEnd) {
        try {
          const cap = Number.parseFloat(overageCapUsd);
          const used = Number.parseFloat(cascade.newThisPeriodOverageUsd);

          // 1. Started — first time fromOverage > 0 this period.
          const startedAlreadySent = await wasOverageEmailSentThisPeriod(
            spaceId,
            "started",
            currentPeriodEnd
          );
          if (!startedAlreadySent) {
            const owner = await getSpaceOwner(spaceId);
            if (owner) {
              const spaceUrl = `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/billing`;
              const { html, text } = await overageStartedEmailTemplate({
                userName: owner.name,
                spaceName: owner.spaceName,
                thisPeriodOverage: used.toFixed(2),
                cap: cap.toFixed(2),
                spaceUrl,
              });
              await enqueueEmail({
                to: owner.email,
                subject: `Postpaid overage started — ${owner.spaceName}`,
                html,
                text,
              });
              await db.insert(lifecycleLogs).values({
                entityType: "space",
                entityId: spaceId,
                message: overageEmailMarker("started", currentPeriodEnd),
              });
            }
          }

          // 2. 50% — crossed half the cap this period.
          if (cap > 0 && used / cap >= 0.5) {
            const sent50 = await wasOverageEmailSentThisPeriod(
              spaceId,
              "50",
              currentPeriodEnd
            );
            if (!sent50) {
              const owner = await getSpaceOwner(spaceId);
              if (owner) {
                const spaceUrl = `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/billing`;
                const { html, text } = await overage50EmailTemplate({
                  userName: owner.name,
                  spaceName: owner.spaceName,
                  thisPeriodOverage: used.toFixed(2),
                  cap: cap.toFixed(2),
                  spaceUrl,
                });
                await enqueueEmail({
                  to: owner.email,
                  subject: `Overage at 50% — ${owner.spaceName}`,
                  html,
                  text,
                });
                await db.insert(lifecycleLogs).values({
                  entityType: "space",
                  entityId: spaceId,
                  message: overageEmailMarker("50", currentPeriodEnd),
                });
              }
            }
          }

          // 3. 80% — nearing cap.
          if (cap > 0 && used / cap >= 0.8) {
            const sent80 = await wasOverageEmailSentThisPeriod(
              spaceId,
              "80",
              currentPeriodEnd
            );
            if (!sent80) {
              const owner = await getSpaceOwner(spaceId);
              if (owner) {
                const spaceUrl = `${env.NEXT_PUBLIC_APP_URL}/${spaceId}/billing`;
                const { html, text } = await overage80EmailTemplate({
                  userName: owner.name,
                  spaceName: owner.spaceName,
                  thisPeriodOverage: used.toFixed(2),
                  cap: cap.toFixed(2),
                  spaceUrl,
                });
                await enqueueEmail({
                  to: owner.email,
                  subject: `Overage at 80% — ${owner.spaceName}`,
                  html,
                  text,
                });
                await db.insert(lifecycleLogs).values({
                  entityType: "space",
                  entityId: spaceId,
                  message: overageEmailMarker("80", currentPeriodEnd),
                });
              }
            }
          }
        } catch (err) {
          console.error(
            `[billing-hourly] failed to send overage threshold email for space ${spaceId}:`,
            err
          );
        }
      }
    } catch (spaceErr) {
      spacesFailed++;
      console.error(
        `[billing-hourly] FAILED to process space ${spaceId}:`,
        spaceErr
      );
      audit({
        action: "billing.space_billing_failed",
        category: "billing",
        actorType: "system",
        entityType: "space",
        entityId: spaceId,
        spaceId,
        description:
          "Hourly billing failed for space — requires manual reconciliation",
        metadata: {
          error:
            spaceErr instanceof Error ? spaceErr.message : String(spaceErr),
        },
        source: "worker",
      });
      // Continue processing other spaces — don't let one failure block all billing
    }
  }

  if (spacesFailed > 0) {
    console.error(
      `[billing-hourly] ${spacesFailed}/${cubesBySpace.size} spaces failed billing`
    );
  }

  // ─── Backup storage billing ───
  // Backups are billed at the operator-configurable per-GB-month rate
  // (`platform_settings.backup_storage_rate_per_gb_per_month`, default
  // $0.01/GB/mo) — much cheaper than the running-cube disk rate, since
  // backups are passive storage. Prefer the compressed `sizeBytes` over
  // the original `diskSizeGb` so customers are billed for what the
  // `.cube` actually consumes on S3 rather than the rootfs's uncompressed
  // footprint. The hourly cost = totalGb × rate / 730 (hours per month).
  const [billingSettings] = await db
    .select({
      backupRatePerGbPerMonth: platformSettings.backupStorageRatePerGbPerMonth,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, 1))
    .limit(1);
  const backupRatePerGbPerMonth = Number.parseFloat(
    billingSettings?.backupRatePerGbPerMonth ?? "0"
  );
  const backupRatePerGbPerHour = backupRatePerGbPerMonth / 730;

  const completeBackups =
    backupRatePerGbPerHour > 0
      ? await db
          .select({
            id: cubeBackups.id,
            spaceId: cubeBackups.spaceId,
            diskSizeGb: cubeBackups.diskSizeGb,
            sizeBytes: cubeBackups.sizeBytes,
            name: cubeBackups.name,
          })
          .from(cubeBackups)
          .where(eq(cubeBackups.status, "complete"))
      : [];

  if (completeBackups.length > 0) {
    const backupsBySpace = new Map<string, typeof completeBackups>();
    for (const backup of completeBackups) {
      const existing = backupsBySpace.get(backup.spaceId) ?? [];
      existing.push(backup);
      backupsBySpace.set(backup.spaceId, existing);
    }

    for (const [bSpaceId, spaceBackups] of backupsBySpace) {
      try {
        let totalStorageCost = 0;
        const backupCosts: Array<{
          backupId: string;
          name: string;
          diskSizeGb: number;
          cost: number;
        }> = [];

        for (const backup of spaceBackups) {
          // Prefer the compressed `sizeBytes` (what the `.cube` actually
          // occupies on S3) over the original `diskSizeGb` (the uncompressed
          // rootfs). Falls back to `diskSizeGb` only when sizeBytes is not
          // recorded — e.g. legacy rows from before the size capture landed,
          // or a backup currently `creating`.
          const billedGb =
            backup.sizeBytes && backup.sizeBytes > 0
              ? backup.sizeBytes / 1024 ** 3
              : backup.diskSizeGb;
          const cost =
            Math.round(billedGb * backupRatePerGbPerHour * 10_000) / 10_000;
          totalStorageCost += cost;
          backupCosts.push({
            backupId: backup.id,
            name: backup.name,
            diskSizeGb: backup.diskSizeGb,
            cost,
          });
        }

        // Round total to 4 decimals to prevent floating-point accumulation
        totalStorageCost = Math.round(totalStorageCost * 10_000) / 10_000;
        if (totalStorageCost <= 0) {
          continue;
        }

        // Deduct from space credit balance atomically via the same overage
        // cascade the running-compute pass uses. Fix #1 from billing audit —
        // before this, backup storage clamped balance to 0 with Math.max and
        // silently dropped the refused amount, AND it never used the customer's
        // overage budget. Now: prepaid first, overage second, refused triggers
        // the same auto-sleep path as running-compute exhaustion.
        const backupTxResult = await db.transaction(async (tx) => {
          const [currentBSpace] = await tx
            .select({
              creditBalance: spaces.creditBalance,
              overageEnabled: spaces.overageEnabled,
              overageCapUsd: spaces.overageCapUsd,
              thisPeriodOverageUsd: spaces.thisPeriodOverageUsd,
              subscriptionStatus: spaces.subscriptionStatus,
            })
            .from(spaces)
            .where(eq(spaces.id, bSpaceId))
            .for("update")
            .limit(1);

          if (!currentBSpace) {
            return null;
          }

          const planRow = await getSpacePlanRowTx(tx, bSpaceId);
          const spaceOverrides = await getSpaceOverridesTx(tx, bSpaceId);
          const limits = effectiveLimits(planRow, spaceOverrides);

          const {
            result: backupCascade,
            overageEventId: backupOverageEventId,
          } = await applyOverageCascadeTx({
            tx,
            input: {
              space: {
                id: bSpaceId,
                creditBalance: currentBSpace.creditBalance ?? "0",
                allowOverage: limits.allowOverage,
                overageEnabled: currentBSpace.overageEnabled,
                overageCapUsd: currentBSpace.overageCapUsd,
                thisPeriodOverageUsd: currentBSpace.thisPeriodOverageUsd,
                subscriptionStatus: currentBSpace.subscriptionStatus,
              },
              totalCost: totalStorageCost,
            },
            billedAt: new Date(),
          });

          // Per-backup events record the PREPAID-funded portion (the cascade
          // wrote the overage_charge for fromOverage). Recording full cost here
          // too would double-count overage in "Total charged". Amounts are
          // unchanged when prepaid covers the tick; scaled to sum to fromPrepaid
          // otherwise; $0 rows dropped. See prepaidChargeSplit.
          const chargeableBackups = backupCosts.filter((bc) => bc.cost > 0);
          const backupPrepaid = prepaidChargeSplit(
            chargeableBackups.map((bc) => bc.cost),
            backupCascade.fromPrepaid,
            totalStorageCost
          );
          const backupRows = chargeableBackups
            .map((bc, i) => ({ bc, amount: backupPrepaid[i] }))
            .filter((r) => r.amount > 0)
            .map(({ bc, amount }) => ({
              spaceId: bSpaceId,
              amount: amount.toFixed(4),
              type: "backup_storage_charge" as const,
              description: `Backup storage: "${bc.name}" (${bc.diskSizeGb}GB disk @ $${backupRatePerGbPerMonth}/GB/mo)`,
            }));
          if (backupRows.length > 0) {
            await tx.insert(billingEvents).values(backupRows);
          }

          return {
            cascade: backupCascade,
            overageEventId: backupOverageEventId,
          };
        });

        if (!backupTxResult) {
          continue;
        }

        const { cascade: backupCascade, overageEventId: backupOverageEventId } =
          backupTxResult;

        if (backupOverageEventId) {
          await reportOverageEventNow(backupOverageEventId);
        }

        for (const bc of backupCosts) {
          if (bc.cost > 0) {
            audit({
              action: "billing.backup_storage_charge",
              category: "billing",
              actorType: "system",
              entityType: "space",
              entityId: bSpaceId,
              spaceId: bSpaceId,
              description: `Backup storage charge for "${bc.name}"`,
              metadata: {
                backupId: bc.backupId,
                amount: bc.cost.toFixed(4),
                diskSizeGb: bc.diskSizeGb,
              },
              source: "worker",
            });
          }
        }

        console.log(
          `[billing-hourly] backup storage space=${bSpaceId} charged=${totalStorageCost.toFixed(4)}`
        );

        // Check if backup storage billing refused funding — sleep running cubes.
        // Use `cascade.refused > 0` (matches the running-compute pattern) so a
        // balance of $0 covered entirely by overage does NOT auto-sleep.
        if (backupCascade.refused > 0) {
          console.log(
            `[billing-hourly] space ${bSpaceId} balance exhausted after backup billing, sleeping all Cubes`
          );

          const runningInSpace = await db
            .select({
              id: cubes.id,
              serverId: cubes.serverId,
            })
            .from(cubes)
            .where(
              and(eq(cubes.spaceId, bSpaceId), eq(cubes.status, "running"))
            );

          if (runningInSpace.length > 0) {
            // Mark all running Cubes for zero-balance sleep (uniform set — single batched update)
            await db
              .update(cubes)
              .set({ zeroBalanceSleep: true, updatedAt: new Date() })
              .where(
                inArray(
                  cubes.id,
                  runningInSpace.map((rc) => rc.id)
                )
              );

            // Enqueue sleep jobs in parallel (independent per cube)
            await Promise.all(
              runningInSpace.map((rc) =>
                enqueueJob(JOB_NAMES.CUBE_SLEEP, {
                  cubeId: rc.id,
                  spaceId: bSpaceId,
                  serverId: rc.serverId,
                })
              )
            );

            // Write lifecycle log for each Cube (single batched insert)
            await db.insert(lifecycleLogs).values(
              runningInSpace.map((rc) => ({
                entityType: "cube" as const,
                entityId: rc.id,
                message:
                  "Cube slept — insufficient credits (backup storage billing)",
              }))
            );

            await db.insert(lifecycleLogs).values({
              entityType: "space",
              entityId: bSpaceId,
              message:
                "All Cubes slept — credit balance exhausted by backup storage billing",
            });
          } else {
            // Mirror the sleep-storage pass at line ~1397: a backups-only
            // space that drains to zero with no running cubes must STILL get
            // a lifecycle log + email. Otherwise the customer is silent on
            // their own dashboard and S3 keeps charging the platform for the
            // unfunded backups until the customer notices.
            await db.insert(lifecycleLogs).values({
              entityType: "space",
              entityId: bSpaceId,
              message:
                "Credit balance exhausted by backup storage billing (no running Cubes to sleep)",
            });
          }

          // Always email on backup-storage zero-balance — regardless of
          // running-cube count (matches the sleep-storage pass's terminal-
          // email policy). The owner needs to know their backups are now
          // unfunded so they can top up or delete backups.
          try {
            const owner = await getSpaceOwner(bSpaceId);
            if (owner) {
              const spaceUrl = `${env.NEXT_PUBLIC_APP_URL}/${bSpaceId}/billing`;
              // Read the plan row to decide free-vs-paid for the CTA.
              const bPlan = await getSpacePlanRow(bSpaceId);
              const { html, text } = await zeroBalanceEmailTemplate({
                userName: owner.name,
                spaceName: owner.spaceName,
                pausedCubeCount: runningInSpace.length,
                spaceUrl,
                isFreePlan: Number.parseFloat(bPlan.priceUsd) <= 0,
              });
              await enqueueEmail({
                to: owner.email,
                subject:
                  runningInSpace.length > 0
                    ? `Cubes paused — ${owner.spaceName} credit balance exhausted`
                    : `Credit balance exhausted — ${owner.spaceName}`,
                html,
                text,
              });
            }
          } catch (emailErr) {
            console.error(
              `[billing-hourly] failed to send zero-balance email for space ${bSpaceId}:`,
              emailErr
            );
            audit({
              action: "billing.email_failure",
              category: "billing",
              actorType: "system",
              entityType: "space",
              entityId: bSpaceId,
              spaceId: bSpaceId,
              description:
                "CRITICAL: Failed to send zero-balance email (backup billing) — customer unaware cubes are paused",
              metadata: {
                error:
                  emailErr instanceof Error
                    ? emailErr.message
                    : String(emailErr),
              },
              source: "worker",
            });
          }
        }
      } catch (err) {
        console.error(
          `[billing-hourly] backup storage billing failed for space ${bSpaceId}:`,
          err
        );
        // Continue with next space — don't let one failure block all backup billing
      }
    }
  }

  // ─── Sleep storage billing (ALWAYS-ON) ───
  // A sleeping cube has released its host CPU + RAM (Firecracker paused or
  // killed) but its rootfs file still occupies real bytes on the bare-metal
  // host's disk. Sleep storage is billed at the SAME per-GB rate AND on the
  // SAME full diskLimitGb as the disk component of running compute —
  // running and sleeping cubes both occupy every allocated GB on the host.
  // Formula: DISK_RATE × diskLimitGb × tier_multiplier per hour.
  //
  // Single source of truth: `config/platform.ts` (DISK_RATE). There is no
  // operator-tunable per-installation override — setting DISK_RATE to 0
  // there is the only way to disable sleep-storage billing, and it disables
  // running-disk billing in lockstep (one knob, one truth).
  //
  // This pass covers EVERY sleeping cube every tick — including cubes that
  // were sleeping before this feature deployed. There is no start-time gate;
  // the moment a cube has `status='sleeping'` it joins the rotation. The
  // pass is independent of `lastBilledAt` (which stays null on sleeping
  // cubes — that flag is the running-compute clock only).
  //
  // Routed through the same `applyOverageCascadeTx` the running-compute
  // pass uses: prepaid first, then overage, with `refused` triggering the
  // zero-balance auto-sleep path. Customers with overage enabled have
  // their sleep-storage cost covered by overage if prepaid is empty.
  const sleepingCubes =
    rates.diskRate > 0
      ? await db
          .select({
            id: cubes.id,
            spaceId: cubes.spaceId,
            name: cubes.name,
            vcpus: cubes.vcpus,
            diskLimitGb: cubes.diskLimitGb,
          })
          .from(cubes)
          .where(eq(cubes.status, "sleeping"))
      : [];

  if (sleepingCubes.length > 0) {
    const cubesBySleepSpace = new Map<string, typeof sleepingCubes>();
    for (const cube of sleepingCubes) {
      const existing = cubesBySleepSpace.get(cube.spaceId) ?? [];
      existing.push(cube);
      cubesBySleepSpace.set(cube.spaceId, existing);
    }

    for (const [sSpaceId, spaceSleepingCubes] of cubesBySleepSpace) {
      try {
        let totalSleepCost = 0;
        const sleepCosts: Array<{
          cubeId: string;
          name: string;
          diskLimitGb: number;
          multiplier: number;
          cost: number;
        }> = [];

        // Per-cube cost = DISK_RATE × diskLimitGb × tier multiplier (NO
        // vCPU, NO RAM — Firecracker is paused/killed). Same formula as the
        // running-disk component — both running and sleeping cubes occupy
        // every allocated GB on the host.
        for (const cube of spaceSleepingCubes) {
          const multiplier = getTierMultiplier(cube.vcpus, tiers);
          const cost = calculateSleepHourlyCost(
            { diskLimitGb: cube.diskLimitGb },
            rates,
            multiplier
          );
          totalSleepCost += cost;
          sleepCosts.push({
            cubeId: cube.id,
            name: cube.name,
            diskLimitGb: cube.diskLimitGb,
            multiplier,
            cost,
          });
        }

        totalSleepCost = Math.round(totalSleepCost * 10_000) / 10_000;
        if (totalSleepCost <= 0) {
          continue;
        }

        const sleepTxResult = await db.transaction(async (tx) => {
          const [currentSSpace] = await tx
            .select({
              creditBalance: spaces.creditBalance,
              lowBalanceThreshold: spaces.lowBalanceThreshold,
              overageEnabled: spaces.overageEnabled,
              overageCapUsd: spaces.overageCapUsd,
              thisPeriodOverageUsd: spaces.thisPeriodOverageUsd,
              subscriptionStatus: spaces.subscriptionStatus,
            })
            .from(spaces)
            .where(eq(spaces.id, sSpaceId))
            .for("update")
            .limit(1);

          if (!currentSSpace) {
            return null;
          }

          const planRow = await getSpacePlanRowTx(tx, sSpaceId);
          const spaceOverrides = await getSpaceOverridesTx(tx, sSpaceId);
          const limits = effectiveLimits(planRow, spaceOverrides);

          const { result: sleepCascade, overageEventId: sleepOverageEventId } =
            await applyOverageCascadeTx({
              tx,
              input: {
                space: {
                  id: sSpaceId,
                  creditBalance: currentSSpace.creditBalance ?? "0",
                  allowOverage: limits.allowOverage,
                  overageEnabled: currentSSpace.overageEnabled,
                  overageCapUsd: currentSSpace.overageCapUsd,
                  thisPeriodOverageUsd: currentSSpace.thisPeriodOverageUsd,
                  subscriptionStatus: currentSSpace.subscriptionStatus,
                },
                totalCost: totalSleepCost,
              },
              billedAt: new Date(),
            });

          // Per-cube sleep_storage_charge events record the PREPAID-funded
          // portion (the cascade wrote the overage_charge for fromOverage).
          // Recording full cost here too would double-count overage in "Total
          // charged". Amounts are unchanged when prepaid covers the tick;
          // scaled to sum to fromPrepaid otherwise; $0 rows dropped. See
          // prepaidChargeSplit.
          const chargeableSleeps = sleepCosts.filter((sc) => sc.cost > 0);
          const sleepPrepaid = prepaidChargeSplit(
            chargeableSleeps.map((sc) => sc.cost),
            sleepCascade.fromPrepaid,
            totalSleepCost
          );
          const sleepRows = chargeableSleeps
            .map((sc, i) => ({ sc, amount: sleepPrepaid[i] }))
            .filter((r) => r.amount > 0)
            .map(({ sc, amount }) => ({
              spaceId: sSpaceId,
              cubeId: sc.cubeId,
              amount: amount.toFixed(4),
              type: "sleep_storage_charge" as const,
              // Rate display uses sc.multiplier so the per-hour figure matches
              // the cube's actual rate (the amount is the prepaid-funded share).
              description: `Sleep storage: "${sc.name}" (${sc.diskLimitGb}GB disk @ $${calculateSleepHourlyCost({ diskLimitGb: sc.diskLimitGb }, rates, sc.multiplier).toFixed(4)}/h${sc.multiplier < 1 ? `, ${sc.multiplier}x tier multiplier` : ""})`,
            }));
          if (sleepRows.length > 0) {
            await tx.insert(billingEvents).values(sleepRows);
          }

          return {
            cascade: sleepCascade,
            overageEventId: sleepOverageEventId,
            lowBalanceThreshold: currentSSpace.lowBalanceThreshold,
          };
        });

        if (!sleepTxResult) {
          continue;
        }

        const {
          cascade: sleepCascade,
          overageEventId: sleepOverageEventId,
          lowBalanceThreshold: sleepLowBalanceThreshold,
        } = sleepTxResult;

        // Post-commit: report sleep-storage overage to Polar's meter. Same
        // best-effort pattern as the running-compute pass — failure leaves
        // polar_meter_reported_at NULL for the reconcile cron to retry.
        if (sleepOverageEventId) {
          await reportOverageEventNow(sleepOverageEventId);
        }

        // Synthetic `updatedSSpace` shape so the downstream balance / email
        // logic stays identical to the pre-cascade structure.
        const updatedSSpace = {
          creditBalance: sleepCascade.newCreditBalance,
          lowBalanceThreshold: sleepLowBalanceThreshold,
        };

        for (const sc of sleepCosts) {
          if (sc.cost > 0) {
            audit({
              action: "billing.sleep_storage_charge",
              category: "billing",
              actorType: "system",
              entityType: "cube",
              entityId: sc.cubeId,
              spaceId: sSpaceId,
              description: `Sleep storage charge for "${sc.name}"`,
              metadata: {
                cubeId: sc.cubeId,
                amount: sc.cost.toFixed(4),
                diskLimitGb: sc.diskLimitGb,
              },
              source: "worker",
            });
          }
        }

        console.log(
          `[billing-hourly] sleep storage space=${sSpaceId} cubes=${spaceSleepingCubes.length} charged=${totalSleepCost.toFixed(4)}`
        );

        // Notification gates after the sleep-storage deduction. Two paths:
        //   - Zero balance: ALWAYS notify the owner and auto-sleep any
        //     sibling running cubes. The email fires even when no running
        //     cubes exist — a sleeping-cubes-only space that drains to zero
        //     would otherwise get silent and the rootfs would eventually be
        //     deleted by an oblivious customer.
        //   - Low balance (above zero, at-or-below threshold): notify the
        //     owner only when this space has NO running cubes. When running
        //     cubes exist the running-compute pass earlier in this tick has
        //     already handled the low-balance branch — emitting here too
        //     would double-email.
        // Both paths debounce via the shared `wasLowBalanceEmailRecentlySent`
        // /  `low-balance warning email sent` lifecycle marker for the
        // low-balance email (zero balance is a terminal event — no debounce).
        if (updatedSSpace) {
          const sleepNewBalance = Number.parseFloat(
            updatedSSpace.creditBalance
          );
          const sleepThreshold = Number.parseFloat(
            updatedSSpace.lowBalanceThreshold
          );

          const runningInSpace = await db
            .select({
              id: cubes.id,
              serverId: cubes.serverId,
            })
            .from(cubes)
            .where(
              and(eq(cubes.spaceId, sSpaceId), eq(cubes.status, "running"))
            );

          // Auto-sleep gate uses `cascade.refused > 0` — same trigger the
          // running-compute pass uses. A balance of $0 with overage covering
          // the whole cost (refused=0) must NOT auto-sleep; only true
          // under-funding (prepaid empty + overage cap hit or disabled)
          // should pause the customer's running cubes.
          if (sleepCascade.refused > 0) {
            console.log(
              `[billing-hourly] space ${sSpaceId} balance exhausted after sleep storage billing (${runningInSpace.length} running cube(s) will be slept)`
            );

            // Auto-sleep any remaining running cubes in the space. Skipped
            // when there are none — sleeping cubes don't have a further
            // state to drop into; the email below still fires.
            if (runningInSpace.length > 0) {
              await db
                .update(cubes)
                .set({ zeroBalanceSleep: true, updatedAt: new Date() })
                .where(
                  inArray(
                    cubes.id,
                    runningInSpace.map((rc) => rc.id)
                  )
                );

              await Promise.all(
                runningInSpace.map((rc) =>
                  enqueueJob(JOB_NAMES.CUBE_SLEEP, {
                    cubeId: rc.id,
                    spaceId: sSpaceId,
                    serverId: rc.serverId,
                  })
                )
              );

              await db.insert(lifecycleLogs).values(
                runningInSpace.map((rc) => ({
                  entityType: "cube" as const,
                  entityId: rc.id,
                  message:
                    "Cube slept — insufficient credits (sleep storage billing)",
                }))
              );

              await db.insert(lifecycleLogs).values({
                entityType: "space",
                entityId: sSpaceId,
                message:
                  "All Cubes slept — credit balance exhausted by sleep storage billing",
              });
            } else {
              await db.insert(lifecycleLogs).values({
                entityType: "space",
                entityId: sSpaceId,
                message:
                  "Credit balance exhausted by sleep storage billing (no running Cubes to sleep)",
              });
            }

            // Always email on zero — regardless of running-cube count.
            try {
              const owner = await getSpaceOwner(sSpaceId);
              if (owner) {
                const spaceUrl = `${env.NEXT_PUBLIC_APP_URL}/${sSpaceId}/billing`;
                const sPlan = await getSpacePlanRow(sSpaceId);
                const { html, text } = await zeroBalanceEmailTemplate({
                  userName: owner.name,
                  spaceName: owner.spaceName,
                  pausedCubeCount: runningInSpace.length,
                  spaceUrl,
                  isFreePlan: Number.parseFloat(sPlan.priceUsd) <= 0,
                });
                await enqueueEmail({
                  to: owner.email,
                  subject:
                    runningInSpace.length > 0
                      ? `Cubes paused — ${owner.spaceName} credit balance exhausted`
                      : `Credit balance exhausted — ${owner.spaceName}`,
                  html,
                  text,
                });
              }
            } catch (emailErr) {
              console.error(
                `[billing-hourly] failed to send zero-balance email for space ${sSpaceId}:`,
                emailErr
              );
              audit({
                action: "billing.email_failure",
                category: "billing",
                actorType: "system",
                entityType: "space",
                entityId: sSpaceId,
                spaceId: sSpaceId,
                description:
                  "CRITICAL: Failed to send zero-balance email (sleep storage billing) — customer unaware credit balance is exhausted",
                metadata: {
                  error:
                    emailErr instanceof Error
                      ? emailErr.message
                      : String(emailErr),
                },
                source: "worker",
              });
            }
          } else if (
            sleepNewBalance > 0 &&
            sleepNewBalance <= sleepThreshold &&
            // Skip when this space has running cubes — the running-compute
            // pass earlier in the tick has already handled the low-balance
            // path with the same debounce marker. Without this guard the
            // sleep-storage pass would double-send within the same hour.
            runningInSpace.length === 0
          ) {
            try {
              const alreadySent =
                await wasLowBalanceEmailRecentlySent(sSpaceId);
              if (!alreadySent) {
                const owner = await getSpaceOwner(sSpaceId);
                if (owner) {
                  const spaceUrl = `${env.NEXT_PUBLIC_APP_URL}/${sSpaceId}/billing`;
                  const sPlan = await getSpacePlanRow(sSpaceId);
                  const { html, text } = await lowBalanceEmailTemplate({
                    userName: owner.name,
                    spaceName: owner.spaceName,
                    currentBalance: sleepNewBalance.toFixed(2),
                    spaceUrl,
                    isFreePlan: Number.parseFloat(sPlan.priceUsd) <= 0,
                  });
                  await enqueueEmail({
                    to: owner.email,
                    subject: `Low credit balance warning — ${owner.spaceName}`,
                    html,
                    text,
                  });
                  await db.insert(lifecycleLogs).values({
                    entityType: "space",
                    entityId: sSpaceId,
                    message: "low-balance warning email sent",
                  });
                  audit({
                    action: "billing.low_balance_warning",
                    category: "billing",
                    actorType: "system",
                    entityType: "space",
                    entityId: sSpaceId,
                    spaceId: sSpaceId,
                    description: `Low balance warning (sleep-storage-only space): $${sleepNewBalance.toFixed(2)} remaining`,
                    metadata: {
                      spaceId: sSpaceId,
                      balance: sleepNewBalance.toFixed(2),
                    },
                    source: "worker",
                  });
                }
              }
            } catch (err) {
              console.error(
                `[billing-hourly] failed to send low-balance email for sleep-storage space ${sSpaceId}:`,
                err
              );
            }
          }
        }
      } catch (err) {
        console.error(
          `[billing-hourly] sleep storage billing failed for space ${sSpaceId}:`,
          err
        );
        // Continue with next space — don't let one failure block all sleep billing
      }
    }
  }

  console.log(
    `[billing-hourly] completed, processed ${cubesBySpace.size} spaces with ${runningCubes.length} Cubes`
  );
}
