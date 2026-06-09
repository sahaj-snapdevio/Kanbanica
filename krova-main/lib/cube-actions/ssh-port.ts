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
 * Shared business logic for `PUT /cubes/[cubeId]/ssh-port`. The cube's SSH
 * mapping is a platform-managed singleton; this endpoint atomically swaps
 * the cube-side port (the host port is unchanged), flips the mapping row
 * to `pending`, and hands off to the `tcp-mapping.update-cube-port` worker.
 *
 * Lifecycle log + audit description carry a " via API" suffix (note: NOT
 * " via API key", to match the existing v1 route's wording exactly).
 */
export async function updateSshPortAction(
  ctx: CubeActionContext,
  input: { cubePort: unknown }
): Promise<CubeActionResult<{ cubePort: number }>> {
  const { spaceId, cubeId, actor, reqCtx } = ctx;

  const newCubePort = Number(input.cubePort);

  if (
    !Number.isInteger(newCubePort) ||
    newCubePort < 1 ||
    newCubePort > 65_535
  ) {
    return {
      ok: false,
      status: 400,
      error: "cubePort must be an integer between 1 and 65535",
    };
  }

  const [mapping] = await db
    .select()
    .from(schema.tcpPortMappings)
    .where(
      and(
        eq(schema.tcpPortMappings.cubeId, cubeId),
        eq(schema.tcpPortMappings.isSsh, true)
      )
    )
    .limit(1);

  if (!mapping) {
    return {
      ok: false,
      status: 404,
      error: "SSH mapping not found for this cube",
    };
  }

  if (mapping.cubePort === newCubePort) {
    return { ok: true, data: { cubePort: newCubePort } };
  }

  if (mapping.status === "pending" || mapping.status === "stopping") {
    return {
      ok: false,
      status: 409,
      error:
        "An SSH port change is already in progress on this cube. Retry in a moment.",
    };
  }

  const [collision] = await db
    .select({ id: schema.tcpPortMappings.id })
    .from(schema.tcpPortMappings)
    .where(
      and(
        eq(schema.tcpPortMappings.cubeId, cubeId),
        eq(schema.tcpPortMappings.cubePort, newCubePort)
      )
    )
    .limit(1);
  if (collision && collision.id !== mapping.id) {
    return {
      ok: false,
      status: 409,
      error: `Cube port ${newCubePort} is already used by another TCP mapping on this cube.`,
    };
  }

  const [cube] = await db
    .select()
    .from(schema.cubes)
    .where(and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId)))
    .limit(1);

  if (!cube?.internalIp) {
    return {
      ok: false,
      status: 400,
      error: "Cube not found or has no internal IP",
    };
  }

  const whitelistRows = await db
    .select({ cidr: schema.tcpMappingWhitelistedIps.cidr })
    .from(schema.tcpMappingWhitelistedIps)
    .where(eq(schema.tcpMappingWhitelistedIps.mappingId, mapping.id));
  const whitelistedCidrs = whitelistRows.map((r) => r.cidr);

  await db
    .update(schema.tcpPortMappings)
    .set({ status: "pending", updatedAt: new Date() })
    .where(eq(schema.tcpPortMappings.id, mapping.id));

  const { actorId, actorEmail } = actorAuditFields(actor);

  try {
    await enqueueJob(
      JOB_NAMES.TCP_MAPPING_UPDATE_CUBE_PORT,
      {
        mappingId: mapping.id,
        cubeId,
        spaceId,
        serverId: cube.serverId,
        hostPort: mapping.hostPort,
        cubeInternalIp: cube.internalIp,
        oldCubePort: mapping.cubePort,
        newCubePort,
        whitelistedCidrs,
        actorId,
        actorEmail,
      },
      { singletonKey: `tcp-mapping.update-cube-port:${mapping.id}` }
    );
  } catch (enqueueErr) {
    await db
      .update(schema.tcpPortMappings)
      .set({ status: mapping.status, updatedAt: new Date() })
      .where(eq(schema.tcpPortMappings.id, mapping.id))
      .catch(() => {});
    console.error(
      "[ssh-port.update] failed to enqueue update-cube-port job:",
      enqueueErr
    );
    return {
      ok: false,
      status: 500,
      error: "Failed to schedule SSH port change. Please try again.",
    };
  }

  const suffix = actorSuffix(actor, "API");

  await db.insert(schema.lifecycleLogs).values({
    entityType: "cube" as const,
    entityId: cubeId,
    message: `SSH port change requested${suffix}: ${mapping.cubePort} → ${newCubePort}`,
  });

  audit({
    action: "ssh_port.update_requested",
    category: "tcp_mapping",
    actorType: "user",
    actorId,
    actorEmail,
    entityType: "tcp_mapping",
    entityId: mapping.id,
    spaceId,
    description: `SSH port change requested${suffix}: ${mapping.cubePort} → ${newCubePort}`,
    metadata: {
      oldCubePort: mapping.cubePort,
      newCubePort,
      hostPort: mapping.hostPort,
      cubeId,
    },
    source: "api",
    ...reqCtx,
  });

  return { ok: true, data: { cubePort: newCubePort } };
}
