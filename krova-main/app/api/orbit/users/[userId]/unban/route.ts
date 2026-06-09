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

    const [target] = await db
      .select({
        id: schema.user.id,
        email: schema.user.email,
      })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    if (!target) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    await auth.api.unbanUser({
      body: { userId },
      headers: request.headers,
    });

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "admin.unban_user",
      category: "auth",
      actorType: "admin",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "user",
      entityId: userId,
      description: `Admin "${session.user.email}" unbanned user "${target.email}"`,
      metadata: {
        targetUserId: userId,
        targetEmail: target.email,
      },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    console.error("POST /api/orbit/users/[userId]/unban error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
