import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { TcpPortMapping } from "@/db/schema/types";
import { audit } from "@/lib/audit";
import {
  actorAuditFields,
  type CubeActionContext,
  type CubeActionResult,
} from "@/lib/cube-actions/types";
import { db } from "@/lib/db";
import { allocatePort } from "@/lib/server/ports";
import { isValidCidr } from "@/lib/validators";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

const PORT_MIN = 1;
const PORT_MAX = 65_535;
const MAX_WHITELIST_ENTRIES = 500;

export type TcpMappingWithWhitelist = TcpPortMapping & {
  whitelistedIps: { id: string; cidr: string }[];
};

/**
 * Shared business logic for `GET /cubes/[cubeId]/tcp-mappings`.
 * Returns the raw mappings + grouped whitelist entries. Routes apply their
 * own wire format on top (dashboard returns array, v1 wraps + formats).
 */
export async function listTcpMappingsAction(
  ctx: Pick<CubeActionContext, "cubeId">
): Promise<TcpMappingWithWhitelist[]> {
  const mappings = await db
    .select()
    .from(schema.tcpPortMappings)
    .where(eq(schema.tcpPortMappings.cubeId, ctx.cubeId));

  const mappingIds = mappings.map((m) => m.id);
  const whitelistRows =
    mappingIds.length > 0
      ? await db
          .select()
          .from(schema.tcpMappingWhitelistedIps)
          .where(inArray(schema.tcpMappingWhitelistedIps.mappingId, mappingIds))
      : [];

  const ipsByMapping = new Map<string, { id: string; cidr: string }[]>();
  for (const w of whitelistRows) {
    const list = ipsByMapping.get(w.mappingId) ?? [];
    list.push({ id: w.id, cidr: w.cidr });
    ipsByMapping.set(w.mappingId, list);
  }

  return mappings.map((m) => ({
    ...m,
    whitelistedIps: ipsByMapping.get(m.id) ?? [],
  }));
}

export type AddTcpMappingInput = {
  cubePort: unknown;
  label: unknown;
  whitelistedIps: unknown;
};

/**
 * Shared business logic for `POST /cubes/[cubeId]/tcp-mappings`.
 * Audit log shape matches existing behavior for both dashboard and v1
 * (no " via API key" suffix, no apiKeyId metadata).
 */
export async function addTcpMappingAction(
  ctx: CubeActionContext,
  input: AddTcpMappingInput
): Promise<CubeActionResult<{ mapping: TcpMappingWithWhitelist }>> {
  const { spaceId, cubeId, actor, reqCtx } = ctx;
  const { cubePort, label, whitelistedIps } = input;

  if (
    !cubePort ||
    typeof cubePort !== "number" ||
    cubePort < PORT_MIN ||
    cubePort > PORT_MAX ||
    !Number.isInteger(cubePort)
  ) {
    return {
      ok: false,
      status: 400,
      error: "Port must be an integer between 1 and 65535",
    };
  }

  if (label !== undefined && label !== null && typeof label !== "string") {
    return { ok: false, status: 400, error: "Label must be a string" };
  }
  if (typeof label === "string" && label.length > 100) {
    return {
      ok: false,
      status: 400,
      error: "Label must be 100 characters or fewer",
    };
  }

  const cidrs: string[] = [];
  if (Array.isArray(whitelistedIps)) {
    if (whitelistedIps.length > MAX_WHITELIST_ENTRIES) {
      return {
        ok: false,
        status: 400,
        error: `Maximum ${MAX_WHITELIST_ENTRIES} whitelist entries allowed`,
      };
    }
    for (const ip of whitelistedIps) {
      if (typeof ip !== "string" || !isValidCidr(ip.trim())) {
        return {
          ok: false,
          status: 400,
          error: `Invalid IP or CIDR: ${ip}`,
        };
      }
      cidrs.push(ip.trim());
    }
  }

  const [cube] = await db
    .select()
    .from(schema.cubes)
    .where(and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId)))
    .limit(1);

  if (!cube) {
    return { ok: false, status: 404, error: "Cube not found" };
  }

  if (
    cube.status === "deleted" ||
    cube.status === "error" ||
    cube.status === "stopping"
  ) {
    return {
      ok: false,
      status: 422,
      error: `Cannot add TCP mapping to a cube that is ${cube.status}`,
    };
  }

  if (!cube.internalIp) {
    return {
      ok: false,
      status: 400,
      error: "Cube does not have an internal IP yet",
    };
  }

  const mappingId = createId();
  const trimmedLabel = typeof label === "string" ? label.trim() || null : null;

  type TxResult =
    | { kind: "error"; status: 409 | 503; error: string }
    | { kind: "ok"; hostPort: number; portEntryId: string };

  const txResult = await db.transaction(async (tx): Promise<TxResult> => {
    const [existing] = await tx
      .select({
        id: schema.tcpPortMappings.id,
        status: schema.tcpPortMappings.status,
      })
      .from(schema.tcpPortMappings)
      .where(
        and(
          eq(schema.tcpPortMappings.cubeId, cubeId),
          eq(schema.tcpPortMappings.cubePort, cubePort)
        )
      )
      .limit(1);

    if (existing) {
      if (existing.status === "pending" || existing.status === "active") {
        return {
          kind: "error",
          status: 409,
          error: `Port ${cubePort} is already mapped on this Cube`,
        };
      }
      await tx
        .delete(schema.tcpPortMappings)
        .where(eq(schema.tcpPortMappings.id, existing.id));
    }

    const portEntry = await allocatePort(tx, cube.serverId, cubeId, "tcp");
    if (!portEntry) {
      return {
        kind: "error",
        status: 503,
        error: "No host ports available on this server",
      };
    }

    const hostPort = portEntry.port;

    await tx.insert(schema.tcpPortMappings).values({
      id: mappingId,
      cubeId,
      cubePort,
      hostPort,
      allocatedPortId: portEntry.id,
      label: trimmedLabel,
      status: "pending",
    });

    if (cidrs.length > 0) {
      await tx
        .insert(schema.tcpMappingWhitelistedIps)
        .values(cidrs.map((cidr) => ({ mappingId, cidr })));
    }

    await tx.insert(schema.lifecycleLogs).values({
      entityType: "cube" as const,
      entityId: cubeId,
      message: `TCP port mapping added: port ${cubePort} → host port ${hostPort} (pending)`,
    });

    return { kind: "ok", hostPort, portEntryId: portEntry.id };
  });

  if (txResult.kind === "error") {
    return { ok: false, status: txResult.status, error: txResult.error };
  }

  await enqueueJob(JOB_NAMES.TCP_MAPPING_ADD, {
    mappingId,
    cubeId,
    serverId: cube.serverId,
    cubePort,
    hostPort: txResult.hostPort,
    cubeInternalIp: cube.internalIp,
    whitelistedCidrs: cidrs,
  });

  const [mapping] = await db
    .select()
    .from(schema.tcpPortMappings)
    .where(eq(schema.tcpPortMappings.id, mappingId))
    .limit(1);

  const whitelistEntries = await db
    .select()
    .from(schema.tcpMappingWhitelistedIps)
    .where(eq(schema.tcpMappingWhitelistedIps.mappingId, mappingId));

  const { actorId, actorEmail } = actorAuditFields(actor);
  audit({
    action: "tcp_mapping.add",
    category: "tcp_mapping",
    actorType: "user",
    actorId,
    actorEmail,
    entityType: "tcp_mapping",
    entityId: mappingId,
    spaceId,
    description: `Added TCP mapping port ${cubePort} to cube`,
    metadata: { cubePort, hostPort: txResult.hostPort, cubeId },
    source: "api",
    ...reqCtx,
  });

  if (!mapping) {
    return { ok: false, status: 500, error: "Internal server error" };
  }

  return {
    ok: true,
    data: {
      mapping: {
        ...mapping,
        whitelistedIps: whitelistEntries.map((w) => ({
          id: w.id,
          cidr: w.cidr,
        })),
      },
    },
  };
}

