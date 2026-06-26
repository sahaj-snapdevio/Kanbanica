"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  list,
  listStatus,
  task,
  taskAssignee,
  taskWatcher,
  taskTag,
  tag,
  taskDependency,
  taskDescriptionSnapshot,
  timeLog,
  workspace,
  workspaceMember,
  activityLog,
  checklist,
  checklistItem,
  user,
  taskSprint,
  sprint,
} from "@/db/schema";
import { canAccessSpace, getSpacePermission, hasPermissionLevel } from "@/lib/permissions";
import { writeActivityLog } from "@/lib/activity-log";
import { createNotifications } from "@/lib/notifications/create-notification";

// ─── Permission helpers ──────────────────────────────────────────────────────

// Requires at least "edit" permission — creates, updates, tags, time-logging, etc.
async function requireEditAccess(
  userId: string,
  workspaceId: string,
  spaceId: string,
): Promise<{ error: string } | null> {
  const permission = await getSpacePermission(userId, workspaceId, spaceId);
  if (permission === null) return { error: "Forbidden" };
  if (!hasPermissionLevel(permission, "edit")) return { error: "Forbidden" };
  return null;
}

// Requires at least "view" permission — reads, activity, comments.
async function requireViewAccess(
  userId: string,
  workspaceId: string,
  spaceId: string,
): Promise<{ error: string } | null> {
  const accessible = await canAccessSpace(userId, workspaceId, spaceId);
  if (!accessible) return { error: "Forbidden" };
  return null;
}

// Requires "full_access" permission — delete task, etc.
async function requireFullAccess(
  userId: string,
  workspaceId: string,
  spaceId: string,
): Promise<{ error: string } | null> {
  const permission = await getSpacePermission(userId, workspaceId, spaceId);
  if (permission === null) return { error: "Forbidden" };
  if (!hasPermissionLevel(permission, "full_access")) return { error: "Forbidden" };
  return null;
}

// ─── Revalidation helper ─────────────────────────────────────────────────────

function revalidateList(workspaceId: string, spaceId: string, listId: string) {
  revalidatePath(`/${workspaceId}/${spaceId}/list/${listId}`);
}

function revalidateSpace(workspaceId: string, spaceId: string) {
  revalidatePath(`/${workspaceId}/${spaceId}`);
  revalidatePath(`/${workspaceId}`);
}

// ─── Create Task ─────────────────────────────────────────────────────────────

export async function createTask(
  workspaceId: string,
  spaceId: string,
  listId: string | null,
  data: { title: string; statusId?: string },
): Promise<{ taskId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const title = data.title.trim();
  if (!title) return { error: "Task title is required" };

  let statusId: string | undefined = data.statusId || undefined;
  const effectiveListId = listId || null;

  if (effectiveListId) {
    const [currentList] = await db
      .select({ id: list.id })
      .from(list)
      .where(and(eq(list.id, effectiveListId), eq(list.spaceId, spaceId), eq(list.isArchived, false)))
      .limit(1);
    if (!currentList) return { error: "List not found or archived" };

    if (!statusId) {
      const [firstStatus] = await db
        .select({ id: listStatus.id })
        .from(listStatus)
        .where(and(eq(listStatus.listId, effectiveListId), eq(listStatus.type, "OPEN")))
        .orderBy(asc(listStatus.orderIndex))
        .limit(1);

      if (!firstStatus) {
        const [anyStatus] = await db
          .select({ id: listStatus.id })
          .from(listStatus)
          .where(eq(listStatus.listId, effectiveListId))
          .orderBy(asc(listStatus.orderIndex))
          .limit(1);
        if (!anyStatus) return { error: "List has no statuses" };
        statusId = anyStatus.id;
      } else {
        statusId = firstStatus.id;
      }
    }
  }

  const [{ taskSeq }] = await db
    .update(workspace)
    .set({ taskSeq: sql`${workspace.taskSeq} + 1` })
    .where(eq(workspace.id, workspaceId))
    .returning({ taskSeq: workspace.taskSeq });

  const taskId = createId();

  await db.transaction(async (tx) => {
    await tx.insert(task).values({
      id: taskId,
      seqNumber: taskSeq,
      workspaceId,
      spaceId,
      listId: effectiveListId,
      statusId: statusId ?? null,
      title,
      priority: "NONE",
      reporterId: session.user.id,
      orderIndex: taskSeq * 1000,
    });
    // Auto-watch: creator
    await tx.insert(taskWatcher).values({ taskId, userId: session.user.id }).onConflictDoNothing();
  });

  await writeActivityLog(taskId, session.user.id, "task_created", { title });
  if (listId) revalidateList(workspaceId, spaceId, listId);
  return { taskId };
}

