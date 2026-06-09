/**
 * Admin endpoint that returns destination servers eligible for a Cube
 * transfer. Eligibility: same region as source server, status=active,
 * setupPhase=ready, AND has capacity headroom under overcommit caps for the
 * cube's vcpus/ram/disk.
 *
 * Capacity math mirrors `lib/server/allocate.ts` so the transfer-targets
 * preview matches what the transfer job will accept.
 */

import { and, eq, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";
import {
  serverCpuRamCapacity,
  serverHasCpuRamRoom,
} from "@/lib/server/cpu-ram-capacity";
import {
  effectiveDiskCapacityGb,
  serverHasDiskRoom,
} from "@/lib/server/disk-capacity";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cubeId: string }> }
) {
  try {
    await requireAdmin(request);
    const { cubeId } = await params;

    const [cube] = await db
      .select()
      .from(schema.cubes)
      .where(eq(schema.cubes.id, cubeId))
      .limit(1);

    if (!cube) {
      return Response.json({ error: "Cube not found" }, { status: 404 });
    }

    const [sourceServer] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, cube.serverId))
      .limit(1);

    if (!sourceServer) {
      return Response.json(
        { error: "Source server not found" },
        { status: 404 }
      );
    }

    const candidates = await db
      .select()
      .from(schema.servers)
      .where(
        and(
          eq(schema.servers.regionId, sourceServer.regionId),
          ne(schema.servers.id, sourceServer.id),
          eq(schema.servers.status, "active"),
          eq(schema.servers.setupPhase, "ready")
        )
      );

    // Eligibility + the displayed ceilings both come from the single source
    // (Rule 14), so this list matches exactly what the transfer job accepts.
    const eligible = candidates
      .filter(
        (s) =>
          serverHasCpuRamRoom(s, cube.vcpus, cube.ramMb) &&
          serverHasDiskRoom(s, cube.diskLimitGb)
      )
      .map((s) => {
        const { maxCpu, maxRam } = serverCpuRamCapacity(s);
        return {
          id: s.id,
          name: s.hostname,
          region: s.regionId,
          capacity: {
            cpu: { allocated: s.allocatedCpus, max: maxCpu },
            ram: { allocated: s.allocatedRamMb, max: maxRam },
            disk: {
              allocated: s.allocatedDiskGb,
              max: effectiveDiskCapacityGb(s),
            },
          },
        };
      });

    return Response.json({ servers: eligible });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "GET /api/orbit/cubes/[cubeId]/transfer-targets error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
