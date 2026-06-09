/**
 * Pre-flight transfer compatibility check.
 *
 * Returns a read-only analysis of what would happen if the cube were
 * transferred to the specified destination server: capacity headroom,
 * port conflicts + simulated reassignments, and a domain DNS-update notice.
 *
 * No state is mutated — safe to call repeatedly.
 */

import { and, eq, ne } from "drizzle-orm";
import {
  allocatedPorts,
  cubes,
  domainMappings,
  servers,
  tcpPortMappings,
} from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";
import {
  serverCpuRamCapacity,
  serverHasCpuRamRoom,
} from "@/lib/server/cpu-ram-capacity";
import {
  availableDiskGb,
  effectiveDiskCapacityGb,
} from "@/lib/server/disk-capacity";
import { PORT_RANGE } from "@/lib/server/ports";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cubeId: string }> }
) {
  try {
    await requireAdmin(request);
    const { cubeId } = await params;
    const { searchParams } = new URL(request.url);
    const destinationServerId = searchParams.get("destinationServerId");

    if (!destinationServerId) {
      return Response.json(
        { error: "destinationServerId query param is required" },
        { status: 400 }
      );
    }

    const cube = await db.query.cubes.findFirst({
      where: eq(cubes.id, cubeId),
    });
    if (!cube) {
      return Response.json({ error: "Cube not found" }, { status: 404 });
    }

    const [destServer] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, destinationServerId))
      .limit(1);

    if (!destServer) {
      return Response.json(
        { error: "Destination server not found" },
        { status: 404 }
      );
    }

    const [sourceServer] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, cube.serverId))
      .limit(1);

    // ── Capacity check ──────────────────────────────────────────────────
    // Overcommit ceilings + the room test come from the single source (Rule 14),
    // so this preview can never diverge from what the transfer job enforces.
    const { maxCpu, maxRam } = serverCpuRamCapacity(destServer);

    const cpuAvailable = maxCpu - destServer.allocatedCpus;
    const ramAvailable = maxRam - destServer.allocatedRamMb;
    // Disk capacity is reservation-based against EFFECTIVE capacity
    // (totalDiskGb − measured non-cube overhead) — never raw totalDiskGb.
    const diskAvailable = availableDiskGb(destServer);

    const capacity = {
      ok:
        serverHasCpuRamRoom(destServer, cube.vcpus, cube.ramMb) &&
        cube.diskLimitGb <= diskAvailable,
      cpu: { needed: cube.vcpus, available: cpuAvailable, max: maxCpu },
      ram: { needed: cube.ramMb, available: ramAvailable, max: maxRam },
      disk: {
        needed: cube.diskLimitGb,
        available: diskAvailable,
        max: effectiveDiskCapacityGb(destServer),
      },
    };

    // ── Server readiness ────────────────────────────────────────────────
    const sameRegion =
      !sourceServer || destServer.regionId === sourceServer.regionId;
    const serverReady = {
      ok:
        destServer.status === "active" &&
        destServer.setupPhase === "ready" &&
        sameRegion,
      status: destServer.status,
      setupPhase: destServer.setupPhase,
      sameRegion,
    };

    // ── Port conflict simulation ────────────────────────────────────────
    const mappings = await db
      .select()
      .from(tcpPortMappings)
      .where(eq(tcpPortMappings.cubeId, cubeId));

    const destPorts = await db
      .select({ port: allocatedPorts.port })
      .from(allocatedPorts)
      .where(eq(allocatedPorts.serverId, destinationServerId));

    const usedSet = new Set(destPorts.map((p) => p.port));

    const portResults = mappings.map((m) => {
      if (!usedSet.has(m.hostPort)) {
        return {
          purpose: m.isSsh ? ("ssh" as const) : ("tcp" as const),
          currentPort: m.hostPort,
          cubePort: m.cubePort,
          conflict: false,
          resolvedPort: m.hostPort,
        };
      }
      // Simulate the same fallback scan the worker uses
      let resolved = m.hostPort;
      for (let p = PORT_RANGE.start; p <= PORT_RANGE.end; p++) {
        if (!usedSet.has(p)) {
          resolved = p;
          break;
        }
      }
      usedSet.add(resolved);
      return {
        purpose: m.isSsh ? ("ssh" as const) : ("tcp" as const),
        currentPort: m.hostPort,
        cubePort: m.cubePort,
        conflict: true,
        resolvedPort: resolved,
      };
    });

    // ── Domain notice ───────────────────────────────────────────────────
    // Gate on `status === "active"` (the live-route signal), NOT the vestigial
    // `verificationStatus` column — so the pre-transfer notice matches the set
    // of domains the transfer handler actually re-points.
    const activeDomains = await db
      .select({ domain: domainMappings.domain, port: domainMappings.port })
      .from(domainMappings)
      .where(
        and(
          eq(domainMappings.cubeId, cubeId),
          eq(domainMappings.status, "active")
        )
      );

    // Check if any of these domains are already routed on the destination
    // by a different cube (globally unique constraint means this is rare
    // but worth surfacing).
    const conflictingDomains =
      activeDomains.length > 0
        ? await db
            .select({ domain: domainMappings.domain })
            .from(domainMappings)
            .innerJoin(cubes, eq(cubes.id, domainMappings.cubeId))
            .where(
              and(
                ne(domainMappings.cubeId, cubeId),
                eq(cubes.serverId, destinationServerId),
                eq(domainMappings.status, "active")
              )
            )
        : [];

    const conflictSet = new Set(conflictingDomains.map((d) => d.domain));

    const domainResults = activeDomains.map((d) => ({
      domain: d.domain,
      cubePort: d.port,
      conflict: conflictSet.has(d.domain),
    }));

    return Response.json({
      destinationServer: {
        id: destServer.id,
        name: destServer.hostname,
        publicIp: destServer.publicIp,
      },
      checks: {
        serverReady,
        capacity,
        ports: {
          mappings: portResults,
          conflictCount: portResults.filter((p) => p.conflict).length,
        },
        domains: {
          verified: domainResults,
          conflictCount: domainResults.filter((d) => d.conflict).length,
        },
      },
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET /api/orbit/cubes/[cubeId]/transfer-check error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
