"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import {
  list,
  listStatus,
  space,
  tag,
  task,
  taskAssignee,
  taskTag,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleSpaceIds } from "@/lib/permissions";

export interface MyTask {
  dueDateEnd: Date | null;
  dueDateStart: Date | null;
  id: string;
  list: { id: string; name: string };
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  seqNumber: number;
  space: { id: string; name: string; color: string | null };
  status: {
    id: string;
    name: string;
    color: string;
    type: "OPEN" | "ACTIVE" | "CLOSED";
  };
  tags: { id: string; name: string; color: string }[];
  title: string;
}

export type MyTasksGroupBy =
  | "due_date"
  | "space"
  | "list"
  | "priority"
  | "status";

export async function getMyTasks(
  workspaceId: string,
  options?: { showCompleted?: boolean }
): Promise<{ tasks: MyTask[] } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const accessibleSpaceIds = await getAccessibleSpaceIds(
    session.user.id,
    workspaceId
  );
  if (accessibleSpaceIds.length === 0) {
    return { tasks: [] };
  }

  // Tasks assigned to me in accessible spaces, not archived
  const assignedTaskIds = await db
    .select({ taskId: taskAssignee.taskId })
    .from(taskAssignee)
    .where(eq(taskAssignee.userId, session.user.id));

  if (assignedTaskIds.length === 0) {
    return { tasks: [] };
  }

  const taskIds = assignedTaskIds.map((r) => r.taskId);

  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      seqNumber: task.seqNumber,
      priority: task.priority,
      dueDateStart: task.dueDateStart,
      dueDateEnd: task.dueDateEnd,
      statusId: listStatus.id,
      statusName: listStatus.name,
      statusColor: listStatus.color,
      statusType: listStatus.type,
      listId: list.id,
      listName: list.name,
      spaceId: space.id,
      spaceName: space.name,
      spaceColor: space.color,
    })
    .from(task)
    .innerJoin(listStatus, eq(task.statusId, listStatus.id))
    .innerJoin(list, eq(task.listId, list.id))
    .innerJoin(space, eq(list.spaceId, space.id))
    .where(
      and(
        inArray(task.id, taskIds),
        inArray(space.id, accessibleSpaceIds),
        eq(task.isArchived, false),
        eq(list.isArchived, false)
      )
    )
    .orderBy(asc(task.dueDateEnd), asc(task.dueDateStart));

  // Filter out completed unless showCompleted
  const filtered = options?.showCompleted
    ? rows
    : rows.filter((r) => r.statusType !== "CLOSED");

  // Fetch tags for these tasks
  const allTaskIds = filtered.map((r) => r.id);
  const tagRows =
    allTaskIds.length > 0
      ? await db
          .select({
            taskId: taskTag.taskId,
            tagId: tag.id,
            tagName: tag.name,
            tagColor: tag.color,
          })
          .from(taskTag)
          .innerJoin(tag, eq(taskTag.tagId, tag.id))
          .where(inArray(taskTag.taskId, allTaskIds))
      : [];

  const tagsByTask = new Map<
    string,
    { id: string; name: string; color: string }[]
  >();
  for (const t of tagRows) {
    const existing = tagsByTask.get(t.taskId) ?? [];
    existing.push({ id: t.tagId, name: t.tagName, color: t.tagColor });
    tagsByTask.set(t.taskId, existing);
  }

  const tasks: MyTask[] = filtered.map((r) => ({
    id: r.id,
    title: r.title,
    seqNumber: r.seqNumber,
    priority: r.priority as MyTask["priority"],
    dueDateStart: r.dueDateStart,
    dueDateEnd: r.dueDateEnd,
    status: {
      id: r.statusId,
      name: r.statusName,
      color: r.statusColor,
      type: r.statusType as MyTask["status"]["type"],
    },
    list: { id: r.listId, name: r.listName },
    space: { id: r.spaceId, name: r.spaceName, color: r.spaceColor },
    tags: tagsByTask.get(r.id) ?? [],
  }));

  return { tasks };
}
