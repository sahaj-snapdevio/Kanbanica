import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { applyRateLimit, RATE_LIMIT_MUTATION } from "@/lib/rate-limit";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Toggle exposure of a TCP mapping at the iptables level without removing
 * the mapping record. Currently restricted to SSH mappings — other TCP
 * ports use the existing DELETE flow.
 *
 * Body: { enabled: boolean }
 *   enabled=false → enqueue tcp-mapping.disable (removes iptables rule,
 *                   keeps row + allocated port + whitelist)
 *   enabled=true  → enqueue tcp-mapping.enable  (re-adds iptables rule
 *                   with the stored whitelist)
 */
export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ spaceId: string; cubeId: string; mappingId: string }>;
  }
) {
  const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
  if (limited) {
    return limited;
  }

  try {
    const { spaceId, cubeId, mappingId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const body = await request.json();
    if (typeof body?.enabled !== "boolean") {
      return Response.json(
        { error: "Body must be { enabled: boolean }" },
        { status: 400 }
      );
    }
    const enabled = body.enabled as boolean;

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
      return Response.json(
        { error: "TCP port mapping not found" },
        { status: 404 }
      );
    }

    if (!mapping.isSsh) {
      return Response.json(
        {
          error:
            "Exposure toggle is only supported for the SSH mapping. Remove and recreate other TCP mappings.",
        },
        { status: 400 }
      );
    }

    if (enabled && mapping.status === "active") {
      return Response.json({ success: true, status: mapping.status });
    }
    if (!enabled && mapping.status === "disabled") {
      return Response.json({ success: true, status: mapping.status });
    }

    if (enabled && mapping.status !== "disabled") {
      return Response.json(
        {
          error: `Cannot enable SSH from status "${mapping.status}". Wait for the current operation to finish.`,
        },
        { status: 409 }
      );
    }
    if (!enabled && mapping.status !== "active") {
      return Response.json(
        {
          error: `Cannot disable SSH from status "${mapping.status}". Wait for the current operation to finish.`,
        },
        { status: 409 }
      );
    }

    const [cube] = await db
      .select()
      .from(schema.cubes)
      .where(
        and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId))
      )
      .limit(1);

    if (!cube?.internalIp) {
      return Response.json(
        { error: "Cube not found or has no internal IP" },
        { status: 400 }
      );
    }

    const payload = {
      mappingId,
      cubeId,
      spaceId,
      serverId: cube.serverId,
      hostPort: mapping.hostPort,
      cubePort: mapping.cubePort,
      cubeInternalIp: cube.internalIp,
      actorId: session.user.id,
      actorEmail: session.user.email,
    };

    try {
      await enqueueJob(
        enabled ? JOB_NAMES.TCP_MAPPING_ENABLE : JOB_NAMES.TCP_MAPPING_DISABLE,
        payload
      );
    } catch (enqueueErr) {
      console.error(
        `[tcp-mapping-exposure] failed to enqueue ${enabled ? "enable" : "disable"} job:`,
        enqueueErr
      );
      return Response.json(
        { error: "Failed to schedule exposure change. Please try again." },
        { status: 500 }
      );
    }

    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube" as const,
      entityId: cubeId,
      message: enabled
        ? `SSH access enable requested (host port ${mapping.hostPort})`
        : `SSH access disable requested (host port ${mapping.hostPort})`,
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: enabled ? "tcp_mapping.ssh_enable" : "tcp_mapping.ssh_disable",
      category: "tcp_mapping",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "tcp_mapping",
      entityId: mappingId,
      spaceId,
      description: enabled
        ? `SSH exposure enable requested on host port ${mapping.hostPort}`
        : `SSH exposure disable requested on host port ${mapping.hostPort}`,
      metadata: {
        cubeId,
        mappingId,
        hostPort: mapping.hostPort,
        cubePort: mapping.cubePort,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST tcp-mapping exposure error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
