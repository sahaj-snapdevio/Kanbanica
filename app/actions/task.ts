"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
} from "@/db/schema";
import { canAccessSpace, getWorkspaceMembership } from "@/lib/permissions";
import { writeActivityLog } from "@/lib/activity-log";

// ─── Permission helpers ──────────────────────────────────────────────────────

async function requireEditAccess(
  userId: string,
  workspaceId: string,
  spaceId: string,
): Promise<{ error: string } | null> {
  const [membership, accessible] = await Promise.all([
    getWorkspaceMembership(userId, workspaceId),
    canAccessSpace(userId, workspaceId, spaceId),
  ]);
  if (!membership || !accessible) return { error: "Unauthorized" };
  return null;
}

// ─── Revalidation helper ─────────────────────────────────────────────────────

function revalidateList(workspaceId: string, spaceId: string, listId: string) {
  revalidatePath(`/${workspaceId}/${spaceId}/list/${listId}`);
}

// ─── Create Task ─────────────────────────────────────────────────────────────

export async function createTask(
  workspaceId: string,
  spaceId: string,
  listId: string,
  data: { title: string; statusId?: string },
): Promise<{ taskId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const title = data.title.trim();
  if (!title) return { error: "Task title is required" };

  const [currentList] = await db
    .select({ id: list.id })
    .from(list)
    .where(and(eq(list.id, listId), eq(list.spaceId, spaceId), eq(list.isArchived, false)))
    .limit(1);
  if (!currentList) return { error: "List not found or archived" };

  let statusId = data.statusId;
  if (!statusId) {
    const [firstStatus] = await db
      .select({ id: listStatus.id })
      .from(listStatus)
      .where(and(eq(listStatus.listId, listId), eq(listStatus.type, "OPEN")))
      .orderBy(asc(listStatus.orderIndex))
      .limit(1);

    if (!firstStatus) {
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
      listId,
      statusId,
      title,
      priority: "NONE",
      reporterId: session.user.id,
      orderIndex: taskSeq * 1000,
    });
    // Auto-watch: creator
    await tx.insert(taskWatcher).values({ taskId, userId: session.user.id }).onConflictDoNothing();
  });

  await writeActivityLog(taskId, session.user.id, "task_created", { title });
  revalidateList(workspaceId, spaceId, listId);
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

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId);
  if (!accessible) return { error: "Unauthorized" };

  const [t] = await db
    .select()
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  if (!t) return { error: "Task not found" };

  const [assignees, watchers, tags, checklists, dependencies, timeLogs, statuses, snapshot] =
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

      db
        .select()
        .from(listStatus)
        .where(eq(listStatus.listId, t.listId))
        .orderBy(asc(listStatus.orderIndex)),

      db
        .select()
        .from(taskDescriptionSnapshot)
        .where(eq(taskDescriptionSnapshot.taskId, taskId))
        .limit(1)
        .then((r) => r[0] ?? null),
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
  listId: string,
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
    .where(and(eq(task.id, taskId), eq(task.listId, listId)))
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
  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

// ─── Update task status ───────────────────────────────────────────────────────

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

  const [existing] = await db
    .select({ statusId: task.statusId })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  if (!existing) return { error: "Task not found" };

  await db
    .update(task)
    .set({ statusId, updatedAt: new Date() })
    .where(and(eq(task.id, taskId), eq(task.listId, listId)));

  await writeActivityLog(taskId, session.user.id, "status_changed", {
    from: existing.statusId,
    to: statusId,
  });

  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

// ─── Delete task ──────────────────────────────────────────────────────────────

export async function deleteTask(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const [membership, accessible] = await Promise.all([
    getWorkspaceMembership(session.user.id, workspaceId),
    canAccessSpace(session.user.id, workspaceId, spaceId),
  ]);
  if (!membership || !accessible) return { error: "Unauthorized" };

  // Only FULL_ACCESS / Admin / Owner can delete
  const isAdmin = membership.role === "OWNER" || membership.role === "ADMIN";
  // TODO: check space permission for MEMBER with FULL_ACCESS
  if (!isAdmin) return { error: "You don't have permission to delete tasks" };

  await db.delete(task).where(and(eq(task.id, taskId), eq(task.listId, listId)));

  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

// ─── Archive / Unarchive task ─────────────────────────────────────────────────

export async function archiveTask(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  await db
    .update(task)
    .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(task.id, taskId), eq(task.listId, listId)));

  await writeActivityLog(taskId, session.user.id, "task_archived");
  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

export async function unarchiveTask(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireEditAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  await db
    .update(task)
    .set({ isArchived: false, archivedAt: null, updatedAt: new Date() })
    .where(and(eq(task.id, taskId), eq(task.listId, listId)));

  await writeActivityLog(taskId, session.user.id, "task_unarchived");
  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

// ─── Duplicate task ───────────────────────────────────────────────────────────

export async function duplicateTask(
  workspaceId: string,
  spaceId: string,
  listId: string,
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
  revalidateList(workspaceId, spaceId, listId);
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

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) return { error: "Unauthorized" };

  const [t] = await db.select({ listId: task.listId, statusId: task.statusId }).from(task).where(eq(task.id, taskId)).limit(1);
  if (!t) return { error: "Task not found" };

  // Find matching status in target list by name
  const [currentStatus] = await db
    .select({ name: listStatus.name })
    .from(listStatus)
    .where(eq(listStatus.id, t.statusId))
    .limit(1);

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
    return { error: "Current status not found" };
  }

  await db
    .update(task)
    .set({ listId: targetListId, statusId: newStatusId, updatedAt: new Date() })
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

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId);
  if (!accessible) return { error: "Unauthorized" };

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

  return { logs };
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

  await writeActivityLog(taskId, session.user.id, "time_logged", { minutes: durationMinutes });
  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}
