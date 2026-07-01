"use server";

import { headers } from "next/headers";
import { refreshWorkspace } from "@/lib/realtime/refresh";
import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { task, taskDependency, listStatus } from "@/db/schema";
import { canAccessSpace, getSpacePermission, hasPermissionLevel } from "@/lib/permissions";
import { writeActivityLog } from "@/lib/activity-log";

function revalidateList(workspaceId: string, spaceId: string, listId: string) {
  void refreshWorkspace(workspaceId, [`/${workspaceId}/${spaceId}/list/${listId}`]);
}

// DFS cycle detection: returns true if adding taskId -> dependsOnTaskId would create a cycle
async function wouldCreateCycle(taskId: string, dependsOnTaskId: string): Promise<boolean> {
  const visited = new Set<string>();
  const queue = [dependsOnTaskId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const deps = await db
      .select({ dependsOnTaskId: taskDependency.dependsOnTaskId })
      .from(taskDependency)
      .where(eq(taskDependency.taskId, current));

    queue.push(...deps.map((d) => d.dependsOnTaskId));
  }
  return false;
}

export async function addDependency(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  dependsOnTaskId: string,
): Promise<{ dependencyId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permission = await getSpacePermission(session.user.id, workspaceId, spaceId);
  if (permission === null || !hasPermissionLevel(permission, "edit")) return { error: "Forbidden" };

  if (taskId === dependsOnTaskId) return { error: "A task cannot depend on itself" };

  // Verify the dependency target exists and is in the same workspace
  const [target] = await db
    .select({ id: task.id, workspaceId: task.workspaceId })
    .from(task)
    .where(eq(task.id, dependsOnTaskId))
    .limit(1);
  if (!target) return { error: "Target task not found" };
  if (target.workspaceId !== workspaceId) return { error: "Cross-workspace dependencies are not allowed" };

  // Check for existing dependency
  const [existing] = await db
    .select({ id: taskDependency.id })
    .from(taskDependency)
    .where(and(eq(taskDependency.taskId, taskId), eq(taskDependency.dependsOnTaskId, dependsOnTaskId)))
    .limit(1);
  if (existing) return { error: "This dependency already exists" };

  // DFS cycle check
  if (await wouldCreateCycle(taskId, dependsOnTaskId)) {
    return { error: "Adding this dependency would create a circular reference" };
  }

  const depId = createId();
  await db.insert(taskDependency).values({
    id: depId,
    taskId,
    dependsOnTaskId,
    type: "BLOCKED_BY",
  });

  await writeActivityLog(taskId, session.user.id, "dependency_added", { dependsOnTaskId });
  revalidateList(workspaceId, spaceId, listId);
  return { dependencyId: depId };
}

export async function removeDependency(
  workspaceId: string,
  spaceId: string,
  listId: string,
  dependencyId: string,
  taskId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permission = await getSpacePermission(session.user.id, workspaceId, spaceId);
  if (permission === null || !hasPermissionLevel(permission, "edit")) return { error: "Forbidden" };

  const [dep] = await db
    .select({ dependsOnTaskId: taskDependency.dependsOnTaskId })
    .from(taskDependency)
    .where(eq(taskDependency.id, dependencyId))
    .limit(1);

  await db.delete(taskDependency).where(eq(taskDependency.id, dependencyId));

  await writeActivityLog(taskId, session.user.id, "dependency_removed", {
    dependsOnTaskId: dep?.dependsOnTaskId,
  });
  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

// Search tasks for dependency picker
export async function searchTasksForDependency(
  workspaceId: string,
  spaceId: string,
  query: string,
  excludeTaskId: string,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId);
  if (!accessible) return { error: "Unauthorized" };

  if (query.trim().length < 2) return { tasks: [] };

  const results = await db
    .select({
      id: task.id,
      title: task.title,
      seqNumber: task.seqNumber,
      statusId: task.statusId,
      listId: task.listId,
    })
    .from(task)
    .where(
      and(
        eq(task.workspaceId, workspaceId),
        eq(task.isArchived, false),
      ),
    )
    .limit(20);

  const filtered = results.filter(
    (t) =>
      t.id !== excludeTaskId &&
      (t.title.toLowerCase().includes(query.toLowerCase()) ||
        String(t.seqNumber).includes(query.replace("#", ""))),
  );

  return { tasks: filtered.slice(0, 10) };
}
