import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { task, list } from "@/db/schema";
import { requireSpacePermission } from "@/lib/permissions";
import { pinTaskToList, unpinTaskFromList } from "@/server/list-pin";

async function resolveTask(taskId: string) {
  const [row] = await db
    .select({
      workspaceId: task.workspaceId,
      listId: task.listId,
      spaceId: list.spaceId,
    })
    .from(task)
    .leftJoin(list, eq(task.listId, list.id))
    .where(eq(task.id, taskId))
    .limit(1);
  return row ?? null;
}

// POST /api/tasks/:taskId/pin-to-list — list pin
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { taskId } = await params;
  const ctx = await resolveTask(taskId);
  if (!ctx?.spaceId) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const permErr = await requireSpacePermission(
    session.user.id,
    ctx.workspaceId,
    ctx.spaceId,
    "full_access",
  );
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const result = await pinTaskToList(taskId, session.user.id);
  if ("error" in result) {
    const status = result.code === "LIST_PIN_LIMIT_REACHED" ? 422 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/tasks/:taskId/pin-to-list — list unpin
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { taskId } = await params;
  const ctx = await resolveTask(taskId);
  if (!ctx?.spaceId) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const permErr = await requireSpacePermission(
    session.user.id,
    ctx.workspaceId,
    ctx.spaceId,
    "full_access",
  );
  if (permErr) return NextResponse.json({ error: permErr.error }, { status: permErr.status });

  const result = await unpinTaskFromList(taskId);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({ ok: true });
}
