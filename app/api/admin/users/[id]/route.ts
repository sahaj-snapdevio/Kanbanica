import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { user, session, workspace, workspaceMember } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const adminSession = await getAdminSession();
  if (!adminSession) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const [targetUser, sessions, workspaces] = await Promise.all([
    db.select().from(user).where(eq(user.id, id)).limit(1).then((r) => r[0] ?? null),
    db.select().from(session).where(eq(session.userId, id)).orderBy(session.createdAt),
    db
      .select({
        workspaceId: workspaceMember.workspaceId,
        role: workspaceMember.role,
        status: workspaceMember.status,
        joinedAt: workspaceMember.joinedAt,
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
      .where(eq(workspaceMember.userId, id)),
  ]);

  if (!targetUser) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ user: targetUser, sessions, workspaces });
}
