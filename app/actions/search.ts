"use server";

import { endOfDay, endOfWeek, startOfDay, startOfWeek } from "date-fns";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";
import { headers } from "next/headers";
import {
  list,
  listStatus,
  savedFilter,
  space,
  tag,
  task,
  taskAssignee,
  taskTag,
  user,
  userSearchHistory,
  workspaceMember,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessSpace, getAccessibleSpaceIds } from "@/lib/permissions";

// ─── Global Search ──────────────────────────────────────────────────────────

export type SearchTaskResult = {
  id: string;
  title: string;
  seqNumber: number;
  priority: string;
  statusId: string | null;
  statusName: string | null;
  statusColor: string | null;
  statusType: string | null;
  listId: string | null;
  listName: string | null;
  spaceId: string;
  spaceName: string;
  dueDateEnd: Date | null;
  assignees: { userId: string; name: string | null; email: string | null }[];
};

export type SearchListResult = {
  id: string;
  name: string;
  spaceId: string;
  spaceName: string;
};

export type SearchSpaceResult = {
  id: string;
  name: string;
  color: string | null;
  memberCount: number;
};

export type SearchMemberResult = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
};

export type GlobalSearchResults = {
  tasks: SearchTaskResult[];
  lists: SearchListResult[];
  spaces: SearchSpaceResult[];
  members: SearchMemberResult[];
};

export async function globalSearch(
  workspaceId: string,
  query: string
): Promise<GlobalSearchResults | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  if (query.trim().length < 2) {
    return { tasks: [], lists: [], spaces: [], members: [] };
  }

  const accessibleSpaceIds = await getAccessibleSpaceIds(
    session.user.id,
    workspaceId
  );

  if (accessibleSpaceIds.length === 0) {
    return { tasks: [], lists: [], spaces: [], members: [] };
  }

  const q = `%${query.trim()}%`;

  // Tasks
  const taskRows = await db
    .select({
      id: task.id,
      title: task.title,
      seqNumber: task.seqNumber,
      priority: task.priority,
      statusId: task.statusId,
      statusName: listStatus.name,
      statusColor: listStatus.color,
      statusType: listStatus.type,
      listId: list.id,
      listName: list.name,
      spaceId: space.id,
      spaceName: space.name,
      dueDateEnd: task.dueDateEnd,
    })
    .from(task)
    .innerJoin(list, eq(task.listId, list.id))
    .innerJoin(space, eq(list.spaceId, space.id))
    .innerJoin(listStatus, eq(task.statusId, listStatus.id))
    .where(
      and(
        eq(task.workspaceId, workspaceId),
        eq(task.isArchived, false),
        isNull(task.parentTaskId),
        eq(list.isArchived, false),
        inArray(space.id, accessibleSpaceIds),
        ilike(task.title, q)
      )
    )
    .orderBy(desc(task.updatedAt))
    .limit(10);

  // Fetch assignees for found tasks
  const taskIds = taskRows.map((t) => t.id);
  const assigneeMap: Record<
    string,
    { userId: string; name: string | null; email: string | null }[]
  > = {};
  if (taskIds.length > 0) {
    const assigneeRows = await db
      .select({
        taskId: taskAssignee.taskId,
        userId: taskAssignee.userId,
        name: user.name,
        email: user.email,
      })
      .from(taskAssignee)
      .innerJoin(user, eq(taskAssignee.userId, user.id))
      .where(inArray(taskAssignee.taskId, taskIds));

    for (const row of assigneeRows) {
      if (!assigneeMap[row.taskId]) {
        assigneeMap[row.taskId] = [];
      }
      assigneeMap[row.taskId].push({
        userId: row.userId,
        name: row.name,
        email: row.email,
      });
    }
  }

  const tasks: SearchTaskResult[] = taskRows.map((t) => ({
    ...t,
    assignees: assigneeMap[t.id] ?? [],
  }));

  // Lists
  const listRows = await db
    .select({
      id: list.id,
      name: list.name,
      spaceId: space.id,
      spaceName: space.name,
    })
    .from(list)
    .innerJoin(space, eq(list.spaceId, space.id))
    .where(
      and(
        inArray(list.spaceId, accessibleSpaceIds),
        eq(list.isArchived, false),
        ilike(list.name, q)
      )
    )
    .limit(10);

  // Spaces
  const spaceRows = await db
    .select({ id: space.id, name: space.name, color: space.color })
    .from(space)
    .where(
      and(
        eq(space.workspaceId, workspaceId),
        inArray(space.id, accessibleSpaceIds),
        ilike(space.name, q)
      )
    )
    .limit(10);

  // Member count per space (quick approximation via workspaceMember)
  const memberRows = await db
    .select({
      userId: workspaceMember.userId,
      name: user.name,
      email: workspaceMember.email,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .leftJoin(user, eq(workspaceMember.userId, user.id))
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        or(ilike(user.name, q), ilike(workspaceMember.email, q))
      )
    )
    .limit(10);

  return {
    tasks,
    lists: listRows,
    spaces: spaceRows.map((s) => ({ ...s, memberCount: 0 })),
    members: memberRows.map((m) => ({
      userId: m.userId ?? "",
      name: m.name,
      email: m.email,
      role: m.role,
    })),
  };
}

