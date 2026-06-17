"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  sprint,
  taskSprint,
  task,
  listStatus,
  list,
  taskAssignee,
  taskTag,
  tag,
  user,
} from "@/db/schema";
import { canAccessSpace, getSpacePermission, hasPermissionLevel } from "@/lib/permissions";
import { writeActivityLog } from "@/lib/activity-log";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// View-level access: read sprint data, backlog, active sprint view
async function requireAccess(userId: string, workspaceId: string, spaceId: string) {
  const accessible = await canAccessSpace(userId, workspaceId, spaceId);
  if (!accessible) return { error: "Unauthorized" } as const;
  return null;
}

// Full-access: create, start, close, delete sprints; manage sprint tasks
async function requireFullAccess(userId: string, workspaceId: string, spaceId: string) {
  const permission = await getSpacePermission(userId, workspaceId, spaceId);
  if (permission === null) return { error: "Forbidden" } as const;
  if (!hasPermissionLevel(permission, "full_access")) {
    return { error: "You need Full Access to manage sprints" } as const;
  }
  return null;
}

function revalidateList(workspaceId: string, spaceId: string, listId: string) {
  revalidatePath(`/${workspaceId}/${spaceId}/list/${listId}`);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function incrementSprintName(name: string): string {
  const match = name.match(/^(.*?)(\d+)(\s*)$/);
  if (match) {
    return `${match[1]}${parseInt(match[2], 10) + 1}${match[3]}`;
  }
  return `${name} 2`;
}

// ─── getSprints ───────────────────────────────────────────────────────────────

export async function getSprints(
  workspaceId: string,
  spaceId: string,
  listId: string,
): Promise<
  | {
      sprints: {
        id: string;
        name: string;
        goal: string | null;
        status: "PLANNED" | "ACTIVE" | "CLOSED";
        startDate: Date | null;
        endDate: Date | null;
        createdAt: Date;
      }[];
    }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const rows = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      status: sprint.status,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      createdAt: sprint.createdAt,
    })
    .from(sprint)
    .where(and(eq(sprint.listId, listId), eq(sprint.workspaceId, workspaceId)))
    .orderBy(desc(sprint.createdAt));

  return { sprints: rows };
}

// ─── createSprint ─────────────────────────────────────────────────────────────

export async function createSprint(
  workspaceId: string,
  spaceId: string,
  listId: string,
  data: {
    name: string;
    goal?: string;
    startDate: Date;
    durationWeeks: number;
    autoCreateNext?: boolean;
    autoCloseOnNext?: boolean;
    autoIncompleteStrategy?: "move_to_backlog" | "move_to_next_sprint" | "leave_as_is";
  },
): Promise<{ sprintId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const name = data.name.trim();
  if (!name) return { error: "Sprint name is required" };
  if (data.durationWeeks < 1) return { error: "Duration must be at least 1 week" };

  const [currentList] = await db
    .select({ id: list.id })
    .from(list)
    .where(and(eq(list.id, listId), eq(list.spaceId, spaceId), eq(list.isArchived, false)))
    .limit(1);
  if (!currentList) return { error: "List not found" };

  const startDate = new Date(data.startDate);
  const endDate = addDays(startDate, data.durationWeeks * 7);
  const sprintId = createId();
  const now = new Date();

  await db.insert(sprint).values({
    id: sprintId,
    listId,
    workspaceId,
    name,
    goal: data.goal ?? null,
    status: "PLANNED",
    startDate,
    endDate,
    durationWeeks: data.durationWeeks,
    autoCreateNext: data.autoCreateNext ?? false,
    autoCloseOnNext: data.autoCloseOnNext ?? false,
    autoIncompleteStrategy: data.autoIncompleteStrategy ?? "move_to_backlog",
    createdBy: session.user.id,
    createdAt: now,
    updatedAt: now,
  });

  revalidateList(workspaceId, spaceId, listId);

  return { sprintId };
}

// ─── startSprint ──────────────────────────────────────────────────────────────