/**
 * Shared business logic for `DELETE /cubes/[cubeId]/tcp-mappings/[mappingId]`.
 */
export async function removeTcpMappingAction(
  ctx: CubeActionContext & { mappingId: string }
): Promise<CubeActionResult<{ hostPort: number }>> {
  const { spaceId, cubeId, mappingId, actor, reqCtx } = ctx;

  const [mapping] = await db
    .select()
    .from(schema.tcpPortMappings)
    .where(
      and(
        eq(schema.tcpPortMappings.id, mappingId),
        eq(schema.tcpPortMappings.cubeId, cubeId)
      )
    )
    .limit(1);

  if (!mapping) {
    return { ok: false, status: 404, error: "TCP port mapping not found" };
  }

  if (mapping.isSsh) {
    return {
      ok: false,
      status: 400,
      error: "SSH port mapping cannot be removed",
    };
  }

  if (mapping.status === "stopping") {
    return {
      ok: false,
      status: 409,
      error: "TCP port mapping is already being removed",
    };
  }

  const [cube] = await db
    .select()
    .from(schema.cubes)
    .where(and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId)))
    .limit(1);

  if (!cube) {
    return { ok: false, status: 404, error: "Cube not found" };
  }

  if (!cube.internalIp) {
    return {
      ok: false,
      status: 400,
      error: "Cube does not have an internal IP",
    };
  }

  await db
    .update(schema.tcpPortMappings)
    .set({ status: "stopping", updatedAt: new Date() })
    .where(eq(schema.tcpPortMappings.id, mappingId));

  try {
    await enqueueJob(JOB_NAMES.TCP_MAPPING_REMOVE, {
      mappingId,
      cubeId,
      serverId: cube.serverId,
      hostPort: mapping.hostPort,
      cubeInternalIp: cube.internalIp,
    });
  } catch (enqueueErr) {
    await db
      .update(schema.tcpPortMappings)
      .set({ status: mapping.status, updatedAt: new Date() })
      .where(eq(schema.tcpPortMappings.id, mappingId))
      .catch(() => {});
    console.error("[tcp-mapping-remove] failed to enqueue job:", enqueueErr);
    return {
      ok: false,
      status: 500,
      error: "Failed to schedule TCP mapping removal. Please try again.",
    };
  }

  await db.insert(schema.lifecycleLogs).values({
    entityType: "cube" as const,
    entityId: cubeId,
    message: `TCP port mapping removal initiated: host port ${mapping.hostPort}`,
  });

  const { actorId, actorEmail } = actorAuditFields(actor);
  audit({
    action: "tcp_mapping.remove",
    category: "tcp_mapping",
    actorType: "user",
    actorId,
    actorEmail,
    entityType: "tcp_mapping",
    entityId: mappingId,
    spaceId,
    description: `Removed TCP mapping host port ${mapping.hostPort} from cube`,
    metadata: {
      cubePort: mapping.cubePort,
      hostPort: mapping.hostPort,
      cubeId,
      mappingId,
    },
    source: "api",
    ...reqCtx,
  });

  return { ok: true, data: { hostPort: mapping.hostPort } };
}
