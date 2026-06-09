/**
 * Permanently hard-delete a Cube row that's already in the soft-deleted state
 * (status="deleted"), along with its lifecycle/audit/job logs. Use this when
 * you no longer need the forensic trail for a deleted Cube — e.g. during
 * tenant offboarding or test-data cleanup.
 *
 * Why this is separate from the regular delete:
 *   - The customer-facing delete (cube.delete worker handler) is a SOFT delete
 *     — it stops/destroys the VM, releases server resources, and flips the
 *     cubes row to status="deleted" so the row + its audit history survive.
 *   - The cubes row in "deleted" state can be hard-removed safely because
 *     all referencing tables have either ON DELETE CASCADE (domain_mappings,
 *     cube_snapshots, tcp_port_mappings, space_membership.cube_id, the
 *     self-referencing cubes.cube_id) or ON DELETE SET NULL (billing_events,
 *     cube_backups). Verified against db/schema/* on 2026-04-27.
 *
 * What this endpoint deletes:
 *   1. job_logs for entityType="cube", entityId=cubeId (defensive — the
 *      cube.delete handler already purges these, but old jobs may linger.)
 *   2. lifecycle_logs for the cube — the in-app history the customer would
 *      have seen on the detail page. Gone forever after this.
 *   3. audit_logs for entityType="cube", entityId=cubeId — admin/system
 *      action history for this cube. Gone forever after this.
 *   4. The cubes row itself. FK CASCADE handles the rest.
 *
 * What this endpoint preserves:
 *   - billing_events: cubeId becomes NULL (FK SET NULL). The amount /
 *     space / type still count toward the space's spend history.
 *   - cube_backups: cubeId becomes NULL. Backup records stay so the
 *     storage objects remain accountable.
 *   - audit_logs we write here (the purge action itself) — actorId=admin,
 *     entityType still "cube" but the cube is gone — useful as forensic
 *     proof of the purge. Identifying it by cubeId in metadata.
 */

import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";

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

    // Hard-block on non-deleted cubes — this is destructive enough that we
    // don't want operators sidestepping the proper cube.delete handler.
    if (cube.status !== "deleted") {
      return Response.json(
        {
          error: `Cube must be in 'deleted' status to purge (current: '${cube.status}'). Use Force Delete first to release server resources.`,
        },
        { status: 409 }
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(schema.jobLogs)
        .where(
          and(
            eq(schema.jobLogs.entityType, "cube"),
            eq(schema.jobLogs.entityId, cubeId)
          )
        );

      await tx
        .delete(schema.lifecycleLogs)
        .where(
          and(
            eq(schema.lifecycleLogs.entityType, "cube"),
            eq(schema.lifecycleLogs.entityId, cubeId)
          )
        );

      await tx
        .delete(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.entityType, "cube"),
            eq(schema.auditLogs.entityId, cubeId)
          )
        );

      await tx.delete(schema.cubes).where(eq(schema.cubes.id, cubeId));
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "cube.purge",
      category: "cube",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "cube",
      entityId: cubeId,
      spaceId: cube.spaceId,
      description: `Admin permanently purged cube "${cube.name}" (${cubeId}) and all its logs`,
      metadata: {
        cubeId,
        cubeName: cube.name,
        spaceId: cube.spaceId,
        serverId: cube.serverId,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/cubes/[cubeId]/purge error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
