/**
 * Shared enqueue helper for cube resize requests.
 *
 * Used by both the customer-facing route
 * (`/api/spaces/[spaceId]/cubes/[cubeId]/resize`) and the admin route
 * (`/api/orbit/cubes/[cubeId]/resize`). Loads the cube + server, runs the
 * pure `validateResize` checks, and enqueues a `cube.resize` pg-boss job.
 *
 * Audit + lifecycle logs are the caller's responsibility (or are written
 * by the worker handler — see Task 3.2).
 */

import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { type ResizeRequest, validateResize } from "@/lib/cube-resize/validate";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker/enqueue";
import type { CubeResizePayload } from "@/lib/worker/job-types";
import { JOB_NAMES } from "@/lib/worker/job-types";

export type EnqueueResult =
  | { ok: true; jobId: string | null; isLive: boolean; cubeName: string }
  | { ok: false; error: string; status: number };

export async function enqueueResize(opts: {
  cubeId: string;
  req: ResizeRequest;
  actorId: string;
  actorType: "user" | "admin";
}): Promise<EnqueueResult> {
  const [cube] = await db
    .select()
    .from(schema.cubes)
    .where(eq(schema.cubes.id, opts.cubeId))
    .limit(1);

  if (!cube) {
    return { ok: false, error: "Cube not found", status: 404 };
  }

  if (cube.status !== "running" && cube.status !== "sleeping") {
    return {
      ok: false,
      error: `Cube must be running or sleeping (current: ${cube.status})`,
      status: 400,
    };
  }

  // Block resize while a transfer is in flight.
  if (cube.transferState !== "idle" && cube.transferState !== "failed") {
    return {
      ok: false,
      error: "Cube transfer in progress; resize is unavailable",
      status: 409,
    };
  }

  const [server] = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, cube.serverId))
    .limit(1);

  if (!server) {
    return { ok: false, error: "Cube's server not found", status: 500 };
  }

  const v = validateResize({ cube, server, req: opts.req });
  if (!v.ok) {
    return { ok: false, error: v.error, status: 400 };
  }

  const payload: CubeResizePayload = {
    cubeId: cube.id,
    spaceId: cube.spaceId,
    serverId: cube.serverId,
    newVcpus: opts.req.vcpus,
    newRamMb: opts.req.ramMb,
    newDiskLimitGb: opts.req.diskLimitGb,
    isLive: v.isLive,
    actorId: opts.actorId,
    actorType: opts.actorType,
  };

  // Per-cube dedup (queue is policy=exclusive): a resize keeps the cube
  // running/sleeping until the handler claims it, so a double-submit would
  // otherwise enqueue two resizes. A null jobId = a resize is already queued.
  const jobId = await enqueueJob(JOB_NAMES.CUBE_RESIZE, payload, {
    singletonKey: `cube-resize:${cube.id}`,
  });
  if (!jobId) {
    return {
      ok: false,
      error: "A resize is already in progress for this Cube.",
      status: 409,
    };
  }

  return { ok: true, jobId, isLive: v.isLive, cubeName: cube.name };
}
