import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import {
  calculateHourlyCost,
  getCreditRates,
  getCreditRateTiers,
  getTierMultiplier,
} from "@/lib/cost";
import {
  actorAuditFields,
  actorSuffix,
  type CubeActionContext,
  type CubeActionResult,
} from "@/lib/cube-actions/types";
import { db } from "@/lib/db";
import { assertCanWakeCubeV2, effectiveLimits } from "@/lib/plan/limits";
import {
  acquireSpaceLock,
  countActiveCubesTx,
  getSpaceOverrides,
  getSpacePlanRow,
} from "@/lib/plan/usage";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Shared business logic for `POST /cubes/[cubeId]/wake`. Used by both the
 * dashboard route and the v1 API route. Plan-tier enforcement + credit
 * balance check run inside a per-space advisory lock to serialize against
 * concurrent wake/create.
 */
export async function wakeCubeAction(
  ctx: CubeActionContext
): Promise<CubeActionResult<{ cubeName: string }>> {
  const { spaceId, cubeId, actor, reqCtx } = ctx;

  const [cubeRead] = await db
    .select()
    .from(schema.cubes)
    .where(and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId)))
    .limit(1);

  if (!cubeRead) {
    return { ok: false, status: 404, error: "Cube not found" };
  }

  if (cubeRead.status !== "sleeping") {
    return {
      ok: false,
      status: 409,
      error: `Cube must be sleeping to wake. Current status: ${cubeRead.status}`,
    };
  }

  const [rates, tiers] = await Promise.all([
    getCreditRates(),
    getCreditRateTiers(),
  ]);
  if (!rates) {
    return {
      ok: false,
      status: 500,
      error: "Credit rate configuration not found",
    };
  }

  const multiplier = getTierMultiplier(cubeRead.vcpus, tiers);
  const hourlyCost = calculateHourlyCost(
    {
      vcpus: cubeRead.vcpus,
      ramMb: cubeRead.ramMb,
      diskLimitGb: cubeRead.diskLimitGb,
    },
    rates,
    multiplier
  );

  const [planRow, spaceOverrides] = await Promise.all([
    getSpacePlanRow(spaceId),
    getSpaceOverrides(spaceId),
  ]);
  const limits = effectiveLimits(planRow, spaceOverrides);

  // Single transaction: advisory lock (serializes per-space wake/create) →
  // count active Cubes → plan check → credit check → atomic sleeping→claimed
  // update. Concurrent wake/create for this space block on the lock.
  type TxFailure = {
    status: 403 | 404 | 409 | 422;
    error: string;
    errorMeta?: Record<string, unknown>;
  };

  let txFailure: TxFailure | null = null;

  const cube = await db.transaction(async (tx) => {
    await acquireSpaceLock(tx, spaceId);

    const activeCubes = await countActiveCubesTx(tx, spaceId);
    const planCheck = assertCanWakeCubeV2(limits, activeCubes);
    if (!planCheck.ok) {
      txFailure = { status: 403, error: planCheck.error };
      return null;
    }

    const [space] = await tx
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .for("update")
      .limit(1);

    if (!space) {
      txFailure = { status: 404, error: "Space not found" };
      return null;
    }

    const creditBalance = Number.parseFloat(space.creditBalance);
    if (creditBalance < hourlyCost) {
      txFailure = {
        status: 422,
        error: "Insufficient credits to wake Cube",
        errorMeta: { required: hourlyCost, available: creditBalance },
      };
      return null;
    }

    const [claimed] = await tx
      .update(schema.cubes)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(schema.cubes.id, cubeId),
          eq(schema.cubes.spaceId, spaceId),
          eq(schema.cubes.status, "sleeping")
        )
      )
      .returning();

    if (!claimed) {
      txFailure = {
        status: 409,
        error:
          "Cube is no longer sleeping — it may have been modified by another operation",
      };
      return null;
    }

    return claimed;
  });

  if (txFailure) {
    return { ok: false, ...(txFailure as TxFailure) };
  }
  if (!cube) {
    // Defensive: should be unreachable since txFailure would have been set.
    return {
      ok: false,
      status: 500,
      error: "Internal server error",
    };
  }

  const suffix = actorSuffix(actor);

  await db.insert(schema.lifecycleLogs).values({
    entityType: "cube",
    entityId: cubeId,
    message: `Cube wake requested${suffix}`,
  });

  await enqueueJob(JOB_NAMES.CUBE_WAKE, {
    cubeId,
    spaceId,
    serverId: cube.serverId,
  });

  const { actorId, actorEmail, metadataExtras } = actorAuditFields(actor);
  audit({
    action: "cube.wake",
    category: "cube",
    actorType: "user",
    actorId,
    actorEmail,
    entityType: "cube",
    entityId: cubeId,
    spaceId,
    description: `Requested wake for cube "${cube.name}"${suffix}`,
    metadata: {
      cubeName: cube.name,
      serverId: cube.serverId,
      ...metadataExtras,
    },
    source: "api",
    ...reqCtx,
  });

  return { ok: true, data: { cubeName: cube.name } };
}
