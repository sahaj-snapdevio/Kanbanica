/**
 * Shared credit balance validation.
 *
 * Used by createCube, wakeCube, and redeployBackup actions to verify
 * a space has sufficient credits before provisioning a cube.
 */

import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  calculateHourlyCost,
  getCreditRates,
  getCreditRateTiers,
  getTierMultiplier,
} from "@/lib/cost";
import { db } from "@/lib/db";

export type CreditCheckResult =
  | { ok: true; hourlyCost: number }
  | { error: string; required?: number; available?: number };

/**
 * Check if a space has enough credits to run a cube with the given specs.
 * Loads current credit rates, calculates hourly cost, and compares against balance.
 */
export async function checkCreditBalance(
  spaceId: string,
  specs: { vcpus: number; ramMb: number; diskLimitGb: number }
): Promise<CreditCheckResult> {
  const rates = getCreditRates();
  const tiers = getCreditRateTiers();

  const multiplier = getTierMultiplier(specs.vcpus, tiers);
  const hourlyCost = calculateHourlyCost(specs, rates, multiplier);

  const [space] = await db
    .select({ creditBalance: schema.spaces.creditBalance })
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);

  if (!space) {
    return { error: "Space not found" };
  }

  const creditBalance = Number.parseFloat(space.creditBalance);
  if (creditBalance < hourlyCost) {
    return {
      error: "Insufficient credits",
      required: hourlyCost,
      available: creditBalance,
    };
  }

  return { ok: true, hourlyCost };
}
