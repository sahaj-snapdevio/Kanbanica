/**
 * Admin endpoint to transfer a Cube to a different server within the same
 * region. Validates destination eligibility (active, ready, capacity, same
 * region) and enqueues a `cube.transfer` job.
 *
 * Cross-region transfer is intentionally NOT supported — storage-backend
 * region affinity and snapshot transfer cost make it a separate feature.
 */

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { serverCpuRamCapacity } from "@/lib/server/cpu-ram-capacity";
import { serverHasDiskRoom } from "@/lib/server/disk-capacity";
import { enqueueJob } from "@/lib/worker/enqueue";
import type { CubeTransferPayload } from "@/lib/worker/job-types";
import { JOB_NAMES } from "@/lib/worker/job-types";

const bodySchema = z.object({
  destinationServerId: z.string().min(1),
});

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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { destinationServerId } = parsed.data;

    if (destinationServerId === cube.serverId) {
      return Response.json(
        { error: "Destination must be a different server" },
        { status: 400 }
      );
    }

    if (cube.status !== "running" && cube.status !== "sleeping") {
      return Response.json(
        {
          error: `Cube must be running or sleeping to transfer. Current status: ${cube.status}`,
        },
        { status: 400 }
      );
    }

    if (cube.transferState !== "idle" && cube.transferState !== "failed") {
      return Response.json(
        {
          error: `Cube transfer already in progress (state: ${cube.transferState})`,
        },
        { status: 409 }
      );
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

    const [destServer] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, destinationServerId))
      .limit(1);

    if (!destServer) {
      return Response.json(
        { error: "Destination server not found" },
        { status: 404 }
      );
    }

    if (destServer.status !== "active") {
      return Response.json(
        {
          error: `Destination server is not active (status: ${destServer.status})`,
        },
        { status: 400 }
      );
    }

    if (destServer.setupPhase !== "ready") {
      return Response.json(
        {
          error: `Destination server is not ready (setup phase: ${destServer.setupPhase})`,
        },
        { status: 400 }
      );
    }

    if (destServer.regionId !== sourceServer.regionId) {
      return Response.json(
        { error: "Cross-region transfer not supported" },
        { status: 400 }
      );
    }

    // Single source for the overcommit ceilings (Rule 14) — kept as two separate
    // checks so the customer-facing error is CPU- vs RAM-specific.
    const { maxCpu, maxRam } = serverCpuRamCapacity(destServer);

    if (destServer.allocatedCpus + cube.vcpus > maxCpu) {
      return Response.json(
        { error: "Destination server has insufficient CPU capacity" },
        { status: 400 }
      );
    }
    if (destServer.allocatedRamMb + cube.ramMb > maxRam) {
      return Response.json(
        { error: "Destination server has insufficient RAM capacity" },
        { status: 400 }
      );
    }
    if (!serverHasDiskRoom(destServer, cube.diskLimitGb)) {
      return Response.json(
        { error: "Destination server has insufficient disk capacity" },
        { status: 400 }
      );
    }

    // ATOMIC CLAIM (Rule 58 / double-fire audit): the status + transferState
    // checks above are read-then-act on the stale loaded row — two submits both
    // pass and enqueue two CUBE_TRANSFER jobs that race on the same rootfs /
    // source teardown / Cloudflare origin re-point. Claim transferState in a
    // single conditional UPDATE: only ONE request flips idle/failed →
    // snapshotting (+ records the destination so the worker's idempotency guard
    // matches + the UI immediately shows "Transferring"). A loser claims nothing
    // → 409. The worker resumes from 'snapshotting' for the same destination.
    const [claimed] = await db
      .update(schema.cubes)
      .set({
        transferState: "snapshotting",
        transferDestinationServerId: destinationServerId,
        transferStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.cubes.id, cube.id),
          inArray(schema.cubes.transferState, ["idle", "failed"]),
          inArray(schema.cubes.status, ["running", "sleeping"])
        )
      )
      .returning({ id: schema.cubes.id });
    if (!claimed) {
      return Response.json(
        { error: "A transfer is already in progress for this Cube." },
        { status: 409 }
      );
    }

    const payload: CubeTransferPayload = {
      cubeId: cube.id,
      spaceId: cube.spaceId,
      sourceServerId: cube.serverId,
      destinationServerId,
      actorId: session.user.id,
      actorEmail: session.user.email,
    };

    // Defense-in-depth dedup (queue is policy=exclusive). After a successful
    // claim a null jobId is unexpected, but if it happens (a stale job still
    // queued for this cube) roll the claim back to 'failed' so the cube isn't
    // stranded in the active 'snapshotting' state with no job driving it.
    const jobId = await enqueueJob(JOB_NAMES.CUBE_TRANSFER, payload, {
      singletonKey: `cube-transfer:${cube.id}`,
    });
    if (!jobId) {
      await db
        .update(schema.cubes)
        .set({
          transferState: "failed",
          transferStartedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.cubes.id, cube.id));
      return Response.json(
        { error: "A transfer is already in progress for this Cube." },
        { status: 409 }
      );
    }

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.transfer_requested",
      category: "cube",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId: cube.spaceId,
      description: `Admin requested transfer of cube "${cube.name}" to server ${destinationServerId}`,
      metadata: {
        jobId,
        sourceServerId: cube.serverId,
        destinationServerId,
        cubeStatus: cube.status,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ ok: true, jobId });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/cubes/[cubeId]/transfer error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
