/**
 * Operator-initiated image refresh on an already-active server. Enqueues a
 * `server.update-images` job — does NOT touch the phase lifecycle or reboot
 * the box. The worker reuses the same image-sync core as
 * `server.pull-images`.
 *
 * Rules:
 *   - Server must exist and have completed setup (`setupPhase === "ready"`).
 *     For servers still in setup, the operator should re-run the
 *     `pull_images` phase via the normal Run/Retry button instead.
 *   - Concurrent image updates on the same server are blocked to avoid two
 *     SFTP sessions racing on the same /var/lib/krova/images files.
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
            "Image update is only available on fully-setup servers (setupPhase=ready). Use the regular Run: Pull Images button on servers still in setup.",
        },
        { status: 409 }
      );
    }

    // Per-server dedup (queue is policy=exclusive) — mirrors update-caddy /
    // refresh-caddy / refresh-hardware. Without it a double-click queues two
    // concurrent image SFTPs racing on the same files in /var/lib/krova/images.
    const jobId = await enqueueJob(
      JOB_NAMES.SERVER_UPDATE_IMAGES,
      { serverId },
      { singletonKey: `update-images:${serverId}` }
    );
    if (!jobId) {
      return Response.json(
        { error: "An image update is already in progress for this server." },
        { status: 409 }
      );
    }

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "server.images_update_enqueue",
      category: "server",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "server",
      entityId: serverId,
      description: `Admin enqueued image refresh for "${server.hostname}"`,
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
      "POST /api/orbit/servers/[serverId]/update-images error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
