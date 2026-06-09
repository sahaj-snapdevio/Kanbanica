/**
 * Cold-restart a Cube to pick up a refreshed kernel.
 *
 * The Cube must be currently `running` (no point cold-restarting a sleeping
 * VM — its kernel is already off-disk). The handler kills Firecracker via
 * PID, then relaunches startCube which re-reads the host's vmlinux.
 * Customer state under /var/lib/krova/cubes/<id>/rootfs.ext4 is preserved.
 *
 * Auth: requires `cube.manage` permission on the space (same as sleep/wake).
 */

import { and, eq } from "drizzle-orm";
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  const limited = applyRateLimit(request, RATE_LIMIT_MUTATION);
  if (limited) {
    return limited;
  }

  try {
    const { spaceId, cubeId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const [cube] = await db
      .select()
      .from(schema.cubes)
      .where(
        and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId))
      )
      .limit(1);

    if (!cube) {
      return Response.json({ error: "Cube not found" }, { status: 404 });
    }

    if (cube.status !== "running") {
      return Response.json(
        {
          error: `Cube must be running to cold-restart. Current status: ${cube.status}`,
        },
        { status: 409 }
      );
    }

    // Dedup on a per-cube singletonKey (queue is policy=exclusive): cold-restart
    // keeps cubes.status='running' throughout, so a navigate-back-and-click or a
    // double-click would otherwise enqueue a SECOND kill+relaunch (two kernel
    // reboots + two prorated charges). A null jobId means a restart is already
    // queued/in-flight for this cube → tell the caller, don't double-fire.
    const jobId = await enqueueJob(
      JOB_NAMES.CUBE_COLD_RESTART,
      {
        cubeId,
        spaceId,
        serverId: cube.serverId,
        actorId: session.user.id,
        actorEmail: session.user.email,
      },
      { singletonKey: `cube-cold-restart:${cubeId}` }
    );
    if (!jobId) {
      return Response.json(
        { error: "A restart is already in progress for this Cube." },
        { status: 409 }
      );
    }

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.cold_restart_enqueue",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `User cold-restarted cube "${cube.name}" to pick up latest kernel`,
      metadata: { jobId, currentBootedKernelVersion: cube.bootedKernelVersion },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ ok: true, jobId });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "POST /api/spaces/[spaceId]/cubes/[cubeId]/cold-restart error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
