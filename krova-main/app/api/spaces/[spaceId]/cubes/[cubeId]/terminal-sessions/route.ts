/**
 * Open a new browser-terminal session for a Cube. Inserts a
 * `cube_terminal_sessions` row in `pending` and enqueues a
 * `cube.terminal-bridge` worker job that will claim it, open the SSH +
 * vsock plumbing, and pump bytes through Soketi.
 *
 * Returns the session id + channel name so the browser can subscribe
 * to `presence-terminal-{sessionId}` via the existing Pusher client.
 *
 * Permission gate: `cube.manage` — same boundary as Sleep / Resize /
 * power-off. cube.view alone is not enough; a contractor with read-only
 * access cannot open a shell.
 */

import { and, count, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  TERMINAL_SESSION_HARD_MS,
  TERMINAL_SESSION_IDLE_MS,
} from "@/config/platform";
import * as schema from "@/db/schema";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

const openSchema = z.object({
  cols: z.number().int().min(20).max(500).default(80),
  rows: z.number().int().min(5).max(200).default(24),
});

/**
 * Anti-abuse limits for terminal session creation. These don't block any
 * legitimate use: 5 sessions/min is well above any plausible "click the
 * Terminal button" rate, and 5 concurrent active sessions is more than
 * a single user could meaningfully interact with at once. They cap the
 * surface for an authed-but-malicious actor (or a buggy client looping
 * the open endpoint) from exhausting worker SSH connections, Pusher
 * presence channels, or the cube_terminal_sessions table.
 */
const MAX_CREATES_PER_USER_PER_MINUTE = 5;
const MAX_CONCURRENT_ACTIVE_PER_USER = 5;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; cubeId: string }> }
) {
  try {
    const { spaceId, cubeId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const body = await request.json().catch(() => ({}));
    const parsed = openSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { cols, rows } = parsed.data;

    const [cube] = await db
      .select({
        id: schema.cubes.id,
        spaceId: schema.cubes.spaceId,
        serverId: schema.cubes.serverId,
        status: schema.cubes.status,
        transferState: schema.cubes.transferState,
      })
      .from(schema.cubes)
      .where(
        and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId))
      )
      .limit(1);

    if (!cube) {
      return Response.json({ error: "Cube not found" }, { status: 404 });
    }
    if (cube.status !== "running") {
      return Response.json(
        {
          error: "Cube is not running",
          message:
            "Terminal sessions can only be opened on running cubes. Wake the cube first.",
        },
        { status: 409 }
      );
    }
    if (cube.transferState !== "idle") {
      return Response.json(
        {
          error: "Cube is mid-transfer",
          message:
            "Terminal sessions cannot be opened while the cube is being transferred.",
        },
        { status: 409 }
      );
    }

    // Anti-abuse: cap session creation rate + concurrent active sessions
    // per user. Both checks run AFTER the auth + cube-state checks so a
    // legitimate-but-spammy client gets clear 429s rather than 401/404s.
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const [recentCreates] = await db
      .select({ value: count(schema.cubeTerminalSessions.id) })
      .from(schema.cubeTerminalSessions)
      .where(
        and(
          eq(schema.cubeTerminalSessions.userId, session.user.id),
          gte(schema.cubeTerminalSessions.createdAt, oneMinuteAgo)
        )
      );

    if ((recentCreates?.value ?? 0) >= MAX_CREATES_PER_USER_PER_MINUTE) {
      return Response.json(
        {
          error: "Rate limited",
          message: `Too many terminal sessions opened in the last minute (max ${MAX_CREATES_PER_USER_PER_MINUTE}). Wait a moment and try again.`,
        },
        { status: 429 }
      );
    }

    const [activeCount] = await db
      .select({ value: count(schema.cubeTerminalSessions.id) })
      .from(schema.cubeTerminalSessions)
      .where(
        and(
          eq(schema.cubeTerminalSessions.userId, session.user.id),
          inArray(schema.cubeTerminalSessions.status, ["pending", "running"])
        )
      );

    if ((activeCount?.value ?? 0) >= MAX_CONCURRENT_ACTIVE_PER_USER) {
      return Response.json(
        {
          error: "Too many active sessions",
          message: `You already have ${MAX_CONCURRENT_ACTIVE_PER_USER} active terminal sessions. Close one before opening another.`,
        },
        { status: 429 }
      );
    }

    const [created] = await db
      .insert(schema.cubeTerminalSessions)
      .values({
        cubeId: cube.id,
        spaceId: cube.spaceId,
        userId: session.user.id,
        initialCols: cols,
        initialRows: rows,
      })
      .returning();

    await enqueueJob(
      JOB_NAMES.CUBE_TERMINAL_BRIDGE,
      { sessionId: created.id },
      { singletonKey: created.id }
    );

    audit({
      action: "cube.terminal_session_open",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      entityType: "cube",
      entityId: cube.id,
      spaceId: cube.spaceId,
      description: `Opened a terminal session (${cols}x${rows})`,
      metadata: { sessionId: created.id, cols, rows },
      source: "api",
      ...extractRequestContext(request.headers),
    });

    return Response.json({
      sessionId: created.id,
      channelName: `presence-terminal-${created.id}`,
      idleTimeoutMs: TERMINAL_SESSION_IDLE_MS,
      hardTimeoutMs: TERMINAL_SESSION_HARD_MS,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "POST /api/spaces/[spaceId]/cubes/[cubeId]/terminal-sessions error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
