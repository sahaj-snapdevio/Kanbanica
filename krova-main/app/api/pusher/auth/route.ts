import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { requireSession } from "@/lib/api/auth-helpers";
import { db } from "@/lib/db";
import { getPusherServer } from "@/lib/pusher";

/**
 * Tagged log helper so we can grep `[pusher-auth]` and see every rejection
 * with channel / status / reason. The Soketi-side `subscription_error 401`
 * surfaces "The connection is unauthorized" with no specifics — the only
 * way to diagnose 401s is to capture them on Krova's end first.
 */
function logAuthDecision(
  outcome: "ok" | "rejected" | "error",
  channel: string | null,
  status: number,
  reason: string
): void {
  console.log(
    `[pusher-auth] ${outcome} ${status} channel=${channel ?? "?"} reason=${reason}`
  );
}

export async function POST(request: NextRequest) {
  let socketId: string | null = null;
  let channelName: string | null = null;

  try {
    const session = await requireSession(request);

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      socketId = formData.get("socket_id") as string | null;
      channelName = formData.get("channel_name") as string | null;
    } else {
      const body = await request.json();
      socketId = body.socket_id;
      channelName = body.channel_name;
    }

    if (!socketId || !channelName) {
      logAuthDecision(
        "rejected",
        channelName,
        400,
        "missing socket_id/channel_name"
      );
      return Response.json(
        { error: "socket_id and channel_name are required" },
        { status: 400 }
      );
    }

    const pusher = getPusherServer();

    // Terminal session channels — presence channel, restricted to the
    // single user who opened the session. The channel name encodes the
    // session id; we look the session row up and require:
    //  (a) the connecting user is the session's opener (defense in depth
    //      on top of the cube.manage check at session-create time);
    //  (b) the session is in a state where the bridge could still be
    //      delivering bytes (pending or running). Ended / expired / failed
    //      sessions refuse — there's nothing on the other end to listen to.
    const terminalChannelMatch = channelName.match(/^presence-terminal-(.+)$/);
    if (terminalChannelMatch) {
      const sessionId = terminalChannelMatch[1];
      const [terminalSession] = await db
        .select({
          id: schema.cubeTerminalSessions.id,
          userId: schema.cubeTerminalSessions.userId,
          status: schema.cubeTerminalSessions.status,
        })
        .from(schema.cubeTerminalSessions)
        .where(eq(schema.cubeTerminalSessions.id, sessionId))
        .limit(1);

      if (!terminalSession) {
        logAuthDecision(
          "rejected",
          channelName,
          404,
          "terminal session not found"
        );
        return Response.json(
          { error: "Terminal session not found" },
          { status: 404 }
        );
      }
      if (terminalSession.userId !== session.user.id) {
        logAuthDecision("rejected", channelName, 403, "not the session opener");
        return Response.json(
          { error: "Forbidden: not your terminal session" },
          { status: 403 }
        );
      }
      if (
        terminalSession.status !== "pending" &&
        terminalSession.status !== "running"
      ) {
        logAuthDecision(
          "rejected",
          channelName,
          410,
          `session status=${terminalSession.status}`
        );
        return Response.json(
          { error: "Terminal session is no longer active" },
          { status: 410 }
        );
      }

      const authResponse = pusher.authorizeChannel(socketId, channelName, {
        user_id: session.user.id,
      });
      logAuthDecision("ok", channelName, 200, "terminal session presence ok");
      return Response.json(authResponse);
    }

    // Server channels — admin only
    const serverChannelMatch = channelName.match(/^private-server-(.+)$/);
    if (serverChannelMatch) {
      if (session.user.role !== "admin") {
        logAuthDecision(
          "rejected",
          channelName,
          403,
          "non-admin on server channel"
        );
        return Response.json(
          { error: "Forbidden: admin required" },
          { status: 403 }
        );
      }
      const authResponse = pusher.authorizeChannel(socketId, channelName);
      logAuthDecision("ok", channelName, 200, "admin server channel ok");
      return Response.json(authResponse);
    }

    // Space channels — space membership required
    const spaceChannelMatch = channelName.match(/^private-space-(.+)$/);
    if (spaceChannelMatch) {
      const spaceId = spaceChannelMatch[1];

      const [membership] = await db
        .select()
        .from(schema.spaceMemberships)
        .where(
          and(
            eq(schema.spaceMemberships.userId, session.user.id),
            eq(schema.spaceMemberships.spaceId, spaceId)
          )
        )
        .limit(1);

      if (!membership) {
        logAuthDecision("rejected", channelName, 403, "not a space member");
        return Response.json(
          { error: "Forbidden: not a member of this space" },
          { status: 403 }
        );
      }

      const authResponse = pusher.authorizeChannel(socketId, channelName);
      logAuthDecision("ok", channelName, 200, "space member ok");
      return Response.json(authResponse);
    }

    // Cube channels — space membership required
    const cubeChannelMatch = channelName.match(/^private-cube-(.+)$/);
    if (!cubeChannelMatch) {
      logAuthDecision("rejected", channelName, 403, "unknown channel pattern");
      return Response.json(
        { error: "Invalid channel format" },
        { status: 403 }
      );
    }

    const cubeId = cubeChannelMatch[1];

    const [cube] = await db
      .select({
        id: schema.cubes.id,
        spaceId: schema.cubes.spaceId,
        status: schema.cubes.status,
      })
      .from(schema.cubes)
      .where(eq(schema.cubes.id, cubeId))
      .limit(1);

    if (!cube || cube.status === "deleted") {
      logAuthDecision(
        "rejected",
        channelName,
        404,
        cube ? "cube deleted" : "cube not found"
      );
      return Response.json({ error: "Cube not found" }, { status: 404 });
    }

    const [membership] = await db
      .select()
      .from(schema.spaceMemberships)
      .where(
        and(
          eq(schema.spaceMemberships.userId, session.user.id),
          eq(schema.spaceMemberships.spaceId, cube.spaceId)
        )
      )
      .limit(1);

    if (!membership) {
      logAuthDecision(
        "rejected",
        channelName,
        403,
        "cube channel — not a member of the cube's space"
      );
      return Response.json(
        { error: "Forbidden: not a member of this space" },
        { status: 403 }
      );
    }

    if (!membership.isOwner) {
      // Check if member has ANY cube assignments at all.
      // If none exist, the member is unrestricted (can access all cubes).
      // If assignments exist, the member is restricted to only those cubes.
      const assignments = await db
        .select({ cubeId: schema.memberCubeAssignments.cubeId })
        .from(schema.memberCubeAssignments)
        .where(eq(schema.memberCubeAssignments.membershipId, membership.id))
        .limit(1);

      if (assignments.length > 0) {
        const [specificAssignment] = await db
          .select()
          .from(schema.memberCubeAssignments)
          .where(
            and(
              eq(schema.memberCubeAssignments.membershipId, membership.id),
              eq(schema.memberCubeAssignments.cubeId, cubeId)
            )
          )
          .limit(1);

        if (!specificAssignment) {
          logAuthDecision(
            "rejected",
            channelName,
            403,
            "cube channel — member has assignments but not for this cube"
          );
          return Response.json(
            { error: "Forbidden: no access to this Cube" },
            { status: 403 }
          );
        }
      }
    }

    const authResponse = pusher.authorizeChannel(socketId, channelName);
    logAuthDecision("ok", channelName, 200, "cube channel ok");
    return Response.json(authResponse);
  } catch (error) {
    if (error instanceof Response) {
      logAuthDecision(
        "rejected",
        channelName,
        error.status,
        "requireSession or downstream Response throw"
      );
      return error;
    }
    console.error(
      `[pusher-auth] error channel=${channelName ?? "?"}:`,
      error instanceof Error ? error.stack : error
    );
    logAuthDecision("error", channelName, 500, "exception in auth route");
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