// ─── Get task detail ─────────────────────────────────────────────────────────

export async function getTaskDetail(
  workspaceId: string,
  spaceId: string,
  taskId: string,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permErr = await requireViewAccess(session.user.id, workspaceId, spaceId);
  if (permErr) return permErr;

  const [t] = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  if (!t) return { error: "Task not found" };

  const [assignees, watchers, tags, checklists, dependencies, timeLogs, statuses, snapshot, subtasks, parentTaskInfo] =
    await Promise.all([
      db
        .select({ userId: taskAssignee.userId, name: user.name, email: user.email, image: user.image })
        .from(taskAssignee)
        .leftJoin(user, eq(user.id, taskAssignee.userId))
        .where(eq(taskAssignee.taskId, taskId)),

      db
        .select({ userId: taskWatcher.userId, name: user.name, email: user.email, image: user.image })
        .from(taskWatcher)
        .leftJoin(user, eq(user.id, taskWatcher.userId))
        .where(eq(taskWatcher.taskId, taskId)),

      db
        .select({ id: tag.id, name: tag.name, color: tag.color })
        .from(taskTag)
        .innerJoin(tag, eq(taskTag.tagId, tag.id))
        .where(eq(taskTag.taskId, taskId)),

      db
        .select()
        .from(checklist)
        .where(eq(checklist.taskId, taskId))
        .orderBy(asc(checklist.orderIndex))
        .then(async (cls) => {
          if (cls.length === 0) return [];
          const items = await db
            .select()
            .from(checklistItem)
            .where(inArray(checklistItem.checklistId, cls.map((c) => c.id)))
            .orderBy(asc(checklistItem.orderIndex));
          return cls.map((c) => ({
            ...c,
            items: items.filter((i) => i.checklistId === c.id),
          }));
        }),

      db
        .select({
          id: taskDependency.id,
          type: taskDependency.type,
          dependsOnTaskId: taskDependency.dependsOnTaskId,
          dependsOnTitle: task.title,
          dependsOnSeq: task.seqNumber,
        })
        .from(taskDependency)
        .innerJoin(task, eq(taskDependency.dependsOnTaskId, task.id))
        .where(eq(taskDependency.taskId, taskId)),

      db
        .select()
        .from(timeLog)
        .where(eq(timeLog.taskId, taskId))
        .orderBy(desc(timeLog.loggedAt)),

      t.listId
        ? db.select().from(listStatus).where(eq(listStatus.listId, t.listId)).orderBy(asc(listStatus.orderIndex))
        : Promise.resolve([]),

      db
        .select()
        .from(taskDescriptionSnapshot)
        .where(eq(taskDescriptionSnapshot.taskId, taskId))
        .limit(1)
        .then((r) => r[0] ?? null),

      db
        .select({
          id: task.id,
          seqNumber: task.seqNumber,
          title: task.title,
          priority: task.priority,
          statusId: task.statusId,
          orderIndex: task.orderIndex,
          statusName: listStatus.name,
          statusColor: listStatus.color,
          statusType: listStatus.type,
        })
        .from(task)
        .leftJoin(listStatus, eq(listStatus.id, task.statusId))
        .where(and(eq(task.parentTaskId, taskId), eq(task.isArchived, false)))
        .orderBy(asc(task.orderIndex)),

      t.parentTaskId
        ? db
            .select({ id: task.id, title: task.title, seqNumber: task.seqNumber })
            .from(task)
            .where(eq(task.id, t.parentTaskId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);

  return {
    task: t,
    assignees,
    watchers,
    tags,
    checklists,
    dependencies,
    timeLogs,
    statuses,
    snapshot,
    subtasks,
    parentTask: parentTaskInfo,
    currentUserId: session.user.id,
  };
}

// ─── Get workspace members (for assignee picker) ──────────────────────────────

export async function getWorkspaceMembers(workspaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const members = await db
    .select({
      userId: workspaceMember.userId,
      name: user.name,
      email: user.email,
      image: user.image,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.status, "ACTIVE"),
      ),
    )
    .orderBy(asc(user.name));

  return { members };
}

// ─── Update task (title, priority, description, due dates) ───────────────────

export async function updateTask(
  workspaceId: string,
  spaceId: string,
  listId: string | null,
  taskId: string,
  data: {
    title?: string;
    priority?: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    description?: unknown;
    dueDateStart?: Date | null;
    dueDateEnd?: Date | null;
    timeEstimate?: number | null;
  },
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const [existing] = await db
    .select({ title: task.title, priority: task.priority, description: task.description })
    .from(task)
    .where(and(eq(task.id, taskId), listId != null ? eq(task.listId, listId) : isNull(task.listId)))
    .limit(1);
  if (!existing) return { error: "Task not found" };

  const updates: Partial<typeof task.$inferInsert> = { updatedAt: new Date() };
  const logs: Array<() => Promise<void>> = [];

  if (data.title !== undefined && data.title.trim() !== existing.title) {
    updates.title = data.title.trim();
    logs.push(() =>
      writeActivityLog(taskId, session.user.id, "title_changed", {
        from: existing.title,
        to: updates.title,
      }),
    );
  }

  if (data.priority !== undefined && data.priority !== existing.priority) {
    updates.priority = data.priority;
    logs.push(() =>
      writeActivityLog(taskId, session.user.id, "priority_changed", {
        from: existing.priority,
        to: data.priority,
      }),
    );
  }

  if (data.description !== undefined) {
    // Snapshot the previous description before overwriting
    if (existing.description) {
      await db
        .insert(taskDescriptionSnapshot)
        .values({
          id: createId(),
          taskId,
          content: existing.description as Record<string, unknown>,
          savedBy: session.user.id,
          savedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: taskDescriptionSnapshot.taskId,
          set: {
            content: existing.description as Record<string, unknown>,
            savedBy: session.user.id,
            savedAt: new Date(),
          },
        });
    }
    updates.description = data.description as Record<string, unknown>;
    logs.push(() => writeActivityLog(taskId, session.user.id, "description_updated"));
  }

  if (data.dueDateStart !== undefined) updates.dueDateStart = data.dueDateStart;
  if (data.dueDateEnd !== undefined) updates.dueDateEnd = data.dueDateEnd;
  if (data.timeEstimate !== undefined) updates.timeEstimate = data.timeEstimate;

  if (Object.keys(updates).length > 1) {
    await db.update(task).set(updates).where(eq(task.id, taskId));
  }

  await Promise.all(logs.map((fn) => fn()));

  // Notify watchers of due date change
  if (data.dueDateEnd !== undefined) {
    const dueDateWatchers = await db
      .select({ userId: taskWatcher.userId })
      .from(taskWatcher)
      .where(eq(taskWatcher.taskId, taskId));
    const dueDateWatcherIds = dueDateWatchers.map((w) => w.userId);
    if (dueDateWatcherIds.length > 0) {
      const actorName = session.user.name ?? session.user.email ?? "Someone";
      createNotifications({
        workspaceId,
        actorId: session.user.id,
        recipientIds: dueDateWatcherIds,
        triggerType: "task_due_date_changed",
        entityType: "TASK",
        entityId: taskId,
        title: `${actorName} changed due date of "${existing.title}"`,
        muteCheckEntityIds: [taskId],
      });
    }
  }

  if (listId) revalidateList(workspaceId, spaceId, listId); else revalidateSpace(workspaceId, spaceId);
  return { ok: true };
}

// ─── Update task status ───────────────────────────────────────────────────────

export async function updateTaskStatus(
  workspaceId: string,
  spaceId: string,
  listId: string | null,
  taskId: string,
  statusId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permErr = await requireViewAccess(session.user.id, workspaceId, spaceId);
  if (permErr) return permErr;

  const [existing] = await db
    .select({ statusId: task.statusId, title: task.title })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  if (!existing) return { error: "Task not found" };

  await db
    .update(task)
    .set({ statusId, updatedAt: new Date() })
    .where(and(eq(task.id, taskId), listId != null ? eq(task.listId, listId) : isNull(task.listId)));

  await writeActivityLog(taskId, session.user.id, "status_changed", {
    from: existing.statusId,
    to: statusId,
  });

  // Notify watchers of status change
  const taskWatchers = await db
    .select({ userId: taskWatcher.userId })
    .from(taskWatcher)
    .where(eq(taskWatcher.taskId, taskId));

  const newStatus = await db
    .select({ name: listStatus.name, type: listStatus.type })
    .from(listStatus)
    .where(eq(listStatus.id, statusId))
    .limit(1)
    .then((r) => r[0] ?? null);

  const watcherIds = taskWatchers.map((w) => w.userId);
  if (watcherIds.length > 0) {
    const actorName = session.user.name ?? session.user.email ?? "Someone";
    createNotifications({
      workspaceId,
      actorId: session.user.id,
      recipientIds: watcherIds,
      triggerType: newStatus?.type === "CLOSED" ? "task_completed" : "task_status_changed",
      entityType: "TASK",
      entityId: taskId,
      title: newStatus?.type === "CLOSED"
        ? `${actorName} completed "${existing.title}"`
        : `${actorName} changed status of "${existing.title}" to "${newStatus?.name ?? statusId}"`,
      muteCheckEntityIds: [taskId],
    });
  }

  if (listId) revalidateList(workspaceId, spaceId, listId); else revalidateSpace(workspaceId, spaceId);
  return { ok: true };
}

// ─── Delete task ──────────────────────────────────────────────────────────────

export async function deleteTask(
  workspaceId: string,
  spaceId: string,
  listId: string | null,
  taskId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permErr = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (permErr) return { error: "You don't have permission to delete tasks" };

  await db.delete(task).where(and(eq(task.id, taskId), listId != null ? eq(task.listId, listId) : isNull(task.listId)));

  if (listId) revalidateList(workspaceId, spaceId, listId); else revalidateSpace(workspaceId, spaceId);
  return { ok: true };
}

// ─── Archive / Unarchive task ─────────────────────────────────────────────────

export async function archiveTask(
  workspaceId: string,
  spaceId: string,
  listId: string | null,
  taskId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  await db
    .update(task)
    .set({
      isArchived: true,
      archivedAt: new Date(),
      isPinnedToList: false,
      pinnedToListBy: null,
      pinnedToListAt: null,
      pinnedToListOrder: null,
      updatedAt: new Date(),
    })
    .where(and(eq(task.id, taskId), listId != null ? eq(task.listId, listId) : isNull(task.listId)));

  await writeActivityLog(taskId, session.user.id, "task_archived");
  if (listId) revalidateList(workspaceId, spaceId, listId); else revalidateSpace(workspaceId, spaceId);
  return { ok: true };
}

export async function unarchiveTask(
  workspaceId: string,
  spaceId: string,
  listId: string | null,
  taskId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  await db
    .update(task)
    .set({ isArchived: false, archivedAt: null, updatedAt: new Date() })
    .where(and(eq(task.id, taskId), listId != null ? eq(task.listId, listId) : isNull(task.listId)));

  await writeActivityLog(taskId, session.user.id, "task_unarchived");
  if (listId) revalidateList(workspaceId, spaceId, listId); else revalidateSpace(workspaceId, spaceId);
  return { ok: true };
}

// ─── Duplicate task ───────────────────────────────────────────────────────────

export async function duplicateTask(
  workspaceId: string,
  spaceId: string,
  listId: string | null,
  taskId: string,
): Promise<{ taskId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const [original] = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  if (!original) return { error: "Task not found" };

  const [{ taskSeq }] = await db
    .update(workspace)
    .set({ taskSeq: sql`${workspace.taskSeq} + 1` })
    .where(eq(workspace.id, workspaceId))
    .returning({ taskSeq: workspace.taskSeq });

  const newTaskId = createId();
  await db.insert(task).values({
    id: newTaskId,
    seqNumber: taskSeq,
    workspaceId,
    listId,
    statusId: original.statusId,
    title: `Copy of ${original.title}`,
    description: original.description,
    priority: original.priority,
    reporterId: session.user.id,
    orderIndex: taskSeq * 1000,
  });

  // Duplicate checklists + items
  const originalChecklists = await db
    .select()
    .from(checklist)
    .where(eq(checklist.taskId, taskId))
    .orderBy(asc(checklist.orderIndex));

  for (const cl of originalChecklists) {
    const newChecklistId = createId();
    await db.insert(checklist).values({
      id: newChecklistId,
      taskId: newTaskId,
      name: cl.name,
      orderIndex: cl.orderIndex,
    });

    const items = await db
      .select()
      .from(checklistItem)
      .where(eq(checklistItem.checklistId, cl.id))
      .orderBy(asc(checklistItem.orderIndex));

    for (const item of items) {
      await db.insert(checklistItem).values({
        id: createId(),
        checklistId: newChecklistId,
        title: item.title,
        isChecked: false,
        orderIndex: item.orderIndex,
      });
    }
  }

  await writeActivityLog(newTaskId, session.user.id, "task_created", { duplicatedFrom: taskId });
  if (listId) revalidateList(workspaceId, spaceId, listId); else revalidateSpace(workspaceId, spaceId);
  return { taskId: newTaskId };
}

// ─── Move task ────────────────────────────────────────────────────────────────

export async function moveTask(
  workspaceId: string,
  spaceId: string,
  taskId: string,
  targetListId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permErr = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (permErr) return permErr;

  const [t] = await db.select({ listId: task.listId, statusId: task.statusId }).from(task).where(eq(task.id, taskId)).limit(1);
  if (!t) return { error: "Task not found" };

  // Find matching status in target list by name
  const [currentStatus] = t.statusId
    ? await db.select({ name: listStatus.name }).from(listStatus).where(eq(listStatus.id, t.statusId)).limit(1)
    : [];

  let newStatusId: string;
  if (currentStatus) {
    const [match] = await db
      .select({ id: listStatus.id })
      .from(listStatus)
      .where(and(eq(listStatus.listId, targetListId), eq(listStatus.name, currentStatus.name)))
      .limit(1);

    if (match) {
      newStatusId = match.id;
    } else {
      const [firstOpen] = await db
        .select({ id: listStatus.id })
        .from(listStatus)
        .where(and(eq(listStatus.listId, targetListId), eq(listStatus.type, "OPEN")))
        .orderBy(asc(listStatus.orderIndex))
        .limit(1);
      if (!firstOpen) return { error: "Target list has no statuses" };
      newStatusId = firstOpen.id;
    }
  } else {
    // Task has no current status — use the first OPEN status in the target list
    const [firstOpen] = await db
      .select({ id: listStatus.id })
      .from(listStatus)
      .where(and(eq(listStatus.listId, targetListId), eq(listStatus.type, "OPEN")))
      .orderBy(asc(listStatus.orderIndex))
      .limit(1);
    if (!firstOpen) return { error: "Target list has no statuses" };
    newStatusId = firstOpen.id;
  }

  await db
    .update(task)
    .set({
      listId: targetListId,
      statusId: newStatusId,
      isPinnedToList: false,
      pinnedToListBy: null,
      pinnedToListAt: null,
      pinnedToListOrder: null,
      updatedAt: new Date(),
    })
    .where(eq(task.id, taskId));

  await writeActivityLog(taskId, session.user.id, "task_moved", {
    fromListId: t.listId,
    toListId: targetListId,
  });

  revalidatePath(`/${workspaceId}`);
  return { ok: true };
}

// ─── Get task activity ────────────────────────────────────────────────────────

export async function getTaskActivity(
  workspaceId: string,
  spaceId: string,
  taskId: string,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permErr = await requireViewAccess(session.user.id, workspaceId, spaceId);
  if (permErr) return permErr;

  const logs = await db
    .select({
      id: activityLog.id,
      eventType: activityLog.eventType,
      meta: activityLog.meta,
      createdAt: activityLog.createdAt,
      userId: activityLog.userId,
      name: user.name,
      email: user.email,
      image: user.image,
    })
    .from(activityLog)
    .leftJoin(user, eq(user.id, activityLog.userId))
    .where(eq(activityLog.taskId, taskId))
    .orderBy(desc(activityLog.createdAt))
    .limit(50);

  return {
    logs: logs.map((l) => ({
      ...l,
      name: l.name ?? "Deleted User",
      email: l.email ?? null,
      image: l.image ?? null,
    })),
  };
}

// ─── Create subtask ──────────────────────────────────────────────────────────

export async function createSubtask(
  workspaceId: string,
  spaceId: string,
  parentTaskId: string,
  title: string,
): Promise<{ taskId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const trimmedTitle = title.trim();
  if (!trimmedTitle) return { error: "Subtask title is required" };

  const [parentTask] = await db
    .select({ id: task.id, listId: task.listId, workspaceId: task.workspaceId, parentTaskId: task.parentTaskId })
    .from(task)
    .where(eq(task.id, parentTaskId))
    .limit(1);
  if (!parentTask) return { error: "Parent task not found" };
  if (parentTask.parentTaskId) return { error: "Cannot nest subtasks more than one level" };

  const listId = parentTask.listId;

  let statusId: string | null = null;
  if (listId) {
    const [firstStatus] = await db
      .select({ id: listStatus.id })
      .from(listStatus)
      .where(and(eq(listStatus.listId, listId), eq(listStatus.type, "OPEN")))
      .orderBy(asc(listStatus.orderIndex))
      .limit(1);

    if (firstStatus) {
      statusId = firstStatus.id;
    } else {
      const [anyStatus] = await db
        .select({ id: listStatus.id })
        .from(listStatus)
        .where(eq(listStatus.listId, listId))
        .orderBy(asc(listStatus.orderIndex))
        .limit(1);
      if (!anyStatus) return { error: "List has no statuses" };
      statusId = anyStatus.id;
    }
  }

  const [{ taskSeq }] = await db
    .update(workspace)
    .set({ taskSeq: sql`${workspace.taskSeq} + 1` })
    .where(eq(workspace.id, workspaceId))
    .returning({ taskSeq: workspace.taskSeq });

  const taskId = createId();

  await db.insert(task).values({
    id: taskId,
    seqNumber: taskSeq,
    workspaceId,
    listId: listId ?? null,
    statusId,
    title: trimmedTitle,
    priority: "NONE",
    reporterId: session.user.id,
    parentTaskId,
    orderIndex: taskSeq * 1000,
  });

  await writeActivityLog(taskId, session.user.id, "subtask_created", { title: trimmedTitle, parentTaskId });
  if (listId) revalidatePath(`/${workspaceId}/${spaceId}/list/${listId}`);
  return { taskId };
}

// ─── Get subtasks ─────────────────────────────────────────────────────────────

export async function getSubtasks(
  workspaceId: string,
  spaceId: string,
  parentTaskId: string,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permErr = await requireViewAccess(session.user.id, workspaceId, spaceId);
  if (permErr) return permErr;

  const subtasks = await db
    .select({
      id: task.id,
      seqNumber: task.seqNumber,
      title: task.title,
      priority: task.priority,
      statusId: task.statusId,
      orderIndex: task.orderIndex,
      statusName: listStatus.name,
      statusColor: listStatus.color,
      statusType: listStatus.type,
    })
    .from(task)
    .leftJoin(listStatus, eq(listStatus.id, task.statusId))
    .where(and(eq(task.parentTaskId, parentTaskId), eq(task.isArchived, false)))
    .orderBy(asc(task.orderIndex));

  return { subtasks };
}

// ─── Log time ─────────────────────────────────────────────────────────────────

export async function logTime(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  durationMinutes: number,
  note?: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  if (durationMinutes <= 0) return { error: "Duration must be positive" };

  await db.insert(timeLog).values({
    id: createId(),
    taskId,
    userId: session.user.id,
    durationMinutes,
    note: note ?? null,
  });

  await writeActivityLog(taskId, session.user.id, "time_logged", { minutes: durationMinutes, note: note ?? null });
  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

// ─── Bulk actions ─────────────────────────────────────────────────────────────

export async function bulkUpdateStatus(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskIds: string[],
  statusId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };
  const permErr = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (permErr) return permErr;

  await db
    .update(task)
    .set({ statusId, updatedAt: new Date() })
    .where(and(inArray(task.id, taskIds), eq(task.listId, listId)));

  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

export async function bulkDeleteTasks(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskIds: string[],
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };
  const permErr = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (permErr) return { error: "You don't have permission to delete tasks" };

  await db
    .delete(task)
    .where(and(inArray(task.id, taskIds), eq(task.listId, listId)));

  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

export async function bulkArchiveTasks(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskIds: string[],
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };
  const permErr = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (permErr) return permErr;

  await db
    .update(task)
    .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(task.id, taskIds), eq(task.listId, listId)));

  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

// ─── bulkMoveTasks ────────────────────────────────────────────────────────────
// Moves tasks to a different list. For each task:
//   1. Status is remapped by name — falls back to first OPEN status.
//   2. Any PLANNED/ACTIVE sprint assignment is cleared (sprint scoping is per-list).
//   3. Activity log entry is written.

export async function bulkMoveTasks(
  workspaceId: string,
  spaceId: string,
  taskIds: string[],
  targetListId: string,
): Promise<{ ok: true; moved: number } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permErr = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (permErr) return permErr;

  if (taskIds.length === 0) return { ok: true, moved: 0 };

  // Pre-fetch all statuses for the target list once
  const targetStatuses = await db
    .select({ id: listStatus.id, name: listStatus.name, type: listStatus.type, orderIndex: listStatus.orderIndex })
    .from(listStatus)
    .where(eq(listStatus.listId, targetListId))
    .orderBy(asc(listStatus.orderIndex));

  if (targetStatuses.length === 0) return { error: "Target list has no statuses" };

  const firstOpen = targetStatuses.find((s) => s.type === "OPEN") ?? targetStatuses[0];

  let moved = 0;
  for (const taskId of taskIds) {
    const [t] = await db
      .select({ listId: task.listId, statusId: task.statusId })
      .from(task)
      .where(eq(task.id, taskId))
      .limit(1);
    if (!t) continue;
    if (t.listId === targetListId) continue; // already there

    // Map status by name
    const [currentStatus] = t.statusId
      ? await db.select({ name: listStatus.name }).from(listStatus).where(eq(listStatus.id, t.statusId)).limit(1)
      : [];

    const newStatusId =
      (currentStatus && targetStatuses.find((s) => s.name === currentStatus.name)?.id) ??
      firstOpen.id;

    // Update task
    await db
      .update(task)
      .set({ listId: targetListId, statusId: newStatusId, updatedAt: new Date() })
      .where(eq(task.id, taskId));

    // Clear any PLANNED/ACTIVE sprint assignment
    const activeSprints = await db
      .select({ sprintId: taskSprint.sprintId })
      .from(taskSprint)
      .innerJoin(sprint, eq(taskSprint.sprintId, sprint.id))
      .where(and(eq(taskSprint.taskId, taskId), inArray(sprint.status, ["PLANNED", "ACTIVE"])));

    if (activeSprints.length > 0) {
      await db
        .delete(taskSprint)
        .where(and(
          eq(taskSprint.taskId, taskId),
          inArray(taskSprint.sprintId, activeSprints.map((r) => r.sprintId)),
        ));
    }

    await writeActivityLog(taskId, session.user.id, "task_moved", {
      fromListId: t.listId,
      toListId: targetListId,
    });

    moved++;
  }

  revalidatePath(`/${workspaceId}`);
  return { ok: true, moved };
}

