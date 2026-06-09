import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const session = await requireAdmin(request);

    const body = await request.json().catch(() => null);
    const userId = body && typeof body.userId === "string" ? body.userId : null;
    if (!userId) {
      return Response.json({ error: "userId is required" }, { status: 400 });
    }

    if (userId === session.user.id) {
      return Response.json(
        { error: "Cannot impersonate yourself" },
        { status: 400 }
      );
    }

    const [target] = await db
      .select({
        id: schema.user.id,
        email: schema.user.email,
        role: schema.user.role,
        banned: schema.user.banned,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    if (!target) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }
    if (target.role === "admin") {
      return Response.json(
        { error: "Cannot impersonate another admin" },
        { status: 403 }
      );
    }
    if (target.banned) {
      return Response.json(
        { error: "Cannot impersonate a banned user" },
        { status: 403 }
      );
    }

    const reqCtx = extractRequestContext(request.headers);

    const authResponse = await auth.api.impersonateUser({
      body: { userId },
      headers: request.headers,
      asResponse: true,
    });

    if (!authResponse.ok) {
      return authResponse;
    }

    audit({
      action: "admin.impersonate_start",
      category: "auth",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "user",
      entityId: userId,
      description: `Admin "${session.user.email}" started impersonating "${target.email}"`,
      metadata: {
        targetUserId: userId,
        targetEmail: target.email,
        sessionDurationSeconds: 3600,
      },
      source: "api",
      ...reqCtx,
    });

    return authResponse;
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/impersonate error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
