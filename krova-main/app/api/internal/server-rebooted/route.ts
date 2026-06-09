/**
 * POST /api/internal/server-rebooted
 *
 * Called by the host-side krova-boot-notify.service on every boot. Enqueues
 * server.reboot-recovery so the worker restarts the host's cubes immediately,
 * rather than waiting for the <=2-minute cube.state-sync fallback.
 *
 * Auth: the host holds a per-server token = HMAC-SHA256(APP_SECRET, serverId).
 * APP_SECRET itself never leaves the control plane. Blast radius is near-zero
 * regardless — the recovery job re-verifies the boot-id and only restarts
 * cubes the database already says are `running`.
 */

import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { servers } from "@/db/schema";
import { db } from "@/lib/db";
import { hmacSign } from "@/lib/encrypt";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }
  if (body === null || typeof body !== "object") {
    return new NextResponse("invalid body", { status: 400 });
  }

  const { serverId: rawServerId, token: rawToken } = body as {
    serverId?: unknown;
    token?: unknown;
  };
  const serverId = typeof rawServerId === "string" ? rawServerId : "";
  const token = typeof rawToken === "string" ? rawToken : "";
  if (!serverId || !token) {
    return new NextResponse("missing serverId/token", { status: 400 });
  }

  // Constant-time token check. timingSafeEqual throws on unequal-length
  // buffers, so the length guard is mandatory.
  const expected = hmacSign(serverId);
  if (
    token.length !== expected.length ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  ) {
    return new NextResponse("invalid token", { status: 401 });
  }

  const [server] = await db
    .select({ id: servers.id })
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);
  if (!server) {
    return new NextResponse("unknown server", { status: 404 });
  }

  await enqueueJob(
    JOB_NAMES.SERVER_REBOOT_RECOVERY,
    { serverId },
    { singletonKey: serverId }
  );

  return new NextResponse("ok", { status: 202 });
}