export async function startSprint(
  workspaceId: string,
  spaceId: string,
  listId: string,
  sprintId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const [activeSprint] = await db
    .select({ id: sprint.id })
    .from(sprint)
    .where(and(eq(sprint.listId, listId), eq(sprint.status, "ACTIVE")))
    .limit(1);

  if (activeSprint) return { error: "Another sprint is already active in this list" };

  const [targetSprint] = await db
    .select({ id: sprint.id, status: sprint.status })
    .from(sprint)
    .where(and(eq(sprint.id, sprintId), eq(sprint.listId, listId), eq(sprint.workspaceId, workspaceId)))
    .limit(1);

  if (!targetSprint) return { error: "Sprint not found" };
  if (targetSprint.status !== "PLANNED") return { error: "Only PLANNED sprints can be started" };

  const now = new Date();
  await db
    .update(sprint)
    .set({ status: "ACTIVE", startDate: now, updatedAt: now })
    .where(eq(sprint.id, sprintId));

  revalidateList(workspaceId, spaceId, listId);

  return { ok: true };
}

// ─── deleteSprint ─────────────────────────────────────────────────────────────

export async function deleteSprint(
  workspaceId: string,
  spaceId: string,
  listId: string,
  sprintId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const [targetSprint] = await db
    .select({ id: sprint.id, status: sprint.status })
    .from(sprint)
    .where(and(eq(sprint.id, sprintId), eq(sprint.listId, listId), eq(sprint.workspaceId, workspaceId)))
    .limit(1);

  if (!targetSprint) return { error: "Sprint not found" };
  if (targetSprint.status !== "PLANNED") return { error: "Only PLANNED sprints can be deleted" };

  await db.delete(taskSprint).where(eq(taskSprint.sprintId, sprintId));
  await db.delete(sprint).where(eq(sprint.id, sprintId));

  revalidateList(workspaceId, spaceId, listId);

  return { ok: true };
}

// ─── getSprintWithTasks ───────────────────────────────────────────────────────

export async function getSprintWithTasks(
  workspaceId: string,
  spaceId: string,
  sprintId: string,
): Promise<
  | {
      sprint: {
        id: string;
        name: string;
        goal: string | null;
        status: "PLANNED" | "ACTIVE" | "CLOSED";
        startDate: Date | null;
        endDate: Date | null;
      };
      tasks: {
        id: string;
        title: string;
        seqNumber: number;
        priority: string | null;
        statusId: string;
        statusName: string;
        statusColor: string | null;
        statusType: "OPEN" | "ACTIVE" | "CLOSED";
        storyPoints: number | null;
      }[];
    }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const [targetSprint] = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      status: sprint.status,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    })
    .from(sprint)
    .where(and(eq(sprint.id, sprintId), eq(sprint.workspaceId, workspaceId)))
    .limit(1);

  if (!targetSprint) return { error: "Sprint not found" };

  const tasks = await db
    .select({
      id: task.id,
      title: task.title,
      seqNumber: task.seqNumber,
      priority: task.priority,
      statusId: task.statusId,
      statusName: listStatus.name,
      statusColor: listStatus.color,
      statusType: listStatus.type,
      storyPoints: taskSprint.points,
    })
    .from(taskSprint)
    .innerJoin(task, eq(taskSprint.taskId, task.id))
    .innerJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(eq(taskSprint.sprintId, sprintId));

  return { sprint: targetSprint, tasks };
}

// ─── addTaskToSprint ──────────────────────────────────────────────────────────

export async function addTaskToSprint(
  workspaceId: string,
  spaceId: string,
  listId: string,
  sprintId: string,
  taskId: string,
  storyPoints?: number,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const [targetTask] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.listId, listId), eq(task.isArchived, false)))
    .limit(1);
  if (!targetTask) return { error: "Task not found" };

  // Check task is not already in a PLANNED or ACTIVE sprint
  const existingRows = await db
    .select({ sprintId: taskSprint.sprintId })
    .from(taskSprint)
    .innerJoin(sprint, eq(taskSprint.sprintId, sprint.id))
    .where(
      and(
        eq(taskSprint.taskId, taskId),
        inArray(sprint.status, ["PLANNED", "ACTIVE"]),
      ),
    );

  if (existingRows.length > 0) {
    return { error: "Task is already in an active or planned sprint" };
  }

  await db.insert(taskSprint).values({
    taskId,
    sprintId,
    points: storyPoints ?? null,
    addedAt: new Date(),
  });

  revalidateList(workspaceId, spaceId, listId);

  return { ok: true };
}

// ─── removeTaskFromSprint ─────────────────────────────────────────────────────

