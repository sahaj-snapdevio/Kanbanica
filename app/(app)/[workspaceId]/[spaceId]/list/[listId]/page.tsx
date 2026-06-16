import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { list, listStatus, task, taskTag, tag, space, spaceMember, taskAssignee, user, workspaceMember } from "@/db/schema";
import { canAccessSpace, getWorkspaceMembership } from "@/lib/permissions";
import { ListContainer } from "./_components/list-container";

interface ListPageProps {
  params: Promise<{ workspaceId: string; spaceId: string; listId: string }>;
}

export default async function ListPage({ params }: ListPageProps) {
  const { workspaceId, spaceId, listId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const [membership, accessible] = await Promise.all([
    getWorkspaceMembership(session.user.id, workspaceId),
    canAccessSpace(session.user.id, workspaceId, spaceId),
  ]);
  if (!membership || !accessible) notFound();

  const isAdminOrOwner = membership.role === "OWNER" || membership.role === "ADMIN";

  // Determine canManage: OWNER/ADMIN always can; others need FULL_ACCESS in spaceMember
  let canManage = isAdminOrOwner;
  if (!isAdminOrOwner) {
    const [sm] = await db
      .select({ permission: spaceMember.permission })
      .from(spaceMember)
      .where(and(eq(spaceMember.userId, session.user.id), eq(spaceMember.spaceId, spaceId)))
      .limit(1);
    canManage = sm?.permission === "FULL_ACCESS";
  }

  const [currentSpace, currentList] = await Promise.all([
    db
      .select({ id: space.id, name: space.name, color: space.color })
      .from(space)
      .where(eq(space.id, spaceId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({ id: list.id, name: list.name, color: list.color, description: list.description })
      .from(list)
      .where(and(eq(list.id, listId), eq(list.spaceId, spaceId), eq(list.isArchived, false)))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  if (!currentList || !currentSpace) notFound();

  const [statuses, tasks, memberRows, allTags] = await Promise.all([
    db
      .select()
      .from(listStatus)
      .where(eq(listStatus.listId, listId))
      .orderBy(asc(listStatus.orderIndex)),
    db
      .select({
        id: task.id,
        title: task.title,
        priority: task.priority,
        statusId: task.statusId,
        seqNumber: task.seqNumber,
        orderIndex: task.orderIndex,
        dueDateStart: task.dueDateStart,
        dueDateEnd: task.dueDateEnd,
      })
      .from(task)
      .where(and(eq(task.listId, listId), eq(task.isArchived, false), isNull(task.parentTaskId)))
      .orderBy(asc(task.orderIndex)),
    db
      .select({ userId: workspaceMember.userId, name: user.name, email: user.email })
      .from(workspaceMember)
      .leftJoin(user, eq(workspaceMember.userId, user.id))
      .where(eq(workspaceMember.workspaceId, workspaceId)),
    db
      .select({ id: tag.id, name: tag.name, color: tag.color })
      .from(tag)
      .where(eq(tag.workspaceId, workspaceId)),
  ]);

  // Fetch tags + assignees for all tasks in parallel
  const taskIds = tasks.map((t) => t.id);

  const [tagRows, assigneeRows] = await Promise.all([
    taskIds.length > 0
      ? db
          .select({ taskId: taskTag.taskId, id: tag.id, name: tag.name, color: tag.color })
          .from(taskTag)
          .innerJoin(tag, eq(taskTag.tagId, tag.id))
          .where(inArray(taskTag.taskId, taskIds))
      : Promise.resolve([]),

    taskIds.length > 0
      ? db
          .select({
            taskId: taskAssignee.taskId,
            userId: taskAssignee.userId,
            name: user.name,
            email: user.email,
            image: user.image,
          })
          .from(taskAssignee)
          .innerJoin(user, eq(user.id, taskAssignee.userId))
          .where(inArray(taskAssignee.taskId, taskIds))
      : Promise.resolve([]),
  ]);

  const tagsByTaskId = new Map<string, { id: string; name: string; color: string }[]>();
  for (const row of tagRows) {
    const existing = tagsByTaskId.get(row.taskId) ?? [];
    existing.push({ id: row.id, name: row.name, color: row.color ?? "#9CA3AF" });
    tagsByTaskId.set(row.taskId, existing);
  }

  const assigneesByTaskId = new Map<string, { userId: string; name: string; image: string | null }[]>();
  for (const row of assigneeRows) {
    const existing = assigneesByTaskId.get(row.taskId) ?? [];
    existing.push({ userId: row.userId, name: row.name || row.email, image: row.image });
    assigneesByTaskId.set(row.taskId, existing);
  }

  const tasksWithTags = tasks.map((t) => ({
    ...t,
    tags: tagsByTaskId.get(t.id) ?? [],
    assignees: assigneesByTaskId.get(t.id) ?? [],
  }));

  const members = memberRows
    .filter((m) => m.userId)
    .map((m) => ({ userId: m.userId!, name: m.name, email: m.email }));

  return (
    <ListContainer
      workspaceId={workspaceId}
      space={currentSpace}
      list={currentList}
      statuses={statuses}
      tasks={tasksWithTags}
      members={members}
      tags={allTags}
      canManage={canManage}
      isAdmin={isAdminOrOwner}
    />
  );
}
