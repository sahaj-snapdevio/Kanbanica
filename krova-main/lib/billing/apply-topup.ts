/**
 * The single credit-apply code path — used by the Orbit admin grant route and
 * (Phase 2B) the Polar top-up webhook.
 *
 * Runs INSIDE the caller's transaction. Locks the space row, increments the
 * balance, writes a billing_events ledger row, and — if the prior balance was
 * ≤ 0 — clears `zeroBalanceSleep` on the space's slept cubes and returns their
 * ids. The caller enqueues `cube.wake` for those ids AFTER the transaction
 * commits. The helper never enqueues jobs itself.
 */
import { createId } from "@paralleldrive/cuid2";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { db } from "@/lib/db";
import { effectiveLimits } from "@/lib/plan/limits";
import { getSpaceOverridesTx, getSpacePlanRowTx } from "@/lib/plan/usage";

/** A Drizzle transaction handle — the arg passed to `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface ApplyCreditTopupInput {
  /** Positive USD amount to add to the balance. */
  amount: number;
  /** Human-readable ledger description. */
  description: string;
  spaceId: string;
  tx: Tx;
  /** Ledger event type — `credit_grant` for admin grants, `credit_topup` for purchases, `plan_credit` for plan grants. */
  type: "credit_grant" | "credit_topup" | "plan_credit";
}

export interface ApplyCreditTopupResult {
  /** The space's balance after the increment. */
  newBalance: number;
  /** True if the balance was ≤ 0 before this top-up. */
  priorBalanceWasZeroOrLess: boolean;
  /** Cube ids that were sleeping on a zero balance and should now be woken. */
  wakeCubeIds: string[];
}

/**
 * Apply a credit top-up to a space. Returns `null` if the space row does not
 * exist (the caller decides how to handle a missing space).
 */
export async function applyCreditTopup(
  input: ApplyCreditTopupInput
): Promise<ApplyCreditTopupResult | null> {
  const { tx, spaceId, amount, type, description } = input;

  const [space] = await tx
    .select({ creditBalance: schema.spaces.creditBalance })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .for("update")
    .limit(1);

  if (!space) {
    return null;
  }

  const priorBalance = Number.parseFloat(space.creditBalance);
  const priorBalanceWasZeroOrLess = priorBalance <= 0;
  const newBalance = priorBalance + amount;

  await tx
    .update(schema.spaces)
    .set({ creditBalance: newBalance.toFixed(4), updatedAt: new Date() })
    .where(eq(schema.spaces.id, spaceId));

  await tx.insert(schema.billingEvents).values({
    id: createId(),
    spaceId,
    amount: amount.toFixed(4),
    type,
    description,
  });

  let wakeCubeIds: string[] = [];
  if (priorBalanceWasZeroOrLess) {
    // The full zero-balance-slept set, most-recently-started first — the wake
    // cap below keeps the most-recently-used cubes.
    const sleepingCubes = await tx
      .select({ id: schema.cubes.id })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.spaceId, spaceId),
          eq(schema.cubes.zeroBalanceSleep, true)
        )
      )
      .orderBy(desc(schema.cubes.lastStartedAt));
    const sleptCubeIds = sleepingCubes.map((c) => c.id);

    // Plan-aware: never auto-wake beyond the space's effective concurrent-Cube
    // cap (plan default merged with any per-space override). Count cubes
    // already running, wake only up to the remaining headroom,
    // most-recently-started first; leave the rest slept (with zeroBalanceSleep
    // still true so a later credit event can wake them).
    const planRow = await getSpacePlanRowTx(tx, spaceId);
    const spaceOverrides = await getSpaceOverridesTx(tx, spaceId);
    const cap = effectiveLimits(planRow, spaceOverrides).maxConcurrentCubes;
    if (cap === null) {
      wakeCubeIds = sleptCubeIds;
    } else {
      const [runningRow] = await tx
        .select({ n: count() })
        .from(schema.cubes)
        .where(
          and(
            eq(schema.cubes.spaceId, spaceId),
            // Count every status that occupies a concurrent slot — matching
            // countActiveCubesTx. Counting only "running" would let the
            // auto-wake push the space past the cap when a cube is mid-boot.
            inArray(schema.cubes.status, ["pending", "booting", "running"])
          )
        );
      const headroom = Math.max(0, cap - Number(runningRow?.n ?? 0));
      wakeCubeIds = sleptCubeIds.slice(0, headroom);
    }

    // Clear zeroBalanceSleep ONLY for the cubes being woken — cubes left
    // slept keep the flag so a later credit event can wake them.
    if (wakeCubeIds.length > 0) {
      await tx
        .update(schema.cubes)
        .set({ zeroBalanceSleep: false, updatedAt: new Date() })
        .where(inArray(schema.cubes.id, wakeCubeIds));
    }
  }

  return { newBalance, priorBalanceWasZeroOrLess, wakeCubeIds };
}
