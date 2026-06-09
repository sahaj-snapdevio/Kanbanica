/**
 * Trigger a phase of the phased server setup. Operator-facing endpoint.
 *
 * For the bootstrap phase, the operator supplies one-shot SSH credentials
 * (initial port + user + password OR private key) which are encrypted with
 * APP_SECRET and embedded in the pg-boss job payload. The server-bootstrap
 * worker decrypts and uses them to push the platform public key, switch
 * sshd to port 2822, and disable password auth — after which no further
 * phase needs the original creds.
 */

import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { encryptBootstrapCreds } from "@/lib/server/bootstrap-creds";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

const PHASE_TO_JOB: Record<string, string> = {
  bootstrap: JOB_NAMES.SERVER_BOOTSTRAP,
  install: JOB_NAMES.SERVER_INSTALL,
  pull_images: JOB_NAMES.SERVER_PULL_IMAGES,
  network: JOB_NAMES.SERVER_NETWORK,
  reboot: JOB_NAMES.SERVER_REBOOT,
  verify: JOB_NAMES.SERVER_VERIFY,
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { serverId } = await params;
    const body = await request.json().catch(() => ({}));

    const [server] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, serverId))
      .limit(1);

    if (!server) {
      return Response.json({ error: "Server not found" }, { status: 404 });
    }

    if (server.setupPhase === "ready") {
      return Response.json(
        { error: "Server is already fully set up" },
        { status: 409 }
      );
    }

    if (server.setupStatus === "running") {
      return Response.json(
        { error: "A setup phase is already running for this server" },
        { status: 409 }
      );
    }

    const phase = server.setupPhase;
    const jobName = PHASE_TO_JOB[phase];
    if (!jobName) {
      return Response.json(
        { error: `Unknown setup phase: ${phase}` },
        { status: 500 }
      );
    }

    let payload: Record<string, unknown> = { serverId };

    if (phase === "bootstrap") {
      const { initialPort, initialUser, password, privateKey } = body as {
        initialPort?: unknown;
        initialUser?: unknown;
        password?: unknown;
        privateKey?: unknown;
      };

      if (
        typeof initialPort !== "number" ||
        initialPort < 1 ||
        initialPort > 65_535
      ) {
        return Response.json(
          { error: "initialPort must be a number 1–65535" },
          { status: 400 }
        );
      }
      if (typeof initialUser !== "string" || initialUser.trim().length === 0) {
        return Response.json(
          { error: "initialUser is required" },
          { status: 400 }
        );
      }
      const hasPassword = typeof password === "string" && password.length > 0;
      const hasKey = typeof privateKey === "string" && privateKey.length > 0;
      if (!hasPassword && !hasKey) {
        return Response.json(
          { error: "Provide either a password or a privateKey" },
          { status: 400 }
        );
      }

      const encryptedCreds = encryptBootstrapCreds({
        initialPort,
        initialUser: initialUser.trim(),
        ...(hasPassword ? { password: password as string } : {}),
        ...(hasKey ? { privateKey: privateKey as string } : {}),
      });
      payload = { serverId, encryptedCreds };
    }

    // Mark idle/failed → idle (clearing prior error before enqueuing)
    await db
      .update(schema.servers)
      .set({
        setupStatus: "idle",
        setupError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.servers.id, serverId));

    const jobId = await enqueueJob(jobName, payload);

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "server.setup_phase.enqueue",
      category: "server",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "server",
      entityId: serverId,
      description: `Admin enqueued setup phase "${phase}" for server "${server.hostname}"`,
      metadata: { phase, jobName, jobId },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ ok: true, phase, jobId });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/servers/[serverId]/setup error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