export async function removeTaskFromSprint(
  workspaceId: string,
  spaceId: string,
  listId: string,
  sprintId: string,
  taskId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  await db
    .delete(taskSprint)
    .where(and(eq(taskSprint.taskId, taskId), eq(taskSprint.sprintId, sprintId)));

  revalidateList(workspaceId, spaceId, listId);

  return { ok: true };
}

// ─── updateStoryPoints ────────────────────────────────────────────────────────

export async function updateStoryPoints(
  workspaceId: string,
  spaceId: string,
  sprintId: string,
  taskId: string,
  storyPoints: number | null,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const [row] = await db
    .select({ taskId: taskSprint.taskId })
    .from(taskSprint)
    .where(and(eq(taskSprint.taskId, taskId), eq(taskSprint.sprintId, sprintId)))
    .limit(1);

  if (!row) return { error: "Task not found in sprint" };

  await db
    .update(taskSprint)
    .set({ points: storyPoints })
    .where(and(eq(taskSprint.taskId, taskId), eq(taskSprint.sprintId, sprintId)));

  return { ok: true };
}

// ─── markAllSprintTasksDone ───────────────────────────────────────────────────

export async function markAllSprintTasksDone(
  workspaceId: string,
  spaceId: string,
  listId: string,
  sprintId: string,
): Promise<{ affected: number } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  // Find first CLOSED-type status in the list
  const [closedStatus] = await db
    .select({ id: listStatus.id })
    .from(listStatus)
    .where(and(eq(listStatus.listId, listId), eq(listStatus.type, "CLOSED")))
    .orderBy(asc(listStatus.orderIndex))
    .limit(1);

  if (!closedStatus) return { error: "No closed status found in this list" };

  // Get all tasks in the sprint that are not already in a CLOSED status
  const sprintTasks = await db
    .select({ taskId: taskSprint.taskId, statusType: listStatus.type })
    .from(taskSprint)
    .innerJoin(task, eq(taskSprint.taskId, task.id))
    .innerJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(and(eq(taskSprint.sprintId, sprintId), eq(task.isArchived, false)));

  const incompleteTasks = sprintTasks.filter((t) => t.statusType !== "CLOSED");

  if (incompleteTasks.length === 0) return { affected: 0 };

  const incompleteTaskIds = incompleteTasks.map((t) => t.taskId);
  const now = new Date();

  await db
    .update(task)
    .set({ statusId: closedStatus.id, updatedAt: now })
    .where(inArray(task.id, incompleteTaskIds));

  await Promise.allSettled(
    incompleteTaskIds.map((taskId) =>
      writeActivityLog(taskId, session.user.id, "status_changed", {
        to: closedStatus.id,
        reason: "mark_all_done_sprint",
      }),
    ),
  );

  revalidateList(workspaceId, spaceId, listId);

  return { affected: incompleteTasks.length };
}

// ─── closeSprint ──────────────────────────────────────────────────────────────

export async function closeSprint(
  workspaceId: string,
  spaceId: string,
  listId: string,
  sprintId: string,
  strategy: "move_to_backlog" | "move_to_next_sprint" | "leave_as_is",
  targetSprintId?: string,
): Promise<{ ok: true; nextSprintId?: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const [targetSprint] = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      status: sprint.status,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    })
    .from(sprint)
    .where(and(eq(sprint.id, sprintId), eq(sprint.listId, listId), eq(sprint.workspaceId, workspaceId)))
    .limit(1);

  if (!targetSprint) return { error: "Sprint not found" };
  if (targetSprint.status !== "ACTIVE") return { error: "Only ACTIVE sprints can be closed" };

  // Find incomplete tasks in this sprint
  const sprintTasks = await db
    .select({ taskId: taskSprint.taskId, statusType: listStatus.type })
    .from(taskSprint)
    .innerJoin(task, eq(taskSprint.taskId, task.id))
    .innerJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(and(eq(taskSprint.sprintId, sprintId), eq(task.isArchived, false)));

  const incompleteTasks = sprintTasks.filter((t) => t.statusType !== "CLOSED");
  const incompleteTaskIds = incompleteTasks.map((t) => t.taskId);

  if (strategy === "move_to_backlog") {
    if (incompleteTaskIds.length > 0) {
      await db
        .delete(taskSprint)
        .where(
          and(
            eq(taskSprint.sprintId, sprintId),
            inArray(taskSprint.taskId, incompleteTaskIds),
          ),
        );
    }
  } else if (strategy === "move_to_next_sprint" && targetSprintId) {
    const [nextSprint] = await db
      .select({ id: sprint.id, status: sprint.status })
      .from(sprint)
      .where(and(eq(sprint.id, targetSprintId), eq(sprint.listId, listId)))
      .limit(1);

    if (nextSprint && nextSprint.status === "PLANNED" && incompleteTaskIds.length > 0) {
      await db
        .delete(taskSprint)
        .where(
          and(
            eq(taskSprint.sprintId, sprintId),
            inArray(taskSprint.taskId, incompleteTaskIds),
          ),
        );

      const now = new Date();
      await db.insert(taskSprint).values(
        incompleteTaskIds.map((taskId) => ({
          taskId,
          sprintId: targetSprintId,
          points: null,
          addedAt: now,
        })),
      );
    } else if (incompleteTaskIds.length > 0) {
      // Fall back: move to backlog
      await db
        .delete(taskSprint)
        .where(
          and(
            eq(taskSprint.sprintId, sprintId),
            inArray(taskSprint.taskId, incompleteTaskIds),
          ),
        );
    }
  }
  // leave_as_is: no changes to tasks

  const now = new Date();
  await db
    .update(sprint)
    .set({ status: "CLOSED", updatedAt: now })
    .where(eq(sprint.id, sprintId));

  revalidateList(workspaceId, spaceId, listId);

  return { ok: true };
}

