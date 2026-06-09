import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Admin force-wake (start) a sleeping cube. Mirrors the force-stop route: an
 * operator override that just enqueues CUBE_WAKE — it deliberately SKIPS the
 * customer wake's plan-limit + credit-balance gates (per the operator decision;
 * same philosophy as `cube:inspect --restart`). The `cube.wake` handler
 * atomically claims `sleeping → booting`, so this is idempotent on retry and
 * safe against a concurrent customer wake. A zero-balance cube woken this way is
 * auto-slept again on the next hourly billing tick.
 */
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

    // Idempotent: already running → nothing to do.
    if (cube.status === "running") {
      return Response.json({ success: true, status: "running" });
    }

    if (cube.status !== "sleeping") {
      return Response.json(
        { error: `Cube cannot be started from status ${cube.status}` },
        { status: 409 }
      );
    }

    await enqueueJob(JOB_NAMES.CUBE_WAKE, {
      cubeId: cube.id,
      spaceId: cube.spaceId,
      serverId: cube.serverId,
    });

    await db.insert(schema.lifecycleLogs).values({
      entityType: "cube",
      entityId: cube.id,
      message: "Admin force-start requested",
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.force_wake",
      category: "cube",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId: cube.spaceId,
      description: `Admin force-started cube "${cubeId}"`,
      metadata: { cubeId, spaceId: cube.spaceId, serverId: cube.serverId },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/cubes/[cubeId]/wake error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
