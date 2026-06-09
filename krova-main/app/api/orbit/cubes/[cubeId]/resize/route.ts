/**
 * Admin endpoint to resize a cube.
 *
 * Mirrors the customer route, but uses `requireAdmin` and tags the resulting
 * job + audit entry with `actorType: "admin"`. The shared `enqueueResize`
 * helper handles cube + server load + pure validation, then enqueues a
 * `cube.resize` pg-boss job.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { enqueueResize } from "@/lib/cube-resize/enqueue";
import { db } from "@/lib/db";

const bodySchema = z.object({
  vcpus: z.number().int().min(1),
  ramMb: z.number().int().min(1024),
  diskLimitGb: z.number().int().min(10),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ cubeId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { cubeId } = await params;

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

    const result = await enqueueResize({
      cubeId,
      req: parsed.data,
      actorId: session.user.id,
      actorType: "admin",
    });

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    // Look up the cube's spaceId for audit context. enqueueResize already
    // verified the cube exists, so this select is just a context fetch.
    const [cube] = await db
      .select({ spaceId: schema.cubes.spaceId })
      .from(schema.cubes)
      .where(eq(schema.cubes.id, cubeId))
      .limit(1);

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.resize_requested",
      category: "cube",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId: cube?.spaceId,
      description: `Admin requested resize of cube "${result.cubeName}"`,
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
    console.error("PATCH /api/orbit/cubes/[cubeId]/resize error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