// ─── createNextSprintFromClosed ───────────────────────────────────────────────

export async function createNextSprintFromClosed(
  workspaceId: string,
  spaceId: string,
  listId: string,
  closedSprintId: string,
): Promise<{ sprintId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  const [closedSprint] = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      status: sprint.status,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    })
    .from(sprint)
    .where(and(eq(sprint.id, closedSprintId), eq(sprint.workspaceId, workspaceId)))
    .limit(1);

  if (!closedSprint) return { error: "Sprint not found" };
  if (closedSprint.status !== "CLOSED") return { error: "Can only create next sprint from a CLOSED sprint" };

  const prevStart = closedSprint.startDate ?? new Date();
  const prevEnd = closedSprint.endDate ?? new Date();
  const durationDays = Math.round((prevEnd.getTime() - prevStart.getTime()) / (1000 * 60 * 60 * 24));
  const durationWeeks = Math.max(1, Math.round(durationDays / 7));

  const newStartDate = closedSprint.endDate ? addDays(closedSprint.endDate, 1) : new Date();
  const newEndDate = addDays(newStartDate, durationWeeks * 7);
  const newName = incrementSprintName(closedSprint.name);

  const sprintId = createId();
  const now = new Date();

  await db.insert(sprint).values({
    id: sprintId,
    listId,
    workspaceId,
    name: newName,
    goal: null,
    status: "PLANNED",
    startDate: newStartDate,
    endDate: newEndDate,
    createdBy: session.user.id,
    createdAt: now,
    updatedAt: now,
  });

  revalidateList(workspaceId, spaceId, listId);

  return { sprintId };
}

// ─── getBacklogTasks ──────────────────────────────────────────────────────────

export async function getBacklogTasks(
  workspaceId: string,
  spaceId: string,
  listId: string,
): Promise<
  | {
      tasks: {
        id: string;
        title: string;
        seqNumber: number;
        priority: string | null;
        statusId: string;
        orderIndex: number;
      }[];
    }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  // Find sprint IDs that are PLANNED or ACTIVE for this list
  const activeSprintRows = await db
    .select({ id: sprint.id })
    .from(sprint)
    .where(
      and(
        eq(sprint.listId, listId),
        inArray(sprint.status, ["PLANNED", "ACTIVE"]),
      ),
    );

  const activeSprintIds = activeSprintRows.map((s) => s.id);

  const baseConditions = [
    eq(task.listId, listId),
    eq(task.isArchived, false),
    isNull(task.parentTaskId),
  ];

  if (activeSprintIds.length === 0) {
    // No active/planned sprints — all tasks are backlog
    const tasks = await db
      .select({
        id: task.id,
        title: task.title,
        seqNumber: task.seqNumber,
        priority: task.priority,
        statusId: task.statusId,
        orderIndex: task.orderIndex,
      })
      .from(task)
      .where(and(...baseConditions))
      .orderBy(asc(task.orderIndex));

    return { tasks };
  }

  // Find task IDs that ARE in an active/planned sprint
  const tasksInSprintRows = await db
    .select({ taskId: taskSprint.taskId })
    .from(taskSprint)
    .where(inArray(taskSprint.sprintId, activeSprintIds));

  const taskIdsInSprints = tasksInSprintRows.map((r) => r.taskId);

  const tasks =
    taskIdsInSprints.length > 0
      ? await db
          .select({
            id: task.id,
            title: task.title,
            seqNumber: task.seqNumber,
            priority: task.priority,
            statusId: task.statusId,
            orderIndex: task.orderIndex,
          })
          .from(task)
          .where(and(...baseConditions, notInArray(task.id, taskIdsInSprints)))
          .orderBy(asc(task.orderIndex))
      : await db
          .select({
            id: task.id,
            title: task.title,
            seqNumber: task.seqNumber,
            priority: task.priority,
            statusId: task.statusId,
            orderIndex: task.orderIndex,
          })
          .from(task)
          .where(and(...baseConditions))
          .orderBy(asc(task.orderIndex));

  return { tasks };
}

