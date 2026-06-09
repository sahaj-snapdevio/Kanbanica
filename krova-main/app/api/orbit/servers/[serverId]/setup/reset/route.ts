/**
 * Manual reset for a setup phase that's stuck at status="running" — operator
 * has decided the underlying job will never complete (e.g. SSH hung, network
 * partition, worker process killed).
 *
 * This DOES NOT actually stop the worker function — pg-boss handlers run to
 * completion or natural error. It only updates the DB row so the UI stops
 * showing "running" and the operator can re-trigger the phase. If the original
 * worker eventually finishes successfully, its `completePhase` call will be
 * a no-op because the row's setupStatus changed.
 */

import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { triggerEvent } from "@/lib/pusher";

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

    if (server.setupStatus !== "running") {
      return Response.json(
        {
          error: `Cannot reset — current status is "${server.setupStatus}", not "running"`,
        },
        { status: 409 }
      );
    }

    const message = `Reset by operator while phase "${server.setupPhase}" was running. The underlying operation may still be executing on the server; verify state via SSH before retrying.`;

    await db
      .update(schema.servers)
      .set({
        setupStatus: "failed",
        setupError: message,
        setupStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.servers.id, serverId));

    await triggerEvent(`private-server-${serverId}`, "setup.update", {
      serverId,
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "server.setup.reset",
      category: "server",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "server",
      entityId: serverId,
      description: `Admin reset stuck phase "${server.setupPhase}" on "${server.hostname}"`,
      metadata: { phase: server.setupPhase },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "POST /api/orbit/servers/[serverId]/setup/reset error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
