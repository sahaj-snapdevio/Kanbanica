"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { task, taskAssignee, taskWatcher } from "@/db/schema";
import { canAccessSpace, getWorkspaceMembership } from "@/lib/permissions";
import { writeActivityLog } from "@/lib/activity-log";

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

  const [membership, accessible] = await Promise.all([
    getWorkspaceMembership(session.user.id, workspaceId),
    canAccessSpace(session.user.id, workspaceId, spaceId),
  ]);
  if (!membership || !accessible) return { error: "Unauthorized" };

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

  const [membership, accessible] = await Promise.all([
    getWorkspaceMembership(session.user.id, workspaceId),
    canAccessSpace(session.user.id, workspaceId, spaceId),
  ]);
  if (!membership || !accessible) return { error: "Unauthorized" };

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
