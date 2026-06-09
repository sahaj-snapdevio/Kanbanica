import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { requireAdmin } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await requireAdmin(request);

    const { userId } = await params;
    const body = await request.json().catch(() => null);
    const banReason =
      body && typeof body.banReason === "string" ? body.banReason.trim() : "";
    const banExpiresIn =
      body &&
      (typeof body.banExpiresIn === "number" || body.banExpiresIn === undefined)
        ? body.banExpiresIn
        : null;

    if (!banReason) {
      return Response.json({ error: "banReason is required" }, { status: 400 });
    }
    if (banExpiresIn === null) {
      return Response.json(
        { error: "banExpiresIn must be a number or omitted" },
        { status: 400 }
      );
    }

    if (userId === session.user.id) {
      return Response.json({ error: "Cannot ban yourself" }, { status: 403 });
    }

    const [target] = await db
      .select({
        id: schema.user.id,
        email: schema.user.email,
        role: schema.user.role,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    if (!target) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }
    if (target.role === "admin") {
      return Response.json({ error: "Cannot ban an admin" }, { status: 403 });
    }

    await auth.api.banUser({
      body: { userId, banReason, banExpiresIn },
      headers: request.headers,
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "admin.ban_user",
      category: "auth",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "user",
      entityId: userId,
      description: `Admin "${session.user.email}" banned user "${target.email}" — ${banReason}`,
      metadata: {
        targetUserId: userId,
        targetEmail: target.email,
        banReason,
        banExpiresIn: banExpiresIn ?? null,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/users/[userId]/ban error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
