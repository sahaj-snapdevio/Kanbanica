/**
 * Customer-facing endpoint to fetch the job-log activity stream for a cube.
 * Mirrors the admin endpoint at /api/orbit/servers/[serverId]/job-logs but
 * gates by space membership + cube access instead of admin.
 *
 * Query params:
 *   - since   ISO timestamp; only return entries with createdAt > since
 *   - limit   default 200, max 1000
 */

import { and, desc, eq, gt } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.view");
    await requireCubeAccess(membership, cubeId);

    const url = new URL(request.url);
    const sinceParam = url.searchParams.get("since");
    const limitParam = Number.parseInt(
      url.searchParams.get("limit") ?? "200",
      10
    );
    const limit = Math.min(
      1000,
      Math.max(1, Number.isFinite(limitParam) ? limitParam : 200)
    );

    const conditions = [
      eq(schema.jobLogs.entityType, "cube"),
      eq(schema.jobLogs.entityId, cubeId),
    ];
    if (sinceParam) {
      const sinceDate = new Date(sinceParam);
      if (!isNaN(sinceDate.getTime())) {
        conditions.push(gt(schema.jobLogs.createdAt, sinceDate));
      }
    }

    const rows = await db
      .select()
      .from(schema.jobLogs)
      .where(and(...conditions))
      .orderBy(desc(schema.jobLogs.createdAt), desc(schema.jobLogs.sequence))
      .limit(limit);

    return Response.json({ logs: rows.reverse() });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "GET /api/spaces/[spaceId]/cubes/[cubeId]/job-logs error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
