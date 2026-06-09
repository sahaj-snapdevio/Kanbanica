/**
 * Admin endpoint to cold-restart a Cube on behalf of an operator. Same
 * underlying job as the customer endpoint at
 * /api/spaces/[spaceId]/cubes/[cubeId]/cold-restart, but does not require
 * space membership — only `requireAdmin`.
 *
 * Use case: operator runs `pnpm build:images` + Update Images on a server
 * to push a new kernel, then walks down the list of customer cubes that
 * are still on the old kernel and cold-restarts each. The customer's state
 * (rootfs.ext4) is preserved; only the kernel changes.
 */

import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cubeId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { cubeId } = await params;

    const [cube] = await db
      .select()
      .from(schema.cubes)
      .where(eq(schema.cubes.id, cubeId))
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

    // Per-cube dedup (queue is policy=exclusive) — see the customer route. A
    // null jobId means a restart is already queued/in-flight for this cube.
    const jobId = await enqueueJob(
      JOB_NAMES.CUBE_COLD_RESTART,
      {
        cubeId: cube.id,
        spaceId: cube.spaceId,
        serverId: cube.serverId,
        actorId: session.user.id,
        actorEmail: session.user.email,
      },
      { singletonKey: `cube-cold-restart:${cube.id}` }
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
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId: cube.spaceId,
      description: `Admin cold-restarted cube "${cube.name}" to pick up latest kernel`,
      metadata: { jobId, currentBootedKernelVersion: cube.bootedKernelVersion },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ ok: true, jobId });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/cubes/[cubeId]/cold-restart error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
