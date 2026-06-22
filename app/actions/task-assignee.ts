"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { task, taskAssignee, taskWatcher, user } from "@/db/schema";
import { canAccessSpace, getSpacePermission, hasPermissionLevel, getWorkspaceMembership } from "@/lib/permissions";
import { writeActivityLog } from "@/lib/activity-log";
import { createNotifications } from "@/lib/notifications/create-notification";

function revalidateTask(workspaceId: string, spaceId: string, listId: string) {
  revalidatePath(`/${workspaceId}/${spaceId}/list/${listId}`);
}

export async function addAssignee(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  assigneeUserId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permission = await getSpacePermission(session.user.id, workspaceId, spaceId);
  if (permission === null || !hasPermissionLevel(permission, "edit")) return { error: "Forbidden" };

  // Verify assignee is active in workspace
  const assigneeMembership = await getWorkspaceMembership(assigneeUserId, workspaceId);
  if (!assigneeMembership || assigneeMembership.status !== "ACTIVE") {
    return { error: "User is not an active workspace member" };
  }

  await db
    .insert(taskAssignee)
    .values({ taskId, userId: assigneeUserId })
    .onConflictDoNothing();

  // Auto-watch assignee
  await db
    .insert(taskWatcher)
    .values({ taskId, userId: assigneeUserId })
    .onConflictDoNothing();

  // Notify the assignee (skip if assigning to yourself)
  if (assigneeUserId !== session.user.id) {
    const [taskRow] = await db
      .select({ title: task.title })
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);

    if (taskRow) {
      const actorName = session.user.name ?? session.user.email ?? "Someone";
      createNotifications({
        workspaceId,
        actorId: session.user.id,
        recipientIds: [assigneeUserId],
        triggerType: "task_assigned",
        entityType: "TASK",
        entityId: taskId,
        title: `${actorName} assigned you to "${taskRow.title}"`,
        muteCheckEntityIds: [taskId],
      });
    }
  }

  await writeActivityLog(taskId, session.user.id, "assignee_added", { userId: assigneeUserId });
  revalidateTask(workspaceId, spaceId, listId);
  return { ok: true };
}

export async function removeAssignee(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  assigneeUserId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permission = await getSpacePermission(session.user.id, workspaceId, spaceId);
  if (permission === null || !hasPermissionLevel(permission, "edit")) return { error: "Forbidden" };

  await db
    .delete(taskAssignee)
    .where(and(eq(taskAssignee.taskId, taskId), eq(taskAssignee.userId, assigneeUserId)));

  await writeActivityLog(taskId, session.user.id, "assignee_removed", { userId: assigneeUserId });
  revalidateTask(workspaceId, spaceId, listId);
  return { ok: true };
}

export async function addWatcher(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  watcherUserId?: string, // defaults to self
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId);
  if (!accessible) return { error: "Unauthorized" };

  const userId = watcherUserId ?? session.user.id;

  await db.insert(taskWatcher).values({ taskId, userId }).onConflictDoNothing();

  await writeActivityLog(taskId, session.user.id, "watcher_added", { userId });
  revalidateTask(workspaceId, spaceId, listId);
  return { ok: true };
}

export async function removeWatcher(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  watcherUserId?: string, // defaults to self
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId);
  if (!accessible) return { error: "Unauthorized" };

  const userId = watcherUserId ?? session.user.id;

  await db
    .delete(taskWatcher)
    .where(and(eq(taskWatcher.taskId, taskId), eq(taskWatcher.userId, userId)));

  await writeActivityLog(taskId, session.user.id, "watcher_removed", { userId });
  revalidateTask(workspaceId, spaceId, listId);
  return { ok: true };
}

export async function toggleWatcher(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
): Promise<{ watching: boolean } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId);
  if (!accessible) return { error: "Unauthorized" };

  const [existing] = await db
    .select({ taskId: taskWatcher.taskId })
    .from(taskWatcher)
    .where(and(eq(taskWatcher.taskId, taskId), eq(taskWatcher.userId, session.user.id)))
    .limit(1);

  if (existing) {
    await db
      .delete(taskWatcher)
      .where(and(eq(taskWatcher.taskId, taskId), eq(taskWatcher.userId, session.user.id)));
    revalidateTask(workspaceId, spaceId, listId);
    return { watching: false };
  } else {
    await db.insert(taskWatcher).values({ taskId, userId: session.user.id }).onConflictDoNothing();
    revalidateTask(workspaceId, spaceId, listId);
    return { watching: true };
  }
}
