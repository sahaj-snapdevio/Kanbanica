/**
 * Admin endpoint that returns the most recent job log entries for a given
 * cube, across every background job that touched it (provision, transfer,
 * sleep, wake, etc.). Mirrors the customer endpoint at
 * /api/spaces/[spaceId]/cubes/[cubeId]/job-logs but gates by admin instead
 * of space membership so operators can stream live progress from the orbit
 * cube detail page without impersonating the space owner.
 *
 * Query params:
 *   - since   ISO timestamp; only return entries with createdAt > since
 *   - limit   default 200, max 1000
 */

import { and, desc, eq, gt } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cubeId: string }> }
) {
  try {
    await requireAdmin(request);
    const { cubeId } = await params;
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
    console.error("GET /api/orbit/cubes/[cubeId]/job-logs error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
