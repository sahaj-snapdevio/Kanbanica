import { and, eq, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Cube } from "@/db/schema/types";
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
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export type CubeDetailData = {
  cube: Cube;
  server: { hostname: string; publicIp: string } | null;
  costPerHour: number;
};

/**
 * Shared cube detail fetch: cube row + minimal server fields + hourly cost.
 * Routes layer their own extras on top — the dashboard GET also fetches
 * lifecycle logs + domain mappings inline (still routes-only because they
 * inflate the response only for the dashboard).
 */
export async function getCubeDetailAction(
  ctx: Pick<CubeActionContext, "spaceId" | "cubeId">
): Promise<CubeActionResult<CubeDetailData>> {
  const { spaceId, cubeId } = ctx;

  const [cube] = await db
    .select()
    .from(schema.cubes)
    .where(and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId)))
    .limit(1);

  if (!cube) {
    return { ok: false, status: 404, error: "Cube not found" };
  }

  const [server] = await db
    .select({
      hostname: schema.servers.hostname,
      publicIp: schema.servers.publicIp,
    })
    .from(schema.servers)
    .where(eq(schema.servers.id, cube.serverId))
    .limit(1);

  const [rates, tiers] = await Promise.all([
    getCreditRates(),
    getCreditRateTiers(),
  ]);
  const costPerHour = rates
    ? calculateHourlyCost(
        {
          vcpus: cube.vcpus,
          ramMb: cube.ramMb,
          diskLimitGb: cube.diskLimitGb,
        },
        rates,
        getTierMultiplier(cube.vcpus, tiers)
      )
    : 0;

  return {
    ok: true,
    data: { cube, server: server ?? null, costPerHour },
  };
}

/**
 * Shared business logic for `DELETE /cubes/[cubeId]`.
 *
 * `rejectDuringBoot` controls whether `pending` and `booting` statuses are
 * allowed. The dashboard route passes `true` — refuses with a 409 carrying
 * "Cannot delete a Cube while it is being deployed" so the UI shows a
 * helpful message. The v1 route passes `false` — historically allowed the
 * delete through (which then races the boot handler and can double-clean
 * server resources). Preserved per-route to avoid changing the v1 API
 * contract; the v1 behavior is best treated as a latent bug to address
 * separately rather than as a behavior change inside this refactor.
 */
export async function deleteCubeAction(
  ctx: CubeActionContext,
  options: { rejectDuringBoot: boolean }
): Promise<CubeActionResult<{ cubeName: string }>> {
  const { spaceId, cubeId, actor, reqCtx } = ctx;

  // Refuse delete while a snapshot is being created — `cube.transfer` /
  // `snapshot.create` is reading the live rootfs.ext4, and a delete would
  // `rm -rf` the cube dir out from under it (a restore sets `stopping`, already
  // refused by the claim below). This + the transferState gate were enforced
  // only in the dashboard server action; the REST routes (which call THIS
  // shared action) bypassed them — a customer API DELETE could rm -rf a cube
  // mid-transfer / mid-snapshot (2026-05-31 audit HIGH). Mirrors
  // app/actions/cubes.ts.
  const [inFlightSnapshot] = await db
    .select({ id: schema.cubeSnapshots.id })
    .from(schema.cubeSnapshots)
    .where(
      and(
        eq(schema.cubeSnapshots.cubeId, cubeId),
        eq(schema.cubeSnapshots.status, "creating")
      )
    )
    .limit(1);
  if (inFlightSnapshot) {
    return {
      ok: false,
      status: 409,
      error:
        "A snapshot is currently being created for this Cube. Wait for it to finish before deleting.",
    };
  }

  const conditions = [
    eq(schema.cubes.id, cubeId),
    eq(schema.cubes.spaceId, spaceId),
    ne(schema.cubes.status, "deleted"),
    ne(schema.cubes.status, "stopping"),
    // Refuse delete mid cross-server transfer: `cube.transfer` is copying
    // rootfs.ext4 while keeping status `running`/`sleeping`, so this guard is
    // separate from the status checks above.
    eq(schema.cubes.transferState, "idle"),
  ];
  if (options.rejectDuringBoot) {
    conditions.push(ne(schema.cubes.status, "pending"));
    conditions.push(ne(schema.cubes.status, "booting"));
  }

  const [cube] = await db
    .update(schema.cubes)
    .set({ status: "stopping", updatedAt: new Date() })
    .where(and(...conditions))
    .returning();

  if (!cube) {
    const [existing] = await db
      .select({
        status: schema.cubes.status,
        transferState: schema.cubes.transferState,
      })
      .from(schema.cubes)
      .where(
        and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId))
      )
      .limit(1);

    if (!existing) {
      return { ok: false, status: 404, error: "Cube not found" };
    }
    if (existing.transferState !== "idle") {
      return {
        ok: false,
        status: 409,
        error:
          "This Cube is being transferred between servers. Try again once the transfer completes.",
      };
    }
    if (
      options.rejectDuringBoot &&
      (existing.status === "pending" || existing.status === "booting")
    ) {
      return {
        ok: false,
        status: 409,
        error:
          "Cannot delete a Cube while it is being deployed. Wait for it to finish booting.",
      };
    }
    return {
      ok: false,
      status: 409,
      error: `Cube is already ${existing.status === "deleted" ? "deleted" : "being stopped"}`,
    };
  }

  const suffix = actorSuffix(actor);

  await db.insert(schema.lifecycleLogs).values({
    entityType: "cube",
    entityId: cubeId,
    message: `Cube deletion requested${suffix}`,
  });

  await enqueueJob(JOB_NAMES.CUBE_DELETE, {
    cubeId,
    spaceId,
    serverId: cube.serverId,
  });

  const { actorId, actorEmail, metadataExtras } = actorAuditFields(actor);
  audit({
    action: "cube.delete",
    category: "cube",
    actorType: "user",
    actorId,
    actorEmail,
    entityType: "cube",
    entityId: cubeId,
    spaceId,
    description: `Requested deletion of cube "${cube.name}"${suffix}`,
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