// ─── Recent Search History ───────────────────────────────────────────────────

export async function getRecentSearches(
  workspaceId: string
): Promise<
  | { entityType: string; entityId: string; visitedAt: Date }[]
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const rows = await db
    .select({
      entityType: userSearchHistory.entityType,
      entityId: userSearchHistory.entityId,
      visitedAt: userSearchHistory.visitedAt,
    })
    .from(userSearchHistory)
    .where(
      and(
        eq(userSearchHistory.userId, session.user.id),
        eq(userSearchHistory.workspaceId, workspaceId)
      )
    )
    .orderBy(desc(userSearchHistory.visitedAt))
    .limit(5);

  return rows;
}

export async function recordSearchVisit(
  workspaceId: string,
  entityType: "task" | "list" | "space" | "member",
  entityId: string
): Promise<void | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const userId = session.user.id;

  // Delete existing entry for this entity (upsert via delete + insert)
  await db
    .delete(userSearchHistory)
    .where(
      and(
        eq(userSearchHistory.userId, userId),
        eq(userSearchHistory.workspaceId, workspaceId),
        eq(userSearchHistory.entityType, entityType),
        eq(userSearchHistory.entityId, entityId)
      )
    );

  await db.insert(userSearchHistory).values({
    id: crypto.randomUUID(),
    userId,
    workspaceId,
    entityType,
    entityId,
    visitedAt: new Date(),
  });

  // Trim to last 20 entries
  const all = await db
    .select({ id: userSearchHistory.id })
    .from(userSearchHistory)
    .where(
      and(
        eq(userSearchHistory.userId, userId),
        eq(userSearchHistory.workspaceId, workspaceId)
      )
    )
    .orderBy(desc(userSearchHistory.visitedAt));

  if (all.length > 20) {
    const toDelete = all.slice(20).map((r) => r.id);
    await db
      .delete(userSearchHistory)
      .where(inArray(userSearchHistory.id, toDelete));
  }
}

// ─── Saved Filters ───────────────────────────────────────────────────────────

export type SavedFilterRow = {
  id: string;
  name: string;
  filters: unknown;
  createdAt: Date;
};

export async function getSavedFilters(
  listId: string
): Promise<SavedFilterRow[] | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const rows = await db
    .select({
      id: savedFilter.id,
      name: savedFilter.name,
      filters: savedFilter.filters,
      createdAt: savedFilter.createdAt,
    })
    .from(savedFilter)
    .where(
      and(
        eq(savedFilter.userId, session.user.id),
        eq(savedFilter.listId, listId)
      )
    )
    .orderBy(savedFilter.createdAt);

  return rows;
}

export async function createSavedFilter(
  listId: string,
  name: string,
  filters: object
): Promise<{ id: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const userId = session.user.id;

  const count = await db
    .select({ id: savedFilter.id })
    .from(savedFilter)
    .where(and(eq(savedFilter.userId, userId), eq(savedFilter.listId, listId)));

  if (count.length >= 10) {
    return {
      error:
        "Saved filter limit reached (10 per list). Delete one to save a new filter.",
    };
  }

  const id = crypto.randomUUID();
  await db.insert(savedFilter).values({
    id,
    userId,
    listId,
    name,
    filters,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { id };
}

export async function renameSavedFilter(
  filterId: string,
  name: string
): Promise<void | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const rows = await db
    .select({ userId: savedFilter.userId })
    .from(savedFilter)
    .where(eq(savedFilter.id, filterId));

  if (!rows[0] || rows[0].userId !== session.user.id) {
    return { error: "Not found" };
  }

  await db
    .update(savedFilter)
    .set({ name, updatedAt: new Date() })
    .where(eq(savedFilter.id, filterId));
}

export async function deleteSavedFilter(
  filterId: string
): Promise<void | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const rows = await db
    .select({ userId: savedFilter.userId })
    .from(savedFilter)
    .where(eq(savedFilter.id, filterId));

  if (!rows[0] || rows[0].userId !== session.user.id) {
    return { error: "Not found" };
  }

  await db.delete(savedFilter).where(eq(savedFilter.id, filterId));
}

