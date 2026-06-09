/**
 * Operator-initiated hardware-totals refresh on an active server. Enqueues
 * a `server.refresh-hardware` job — read-only: the worker re-runs the same
 * `nproc` / `/proc/meminfo` / `df -B1G /` probes that bootstrap used and
 * writes the fresh totals back to the `servers` row. Use after a physical
 * RAM/disk/CPU upgrade.
 *
 * Rules:
 *   - Server must exist and have completed setup (`setupPhase === "ready"`).
 *     A server still in setup re-detects hardware automatically every time
 *     the operator runs the bootstrap phase.
 */

import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { serverId } = await params;

    const [server] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, serverId))
      .limit(1);
    if (!server) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    if (server.setupPhase !== "ready") {
      return Response.json(
        {
          error:
            "Hardware refresh is only available on fully-setup servers (setupPhase=ready). Servers still in setup re-detect hardware via the bootstrap phase.",
        },
        { status: 409 }
      );
    }

    const jobId = await enqueueJob(
      JOB_NAMES.SERVER_REFRESH_HARDWARE,
      { serverId },
      { singletonKey: `refresh-hardware:${serverId}` }
    );

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "server.hardware_refresh_enqueue",
      category: "server",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "server",
      entityId: serverId,
      description: `Admin enqueued hardware refresh for "${server.hostname}"`,
      metadata: { jobId },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ ok: true, jobId });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "POST /api/orbit/servers/[serverId]/refresh-hardware error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
