import { and, eq, inArray, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * POST /api/orbit/cubes/bulk
 *
 * Apply a single action to many cubes at once. Operator-only escape hatch
 * for "drain a server" / "purge orphans" workflows where doing each cube
 * by hand is impractical.
 *
 * Body:
 *   { action: "force_sleep" | "force_delete", cubeIds: string[] }
 *
 * Returns:
 *   { dispatched: number, skipped: { id: string, reason: string }[] }
 *
 * Each per-cube action enqueues the same worker job that the per-cube
 * endpoints enqueue, so error-recovery and audit semantics match.
 */
export async function POST(request: Request) {
  try {
    const session = await requireAdmin(request);
    const body = await request.json();
    const { action, cubeIds } = body as {
      action?: string;
      cubeIds?: unknown;
    };

    if (!action || !Array.isArray(cubeIds)) {
      return Response.json(
        { error: "Body must include action + cubeIds[]" },
        { status: 400 }
      );
    }
    if (cubeIds.length === 0) {
      return Response.json({ error: "cubeIds is empty" }, { status: 400 });
    }
    if (cubeIds.length > 100) {
      return Response.json(
        { error: "Bulk action capped at 100 cubes per request" },
        { status: 400 }
      );
    }
    const ids = cubeIds.filter((id): id is string => typeof id === "string");
    if (ids.length !== cubeIds.length) {
      return Response.json(
        { error: "cubeIds must be an array of strings" },
        { status: 400 }
      );
    }
    if (!["force_sleep", "force_delete"].includes(action)) {
      return Response.json(
        { error: "action must be 'force_sleep' or 'force_delete'" },
        { status: 400 }
      );
    }

    // Resolve cubes once so the fan-out has consistent state.
    const cubes = await db
      .select({
        id: schema.cubes.id,
        name: schema.cubes.name,
        status: schema.cubes.status,
        serverId: schema.cubes.serverId,
        spaceId: schema.cubes.spaceId,
      })
      .from(schema.cubes)
      .where(inArray(schema.cubes.id, ids));

    const knownIds = new Set(cubes.map((c) => c.id));
    const skipped: { id: string; reason: string }[] = [];
    for (const id of ids) {
      if (!knownIds.has(id)) {
        skipped.push({ id, reason: "Cube not found" });
      }
    }

    let dispatched = 0;
    const reqCtx = extractRequestContext(request.headers);

    for (const cube of cubes) {
      try {
        if (action === "force_sleep") {
          // Only `running` cubes can be slept — match the customer-facing
          // sleep path. The bulk endpoint previously enqueued CUBE_SLEEP
          // for any non-deleted/non-sleeping status which produced
          // no-op jobs on `booting`/`pending`/`error` (audit M13).
          if (cube.status !== "running") {
            skipped.push({
              id: cube.id,
              reason: `Cube is ${cube.status} — must be running to force-sleep`,
            });
            continue;
          }
          await enqueueJob(JOB_NAMES.CUBE_SLEEP, {
            cubeId: cube.id,
            spaceId: cube.spaceId,
            serverId: cube.serverId,
          });
          // Per-cube lifecycle log so the customer's UI shows the admin
          // action in the cube's history (matches the single-cube
          // force-sleep route).
          await db
            .insert(schema.lifecycleLogs)
            .values({
              entityType: "cube",
              entityId: cube.id,
              message: "Admin bulk force-sleep requested",
            })
            .catch(() => {});
        } else if (action === "force_delete") {
          if (cube.status === "deleted") {
            skipped.push({ id: cube.id, reason: "Cube already deleted" });
            continue;
          }
          // Atomic conditional update — two admins clicking bulk-delete
          // on overlapping cube id sets won't double-enqueue
          // CUBE_DELETE for the same cube (audit M13, 2026-05-24).
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
          if (!claimed) {
            skipped.push({
              id: cube.id,
              reason: "Cube was already being deleted by another operation",
            });
            continue;
          }
          await enqueueJob(JOB_NAMES.CUBE_DELETE, {
            cubeId: cube.id,
            spaceId: cube.spaceId,
            serverId: cube.serverId,
          });
          await db
            .insert(schema.lifecycleLogs)
            .values({
              entityType: "cube",
              entityId: cube.id,
              message: "Admin bulk force-delete requested",
            })
            .catch(() => {});
        }

        audit({
          action:
            action === "force_sleep"
              ? "cube.bulk_force_sleep"
              : "cube.bulk_force_delete",
          category: "cube",
          actorType: "admin",
          actorId: session.user.id,
          actorEmail: session.user.email,
          entityType: "cube",
          entityId: cube.id,
          spaceId: cube.spaceId,
          description: `Admin bulk-${action.replace("_", "-")} cube "${cube.name}"`,
          metadata: {
            cubeId: cube.id,
            cubeName: cube.name,
            serverId: cube.serverId,
            previousStatus: cube.status,
            bulkSize: ids.length,
          },
          source: "api",
          ...reqCtx,
        });
        dispatched++;
      } catch (err) {
        skipped.push({
          id: cube.id,
          reason: err instanceof Error ? err.message : "Unknown dispatch error",
        });
      }
    }

    return Response.json({ dispatched, skipped });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/cubes/bulk error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
