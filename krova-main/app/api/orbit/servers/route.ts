import { createId } from "@paralleldrive/cuid2";
import { count, eq, notInArray, sum } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { allocateBridgeSubnet } from "@/lib/server/bridge-subnets";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);

    const serverRows = await db.select().from(schema.servers);

    // Compute actual resource usage from active Cubes (excludes error/deleted)
    const cubeStats = await db
      .select({
        serverId: schema.cubes.serverId,
        totalVcpus: sum(schema.cubes.vcpus),
        totalRamMb: sum(schema.cubes.ramMb),
        totalDiskGb: sum(schema.cubes.diskLimitGb),
        cubeCount: count(schema.cubes.id),
      })
      .from(schema.cubes)
      .where(notInArray(schema.cubes.status, ["deleted", "error"]))
      .groupBy(schema.cubes.serverId);

    const cubeStatsMap = new Map(cubeStats.map((v) => [v.serverId, v]));

    const serversWithStats = serverRows.map((server) => {
      const stats = cubeStatsMap.get(server.id);
      const allocatedCpus = stats ? Number(stats.totalVcpus ?? 0) : 0;
      const allocatedRamMb = stats ? Number(stats.totalRamMb ?? 0) : 0;
      const allocatedDiskGb = stats ? Number(stats.totalDiskGb ?? 0) : 0;

      return {
        ...server,
        allocatedCpus,
        allocatedRamMb,
        allocatedDiskGb,
        cubeCount: stats ? Number(stats.cubeCount) : 0,
        cpuUtilization:
          server.totalCpus > 0 ? allocatedCpus / Number(server.totalCpus) : 0,
        ramUtilization:
          server.totalRamMb > 0
            ? allocatedRamMb / Number(server.totalRamMb)
            : 0,
        // Disk utilization is measured against EFFECTIVE capacity
        // (totalDiskGb − measured non-cube overhead), matching the allocator.
        diskUtilization:
          server.totalDiskGb - server.overheadDiskGb > 0
            ? allocatedDiskGb / (server.totalDiskGb - server.overheadDiskGb)
            : 0,
      };
    });

    return Response.json({ servers: serversWithStats });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/servers error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin(request);

    const body = await request.json();
    const {
      hostname,
      publicIp,
      regionId,
      sshKeyId,
      maxCpuOvercommit,
      maxRamOvercommit,
    } = body;

    if (!hostname || !publicIp || !regionId || !sshKeyId) {
      return Response.json(
        {
          error:
            "Missing required fields: hostname, publicIp, regionId, sshKeyId",
        },
        { status: 400 }
      );
    }

    if (
      typeof hostname !== "string" ||
      hostname.length > 63 ||
      !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(hostname)
    ) {
      return Response.json(
        {
          error:
            "hostname must be a valid DNS label (lowercase letters, digits, hyphens; max 63 chars)",
        },
        { status: 400 }
      );
    }

    if (
      maxCpuOvercommit !== undefined &&
      (typeof maxCpuOvercommit !== "number" || maxCpuOvercommit < 1)
    ) {
      return Response.json(
        { error: "maxCpuOvercommit must be a number >= 1" },
        { status: 400 }
      );
    }

    if (
      maxRamOvercommit !== undefined &&
      (typeof maxRamOvercommit !== "number" || maxRamOvercommit < 1)
    ) {
      return Response.json(
        { error: "maxRamOvercommit must be a number >= 1" },
        { status: 400 }
      );
    }

    // Validate regionId exists
    const [region] = await db
      .select({ id: schema.regions.id })
      .from(schema.regions)
      .where(eq(schema.regions.id, regionId))
      .limit(1);
    if (!region) {
      return Response.json({ error: "Region not found" }, { status: 400 });
    }

    // Validate sshKeyId exists
    const [sshKey] = await db
      .select({ id: schema.sshKeys.id })
      .from(schema.sshKeys)
      .where(eq(schema.sshKeys.id, sshKeyId))
      .limit(1);
    if (!sshKey) {
      return Response.json({ error: "SSH key not found" }, { status: 400 });
    }

    const serverId = createId();
    const [server] = await db.transaction(async (tx) => {
      // Allocate a globally-unique bridge_subnet (S) under advisory lock seed 3
      // in the SAME tx as the insert so the chosen S can never collide with a
      // concurrent create-server.
      const bridgeSubnet = await allocateBridgeSubnet(tx);
      return tx
        .insert(schema.servers)
        .values({
          id: serverId,
          hostname,
          publicIp,
          regionId,
          sshKeyId,
          status: "inactive",
          setupPhase: "bootstrap",
          setupStatus: "idle",
          bridgeSubnet,
          ...(maxCpuOvercommit !== undefined && {
            maxCpuOvercommit: String(maxCpuOvercommit),
          }),
          ...(maxRamOvercommit !== undefined && {
            maxRamOvercommit: String(maxRamOvercommit),
          }),
        })
        .returning();
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "server.create",
      category: "server",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "server",
      entityId: server.id,
      description: `Admin created server "${hostname}"`,
      metadata: {
        hostname,
        publicIp,
        regionId,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ server }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/servers error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
