/**
 * Operator-initiated routing re-sync on an already-active server. Enqueues a
 * `server.refresh-caddy` job that re-asserts the server's external routing:
 * both Cloudflare DNS records, the
 * Origin CA cert on Caddy, and the `srv0` routes array (landing route + every
 * customer custom-domain route from `domain_mappings`) plus the ACME
 * automation policy.
 *
 * Rules:
 *   - Server must exist and have completed setup (`setupPhase === "ready"`).
 *     The `install` phase already pushed this config for servers still in
 *     setup.
 *   - Concurrent refreshes on the same server collapse to one run via the
 *     `singletonKey` so two runs never race on the Caddy Admin API.
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
            "Routing refresh is only available on fully-setup servers (setupPhase=ready).",
        },
        { status: 409 }
      );
    }

    const jobId = await enqueueJob(
      JOB_NAMES.SERVER_REFRESH_CADDY,
      { serverId },
      { singletonKey: `refresh-caddy:${serverId}` }
    );

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "server.caddy_refresh_enqueue",
      category: "server",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "server",
      entityId: serverId,
      description: `Admin enqueued routing refresh for "${server.hostname}"`,
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
      "POST /api/orbit/servers/[serverId]/caddy/refresh error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
