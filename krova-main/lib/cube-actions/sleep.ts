import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import {
  actorAuditFields,
  actorSuffix,
  type CubeActionContext,
  type CubeActionResult,
} from "@/lib/cube-actions/types";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Shared business logic for `POST /cubes/[cubeId]/sleep`. Used by both the
 * dashboard route and the v1 API route. The route is responsible for auth,
 * rate limiting, permission/cube-access checks, and shaping the JSON response
 * — this handler owns the atomic state transition, lifecycle log, job
 * enqueue, and audit log.
 */
export async function sleepCubeAction(
  ctx: CubeActionContext
): Promise<CubeActionResult<{ cubeName: string }>> {
  const { spaceId, cubeId, actor, reqCtx } = ctx;

  const [cube] = await db
    .update(schema.cubes)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(schema.cubes.id, cubeId),
        eq(schema.cubes.spaceId, spaceId),
        eq(schema.cubes.status, "running")
      )
    )
    .returning();

  if (!cube) {
    const [existing] = await db
      .select({ status: schema.cubes.status })
      .from(schema.cubes)
      .where(
        and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId))
      )
      .limit(1);

    if (!existing) {
      return { ok: false, status: 404, error: "Cube not found" };
    }
    return {
      ok: false,
      status: 409,
      error: `Cube must be running to sleep. Current status: ${existing.status}`,
    };
  }

  const suffix = actorSuffix(actor);

  await db.insert(schema.lifecycleLogs).values({
    entityType: "cube",
    entityId: cubeId,
    message: `Cube sleep requested${suffix}`,
  });

  await enqueueJob(JOB_NAMES.CUBE_SLEEP, {
    cubeId,
    spaceId,
    serverId: cube.serverId,
  });

  const { actorId, actorEmail, metadataExtras } = actorAuditFields(actor);
  audit({
    action: "cube.sleep",
    category: "cube",
    actorType: "user",
    actorId,
    actorEmail,
    entityType: "cube",
    entityId: cubeId,
    spaceId,
    description: `Requested sleep for cube "${cube.name}"${suffix}`,
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