// ─── List Tasks with Filters ─────────────────────────────────────────────────

export type FilterState = {
  status?: string[];
  priority?: string[];
  assignee?: string[];
  due?: "overdue" | "today" | "this_week" | "no_due_date" | "";
  tags?: string[];
};

export async function getFilteredTasks(
  workspaceId: string,
  spaceId: string,
  listId: string,
  filters: FilterState
): Promise<
  | {
      id: string;
      title: string;
      seqNumber: number;
      priority: string;
      statusId: string | null;
      dueDateEnd: Date | null;
      orderIndex: number;
      tags: { id: string; name: string; color: string }[];
      assignees: {
        userId: string;
        name: string | null;
        image: string | null;
      }[];
    }[]
  | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const accessible = await canAccessSpace(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!accessible) {
    return { error: "Forbidden" };
  }

  // Build where conditions manually
  const conditions: Parameters<typeof and> = [
    eq(task.listId, listId),
    eq(task.isArchived, false),
    isNull(task.parentTaskId),
  ];

  if (filters.status?.length) {
    conditions.push(inArray(task.statusId, filters.status));
  }

  if (filters.priority?.length) {
    conditions.push(
      inArray(
        task.priority,
        filters.priority as ("NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT")[]
      )
    );
  }

  if (filters.due) {
    const now = new Date();
    if (filters.due === "overdue") {
      conditions.push(lt(task.dueDateEnd, now));
    } else if (filters.due === "today") {
      conditions.push(gte(task.dueDateEnd, startOfDay(now)));
      conditions.push(lte(task.dueDateEnd, endOfDay(now)));
    } else if (filters.due === "this_week") {
      conditions.push(gte(task.dueDateEnd, startOfWeek(now)));
      conditions.push(lte(task.dueDateEnd, endOfWeek(now)));
    } else if (filters.due === "no_due_date") {
      conditions.push(isNull(task.dueDateEnd));
    }
  }

  const taskRows = await db
    .select({
      id: task.id,
      title: task.title,
      seqNumber: task.seqNumber,
      priority: task.priority,
      statusId: task.statusId,
      dueDateEnd: task.dueDateEnd,
      orderIndex: task.orderIndex,
    })
    .from(task)
    .where(and(...conditions))
    .orderBy(task.orderIndex);

  if (taskRows.length === 0) {
    return [];
  }

  const ids = taskRows.map((t) => t.id);

  // Fetch tags
  const tagRows = await db
    .select({
      taskId: taskTag.taskId,
      id: tag.id,
      name: tag.name,
      color: tag.color,
    })
    .from(taskTag)
    .innerJoin(tag, eq(taskTag.tagId, tag.id))
    .where(inArray(taskTag.taskId, ids));

  // Fetch assignees
  const assigneeRows = await db
    .select({
      taskId: taskAssignee.taskId,
      userId: taskAssignee.userId,
      name: user.name,
      image: user.image,
    })
    .from(taskAssignee)
    .innerJoin(user, eq(taskAssignee.userId, user.id))
    .where(inArray(taskAssignee.taskId, ids));

  // Build maps
  const tagMap: Record<string, { id: string; name: string; color: string }[]> =
    {};
  for (const r of tagRows) {
    if (!tagMap[r.taskId]) {
      tagMap[r.taskId] = [];
    }
    tagMap[r.taskId].push({ id: r.id, name: r.name, color: r.color });
  }

  const assigneeMap: Record<
    string,
    { userId: string; name: string | null; image: string | null }[]
  > = {};
  for (const r of assigneeRows) {
    if (!assigneeMap[r.taskId]) {
      assigneeMap[r.taskId] = [];
    }
    assigneeMap[r.taskId].push({
      userId: r.userId,
      name: r.name,
      image: r.image ?? null,
    });
  }

  // Filter by assignee in JS (to handle "unassigned" sentinel and OR logic)
  let results = taskRows.map((t) => ({
    ...t,
    tags: tagMap[t.id] ?? [],
    assignees: assigneeMap[t.id] ?? [],
  }));

  if (filters.assignee?.length) {
    const hasUnassigned = filters.assignee.includes("unassigned");
    const userIds = filters.assignee.filter((a) => a !== "unassigned");
    results = results.filter((t) => {
      if (hasUnassigned && t.assignees.length === 0) {
        return true;
      }
      if (
        userIds.length &&
        t.assignees.some((a) => userIds.includes(a.userId))
      ) {
        return true;
      }
      return false;
    });
  }

  // Filter by tags in JS
  if (filters.tags?.length) {
    results = results.filter((t) =>
      t.tags.some((tg) => filters.tags!.includes(tg.id))
    );
  }

  return results;
}
