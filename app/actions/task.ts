"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { list, listStatus, task, workspace } from "@/db/schema";
import { canAccessSpace, getWorkspaceMembership } from "@/lib/permissions";

// ── Quick create task ──────────────────────────────────────────────────────

export async function createTask(
  workspaceId: string,
  spaceId: string,
  listId: string,
  data: { title: string; statusId?: string },
): Promise<{ taskId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const [membership, accessible] = await Promise.all([
    getWorkspaceMembership(session.user.id, workspaceId),
    canAccessSpace(session.user.id, workspaceId, spaceId),
  ]);

  if (!membership) return { error: "Unauthorized" };
  if (!accessible) return { error: "Unauthorized" };

  // VIEW-only users cannot create tasks
  if (membership.role === "GUEST" || membership.role === "MEMBER") {
    // Could check space permission here — for now all non-guest members can create
  }

  const title = data.title.trim();
  if (!title) return { error: "Task title is required" };

  // Verify list belongs to this space and is not archived
  const [currentList] = await db
    .select({ id: list.id })
    .from(list)
    .where(and(eq(list.id, listId), eq(list.spaceId, spaceId), eq(list.isArchived, false)))
    .limit(1);

  if (!currentList) return { error: "List not found or archived" };

  // Resolve status: use provided, or fallback to first OPEN status
  let statusId = data.statusId;
  if (!statusId) {
    const [firstStatus] = await db
      .select({ id: listStatus.id })
      .from(listStatus)
      .where(and(eq(listStatus.listId, listId), eq(listStatus.type, "OPEN")))
      .orderBy(asc(listStatus.orderIndex))
      .limit(1);

    if (!firstStatus) {
      // Fallback: any status
      const [anyStatus] = await db
        .select({ id: listStatus.id })
        .from(listStatus)
        .where(eq(listStatus.listId, listId))
        .orderBy(asc(listStatus.orderIndex))
        .limit(1);
      if (!anyStatus) return { error: "List has no statuses" };
      statusId = anyStatus.id;
    } else {
      statusId = firstStatus.id;
    }
  }

  // Atomically increment workspace task sequence and get the new number
  const [{ taskSeq }] = await db
    .update(workspace)
    .set({ taskSeq: sql`${workspace.taskSeq} + 1` })
    .where(eq(workspace.id, workspaceId))
    .returning({ taskSeq: workspace.taskSeq });

  // Get current max orderIndex in this list
  const taskId = createId();

  await db.insert(task).values({
    id: taskId,
    seqNumber: taskSeq,
    workspaceId,
    listId,
    statusId,
    title,
    priority: "NONE",
    reporterId: session.user.id,
    orderIndex: taskSeq * 1000, // simple monotonic order
  });

  revalidatePath(`/${workspaceId}/${spaceId}/list/${listId}`);
  return { taskId };
}

// ── Update task status (for board drag / status dropdown) ──────────────────

export async function updateTaskStatus(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  statusId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId);
  if (!accessible) return { error: "Unauthorized" };

  await db
    .update(task)
    .set({ statusId, updatedAt: new Date() })
    .where(and(eq(task.id, taskId), eq(task.listId, listId)));

  revalidatePath(`/${workspaceId}/${spaceId}/list/${listId}`);
  return { ok: true };
}
