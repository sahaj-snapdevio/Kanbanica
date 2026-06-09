/**
 * Operator-initiated Caddy package upgrade on an already-active server.
 * Enqueues a `server.update-caddy` job — the worker upgrades Caddy to the
 * platform-pinned CADDY_VERSION, restarts the service, and verifies the
 * version. Does NOT touch the phase lifecycle or reboot the box.
 *
 * Rules:
 *   - Server must exist and have completed setup (`setupPhase === "ready"`).
 *     Servers still in setup get the pinned version from the `install` phase.
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
            "Caddy upgrade is only available on fully-setup servers (setupPhase=ready). Servers still in setup install the pinned Caddy version during the install phase.",
        },
        { status: 409 }
      );
    }

    const jobId = await enqueueJob(
      JOB_NAMES.SERVER_UPDATE_CADDY,
      { serverId },
      { singletonKey: `update-caddy:${serverId}` }
    );

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "server.caddy_update_enqueue",
      category: "server",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "server",
      entityId: serverId,
      description: `Admin enqueued Caddy upgrade for "${server.hostname}"`,
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
      "POST /api/orbit/servers/[serverId]/update-caddy error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
