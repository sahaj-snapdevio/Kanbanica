import { and, eq, ne } from "drizzle-orm";
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

    if (cube.status === "deleted") {
      return Response.json({ success: true, status: "deleted" });
    }

    // Admin override path — UNLIKE the customer DELETE API/server-action,
    // force-delete intentionally accepts `pending`/`booting` cubes because
    // its purpose is to clear stuck cubes the customer can't delete via
    // the normal flow. The boot job has no cancellation path so it will
    // race with cube-delete and exit when it sees the cube already
    // `deleted` — that's acceptable (and intended) under admin override.
    //
    // Atomic conditional update so two admins double-clicking force-delete
    // don't both enqueue CUBE_DELETE jobs that would double-count server
    // resource decrements in the cube-delete handler (audit M14,
    // 2026-05-24).
    const [claimed] = await db
      .update(schema.cubes)
      .set({ status: "stopping", updatedAt: new Date() })
      .where(
        and(
          eq(schema.cubes.id, cube.id),
          ne(schema.cubes.status, "deleted"),
          ne(schema.cubes.status, "stopping")
        )
      )
      .returning({ id: schema.cubes.id });
    if (!claimed && cube.status !== "stopping") {
      return Response.json({ success: true, status: "already-stopping" });
    }

    await enqueueJob(JOB_NAMES.CUBE_DELETE, {
      cubeId: cube.id,
      spaceId: cube.spaceId,
      serverId: cube.serverId,
    });

    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube",
      entityId: cube.id,
      message: "Admin force-delete requested",
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.force_delete",
      category: "cube",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId: cube.spaceId,
      description: `Admin force-deleted cube "${cubeId}"`,
      metadata: { cubeId, spaceId: cube.spaceId, serverId: cube.serverId },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/cubes/[cubeId]/force-delete error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
