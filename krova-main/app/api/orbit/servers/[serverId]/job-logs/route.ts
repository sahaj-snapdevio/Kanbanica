/**
 * Returns the most recent job log entries for a given server, across all
 * background jobs that touched it (server setup, etc.). Used by the UI to
 * paint the existing log stream before subscribing to live `job.log` events
 * over Pusher.
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
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    await requireAdmin(request);
    const { serverId } = await params;
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
      eq(schema.jobLogs.entityType, "server"),
      eq(schema.jobLogs.entityId, serverId),
    ];
    if (sinceParam) {
      const sinceDate = new Date(sinceParam);
      if (!isNaN(sinceDate.getTime())) {
        conditions.push(gt(schema.jobLogs.createdAt, sinceDate));
      }
    }

    // Newest-first to honor `limit`, then reverse so callers get chronological.
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
    console.error("GET /api/orbit/servers/[serverId]/job-logs error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