// ─── Get task location (spaceId + listId) for inbox navigation ───────────────

export async function getTaskLocation(
  workspaceId: string,
  taskId: string,
): Promise<{ spaceId: string; listId: string | null } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const [row] = await db
    .select({ listId: task.listId, taskSpaceId: task.spaceId, listSpaceId: list.spaceId })
    .from(task)
    .leftJoin(list, eq(task.listId, list.id))
    .where(and(eq(task.id, taskId), eq(task.workspaceId, workspaceId)))
    .limit(1);

  if (!row) return { error: "Task not found" };
  const spaceId = row.listSpaceId ?? row.taskSpaceId;
  if (!spaceId) return { error: "Task has no space association" };
  return { spaceId, listId: row.listId };
}

// ─── Get archived tasks for list ──────────────────────────────────────────────

export async function getArchivedTasksForList(
  workspaceId: string,
  spaceId: string,
  listId: string,
): Promise<{ tasks: { id: string; title: string; seqNumber: number }[] } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permErr = await requireViewAccess(session.user.id, workspaceId, spaceId);
  if (permErr) return permErr;

  const tasks = await db
    .select({ id: task.id, title: task.title, seqNumber: task.seqNumber })
    .from(task)
    .where(and(eq(task.listId, listId), eq(task.isArchived, true), isNull(task.parentTaskId)))
    .orderBy(asc(task.orderIndex));

  return { tasks };
}