// ─── getActiveSprintView ──────────────────────────────────────────────────────
// Full data for rendering sprint tasks in the list-view table layout.

export async function getActiveSprintView(
  workspaceId: string,
  spaceId: string,
  listId: string,
): Promise<
  | {
      sprint: {
        id: string;
        name: string;
        goal: string | null;
        startDate: Date | null;
        endDate: Date | null;
        status: "PLANNED" | "ACTIVE" | "CLOSED";
      } | null;
      tasks: {
        id: string;
        title: string;
        seqNumber: number;
        priority: string | null;
        statusId: string;
        orderIndex: number;
        dueDateStart: Date | null;
        dueDateEnd: Date | null;
        tags: { id: string; name: string; color: string }[];
        assignees: { userId: string; name: string; image: string | null }[];
      }[];
    }
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const err = await requireAccess(session.user.id, workspaceId, spaceId);
  if (err) return err;

  // Find active sprint for this list
  const [activeSprint] = await db
    .select({
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      status: sprint.status,
    })
    .from(sprint)
    .where(and(eq(sprint.listId, listId), eq(sprint.status, "ACTIVE")))
    .limit(1);

  if (!activeSprint) return { sprint: null, tasks: [] };

  // Get tasks in this sprint
  const sprintTasks = await db
    .select({
      id: task.id,
      title: task.title,
      seqNumber: task.seqNumber,
      priority: task.priority,
      statusId: task.statusId,
      orderIndex: task.orderIndex,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
    })
    .from(taskSprint)
    .innerJoin(task, eq(task.id, taskSprint.taskId))
    .where(and(eq(taskSprint.sprintId, activeSprint.id), eq(task.isArchived, false)))
    .orderBy(asc(task.orderIndex));

  if (sprintTasks.length === 0) return { sprint: activeSprint, tasks: [] };

  const taskIds = sprintTasks.map((t) => t.id);

  const [tagRows, assigneeRows] = await Promise.all([
    db
      .select({ taskId: taskTag.taskId, id: tag.id, name: tag.name, color: tag.color })
      .from(taskTag)
      .innerJoin(tag, eq(taskTag.tagId, tag.id))
      .where(inArray(taskTag.taskId, taskIds)),
    db
      .select({
        taskId: taskAssignee.taskId,
        userId: taskAssignee.userId,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(taskAssignee)
      .innerJoin(user, eq(user.id, taskAssignee.userId))
      .where(inArray(taskAssignee.taskId, taskIds)),
  ]);

  const tagsByTask = new Map<string, { id: string; name: string; color: string }[]>();
  for (const r of tagRows) {
    const arr = tagsByTask.get(r.taskId) ?? [];
    arr.push({ id: r.id, name: r.name, color: r.color ?? "#9CA3AF" });
    tagsByTask.set(r.taskId, arr);
  }

  const assigneesByTask = new Map<string, { userId: string; name: string; image: string | null }[]>();
  for (const r of assigneeRows) {
    const arr = assigneesByTask.get(r.taskId) ?? [];
    arr.push({ userId: r.userId, name: r.name || r.email, image: r.image });
    assigneesByTask.set(r.taskId, arr);
  }

  const tasks = sprintTasks.map((t) => ({
    ...t,
    tags: tagsByTask.get(t.id) ?? [],
    assignees: assigneesByTask.get(t.id) ?? [],
  }));

  return { sprint: activeSprint, tasks };
}
