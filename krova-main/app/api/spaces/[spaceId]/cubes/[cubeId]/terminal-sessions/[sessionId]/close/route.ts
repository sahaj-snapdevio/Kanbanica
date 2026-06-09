/**
 * Close an active terminal session. Atomic conditional update — the row
 * only transitions to `ended` if currently `pending` or `running`. The
 * worker bridge polls the session row and tears down its SSH + vsock
 * plumbing the next time it sees the status change.
 *
 * Anyone with `cube.manage` on the cube can close any session on it —
 * including admin force-close. The session's opener doesn't have to be
 * the caller.
 */

import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  requireCubeAccess,
  requirePermission,
  requireSpaceMember,
} from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ spaceId: string; cubeId: string; sessionId: string }>;
  }
) {
  try {
    const { spaceId, cubeId, sessionId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "cube.manage");
    await requireCubeAccess(membership, cubeId);

    const [closed] = await db
      .update(schema.cubeTerminalSessions)
      .set({
        status: "ended",
        endReason: "closed_by_user",
        endedAt: new Date(),
      })
      .where(
        and(
          eq(schema.cubeTerminalSessions.id, sessionId),
          eq(schema.cubeTerminalSessions.cubeId, cubeId),
          eq(schema.cubeTerminalSessions.spaceId, spaceId),
          inArray(schema.cubeTerminalSessions.status, ["pending", "running"])
        )
      )
      .returning({ id: schema.cubeTerminalSessions.id });

    if (!closed) {
      // Either the session doesn't exist, isn't on this cube, or was already
      // closed by the worker (idle/hard timeout / cube state change). Treat
      // as success — the customer's intent ("end this session") is satisfied.
      return Response.json({ alreadyClosed: true });
    }

    audit({
      action: "cube.terminal_session_close",
      category: "cube",
      actorType: "user",
      actorId: session.user.id,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: "Closed terminal session",
      metadata: { sessionId },
      source: "api",
      ...extractRequestContext(request.headers),
    });

    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error(
      "POST /api/spaces/.../terminal-sessions/[sessionId]/close error:",
      error
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
