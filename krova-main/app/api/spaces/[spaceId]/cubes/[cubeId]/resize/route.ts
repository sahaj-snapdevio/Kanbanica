/**
 * Customer-facing endpoint to resize a cube.
 *
 * Live for RAM/disk grow when the cube has virtio-mem; cold restart for any
 * vCPU change. The shared `enqueueResize` helper does the cube + server load
 * + pure validation, then enqueues a `cube.resize` pg-boss job. Audit +
 * lifecycle logging happen in the worker handler.
 */

import { z } from "zod";

import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { enqueueResize } from "@/lib/cube-resize/enqueue";
import { assertCubeWithinSizeV2, loadEffectiveLimits } from "@/lib/plan/limits";

const bodySchema = z.object({
  vcpus: z.number().int().min(1),
  ramMb: z.number().int().min(1024),
  diskLimitGb: z.number().int().min(10),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

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

    // Plan-limit enforcement: a resize must not exceed the plan's per-Cube
    // size (merged with any per-space override).
    const limits = await loadEffectiveLimits(spaceId);
    const sizeCheck = assertCubeWithinSizeV2(limits, {
      vcpus: parsed.data.vcpus,
      ramMb: parsed.data.ramMb,
      diskGb: parsed.data.diskLimitGb,
    });
    if (!sizeCheck.ok) {
      return Response.json({ error: sizeCheck.error }, { status: 403 });
    }

    const result = await enqueueResize({
      cubeId,
      req: parsed.data,
      actorId: session.user.id,
      actorType: "user",
    });

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.resize_requested",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Requested resize of cube "${result.cubeName}"`,
      metadata: {
        jobId: result.jobId,
        isLive: result.isLive,
        newVcpus: parsed.data.vcpus,
        newRamMb: parsed.data.ramMb,
        newDiskLimitGb: parsed.data.diskLimitGb,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({
      ok: true,
      jobId: result.jobId,
      isLive: result.isLive,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "PATCH /api/spaces/[spaceId]/cubes/[cubeId]/resize error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
