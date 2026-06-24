import { count, eq, inArray, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import {
  comment,
  space,
  task,
  user,
  workspace,
  workspaceMember,
} from "@/db/schema";
import { getAdminSession } from "@/lib/admin-auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminSession = await getAdminSession();
  if (!adminSession) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const [ws, members, [spacesCount], [tasksCount], [commentsCount]] =
    await Promise.all([
      db
        .select()
        .from(workspace)
        .where(eq(workspace.id, id))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select({
          id: workspaceMember.id,
          userId: workspaceMember.userId,
          email: workspaceMember.email,
          role: workspaceMember.role,
          status: workspaceMember.status,
          joinedAt: workspaceMember.joinedAt,
          userName: user.name,
          userEmail: user.email,
        })
        .from(workspaceMember)
        .leftJoin(user, eq(workspaceMember.userId, user.id))
        .where(eq(workspaceMember.workspaceId, id)),
      db
        .select({ count: count() })
        .from(space)
        .where(eq(space.workspaceId, id)),
      db.select({ count: count() }).from(task).where(eq(task.workspaceId, id)),
      // Count comments for tasks in this workspace via subquery
      db
        .select({ count: sql<number>`count(*)` })
        .from(comment)
        .where(
          inArray(
            comment.taskId,
            db
              .select({ id: task.id })
              .from(task)
              .where(eq(task.workspaceId, id))
          )
        ),
    ]);

  if (!ws) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    workspace: ws,
    members,
    stats: {
      spaces: spacesCount.count,
      tasks: tasksCount.count,
      comments: commentsCount.count,
    },
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminSession = await getAdminSession();
  if (!adminSession) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = body.reason ?? null;

  const ws = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      createdBy: workspace.createdBy,
    })
    .from(workspace)
    .where(eq(workspace.id, id))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!ws) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ownerUser = ws.createdBy
    ? await db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, ws.createdBy))
        .limit(1)
        .then((r) => r[0] ?? null)
    : null;

  await audit({
    action: "workspace_force_deleted",
    actorId: adminSession.user.id,
    actorEmail: adminSession.user.email,
    entityType: "workspace",
    entityId: id,
    description: `Admin force deleted workspace "${ws.name}"`,
    metadata: { reason },
  });

  await db.delete(workspace).where(eq(workspace.id, id));

  if (ownerUser?.email) {
    await enqueueEmail({
      to: ownerUser.email,
      subject: "Your workspace has been deleted",
      html: `<p>Your workspace <strong>${ws.name}</strong> has been deleted by an administrator.${reason ? ` Reason: ${reason}` : ""}</p>`,
      text: `Your workspace "${ws.name}" has been deleted by an administrator.${reason ? ` Reason: ${reason}` : ""}`,
    });
  }

  return NextResponse.json({ ok: true });
}
