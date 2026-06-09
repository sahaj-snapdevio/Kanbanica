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
import { isValidCidr } from "@/lib/validators";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/** PUT: Replace entire whitelist */
export async function PUT(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ spaceId: string; cubeId: string; mappingId: string }>;
  }
) {
  try {
    const { spaceId, cubeId, mappingId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const body = await request.json();
    const { whitelistedIps } = body;

    if (!Array.isArray(whitelistedIps)) {
      return Response.json(
        { error: "whitelistedIps must be an array" },
        { status: 400 }
      );
    }

    const MAX_WHITELIST_ENTRIES = 500;
    if (whitelistedIps.length > MAX_WHITELIST_ENTRIES) {
      return Response.json(
        { error: `Maximum ${MAX_WHITELIST_ENTRIES} whitelist entries allowed` },
        { status: 400 }
      );
    }

    const cidrs: string[] = [];
    for (const ip of whitelistedIps) {
      if (typeof ip !== "string" || !isValidCidr(ip.trim())) {
        return Response.json(
          { error: `Invalid IP or CIDR: ${ip}` },
          { status: 400 }
        );
      }
      cidrs.push(ip.trim());
    }

    // Load mapping
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

    if (mapping.status !== "active") {
      return Response.json(
        { error: "Can only update whitelist on active mappings" },
        { status: 400 }
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
      return Response.json({ error: "Cube not found" }, { status: 404 });
    }

    // Replace whitelist entries in DB
    await db
      .delete(schema.tcpMappingWhitelistedIps)
      .where(eq(schema.tcpMappingWhitelistedIps.mappingId, mappingId));

    if (cidrs.length > 0) {
      await db.insert(schema.tcpMappingWhitelistedIps).values(
        cidrs.map((cidr) => ({
          mappingId,
          cidr,
        }))
      );
    }

    // Enqueue job to update iptables
    await enqueueJob(JOB_NAMES.TCP_MAPPING_UPDATE_WHITELIST, {
      mappingId,
      cubeId,
      serverId: cube.serverId,
      hostPort: mapping.hostPort,
      cubePort: mapping.cubePort,
      cubeInternalIp: cube.internalIp,
      whitelistedCidrs: cidrs,
    });

    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube" as const,
      entityId: cubeId,
      message:
        cidrs.length > 0
          ? `TCP port ${mapping.hostPort} whitelist updated: ${cidrs.join(", ")}`
          : `TCP port ${mapping.hostPort} whitelist cleared`,
    });

    // Return updated whitelist
    const entries = await db
      .select()
      .from(schema.tcpMappingWhitelistedIps)
      .where(eq(schema.tcpMappingWhitelistedIps.mappingId, mappingId));

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "tcp_mapping.update_whitelist",
      category: "tcp_mapping",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "tcp_mapping",
      entityId: mappingId,
      spaceId,
      description:
        cidrs.length > 0
          ? `Updated whitelist for TCP mapping ${mappingId}`
          : `Cleared whitelist for TCP mapping ${mappingId}`,
      metadata: { whitelistedCidrs: cidrs, mappingId, cubeId },
      source: "api",
      ...reqCtx,
    });

    return Response.json({
      whitelistedIps: entries.map((w) => ({ id: w.id, cidr: w.cidr })),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
