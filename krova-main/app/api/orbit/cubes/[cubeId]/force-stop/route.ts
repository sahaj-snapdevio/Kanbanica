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

    if (cube.status === "deleted") {
      return Response.json(
        { error: "Cube is already deleted" },
        { status: 409 }
      );
    }

    if (cube.status === "sleeping") {
      return Response.json({ success: true, status: "sleeping" });
    }

    if (cube.status !== "running") {
      return Response.json(
        { error: `Cube cannot be force-slept from status ${cube.status}` },
        { status: 409 }
      );
    }

    await enqueueJob(JOB_NAMES.CUBE_SLEEP, {
      cubeId: cube.id,
      spaceId: cube.spaceId,
      serverId: cube.serverId,
    });

    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube",
      entityId: cube.id,
      message: "Admin force-sleep requested",
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.force_stop",
      category: "cube",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId: cube.spaceId,
      description: `Admin force-stopped cube "${cubeId}"`,
      metadata: { cubeId, spaceId: cube.spaceId, serverId: cube.serverId },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/cubes/[cubeId]/force-stop error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
