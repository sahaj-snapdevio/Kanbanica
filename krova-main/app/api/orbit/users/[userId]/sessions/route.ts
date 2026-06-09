import { and, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";

/**
 * GET — list every active session for a user (admin-only diagnostic).
 * DELETE — revoke a single session or all of a user's sessions.
 *
 * Body for DELETE:
 *   { sessionId: string }              — revoke one session
 *   { all: true }                      — revoke every session for this user
 *
 * Both modes are audit-logged with the actor admin's id.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireAdmin(request);
    const { userId } = await params;

    const rows = await db
      .select({
        id: schema.session.id,
        ipAddress: schema.session.ipAddress,
        userAgent: schema.session.userAgent,
        createdAt: schema.session.createdAt,
        expiresAt: schema.session.expiresAt,
        impersonatedBy: schema.session.impersonatedBy,
      })
      .from(schema.session)
      .where(eq(schema.session.userId, userId))
      .orderBy(desc(schema.session.createdAt));

    return Response.json({
      sessions: rows.map((r) => ({
        id: r.id,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        impersonatedBy: r.impersonatedBy,
      })),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("GET orbit user sessions error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await requireAdmin(request);
    const { userId } = await params;
    const body = await request.json().catch(() => ({}));
    const targetSessionId =
      typeof body?.sessionId === "string" ? body.sessionId : null;
    const all = body?.all === true;

    if (!targetSessionId && !all) {
      return Response.json(
        { error: "Pass either sessionId or all=true" },
        { status: 400 }
      );
    }

    // Self-protection: admins cannot wipe their own sessions through this
    // endpoint — that would lock them out mid-action. They can sign out
    // themselves from the customer-side profile page.
    if (userId === session.user.id) {
      return Response.json(
        {
          error:
            "Use your own profile page to revoke your sessions — this endpoint is for other users.",
        },
        { status: 400 }
      );
    }

    let revokedCount = 0;
    if (all) {
      const rows = await db
        .select({ id: schema.session.id })
        .from(schema.session)
        .where(eq(schema.session.userId, userId));
      if (rows.length > 0) {
        await db.delete(schema.session).where(
          inArray(
            schema.session.id,
            rows.map((r) => r.id)
          )
        );
        revokedCount = rows.length;
      }
    } else if (targetSessionId) {
      const [row] = await db
        .select({ id: schema.session.id, userId: schema.session.userId })
        .from(schema.session)
        .where(eq(schema.session.id, targetSessionId))
        .limit(1);
      if (!row) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }
      if (row.userId !== userId) {
        return Response.json(
          { error: "Session does not belong to this user" },
          { status: 400 }
        );
      }
      await db
        .delete(schema.session)
        .where(
          and(
            eq(schema.session.id, targetSessionId),
            eq(schema.session.userId, userId)
          )
        );
      revokedCount = 1;
    }

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: all ? "auth.admin_signed_out_all" : "auth.admin_session_revoked",
      category: "auth",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "user",
      entityId: userId,
      description: all
        ? `Admin signed out every session for user ${userId} (${revokedCount})`
        : `Admin revoked session ${targetSessionId} for user ${userId}`,
      metadata: { userId, targetSessionId, all, revokedCount },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true, revokedCount });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("DELETE orbit user sessions error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
