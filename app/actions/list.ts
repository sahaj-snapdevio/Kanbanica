"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, inArray, max, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { list, listStatus, task, taskAttachment, spaceMember, space } from "@/db/schema";
import { getWorkspaceMembership } from "@/lib/permissions";

// ── Permission helpers ─────────────────────────────────────────────────────

async function getEffectiveSpacePermission(
  userId: string,
  workspaceId: string,
  spaceId: string,
): Promise<"FULL_ACCESS" | "EDIT" | "VIEW" | null> {
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) return null;
  if (membership.role === "OWNER" || membership.role === "ADMIN") return "FULL_ACCESS";

  const [sm] = await db
    .select({ permission: spaceMember.permission })
    .from(spaceMember)
    .where(and(eq(spaceMember.spaceId, spaceId), eq(spaceMember.userId, userId)))
    .limit(1);

  return sm?.permission ?? null;
}

async function requireFullAccess(
  userId: string,
  workspaceId: string,
  spaceId: string,
): Promise<boolean> {
  const perm = await getEffectiveSpacePermission(userId, workspaceId, spaceId);
  return perm === "FULL_ACCESS";
}

// ── Order index helpers ────────────────────────────────────────────────────

async function getNextListOrderIndex(spaceId: string): Promise<number> {
  const [row] = await db
    .select({ maxIdx: max(list.orderIndex) })
    .from(list)
    .where(and(eq(list.spaceId, spaceId), eq(list.isArchived, false)));
  return (row?.maxIdx ?? 0) + 1000;
}

async function getNextStatusOrderIndex(listId: string): Promise<number> {
  const [row] = await db
    .select({ maxIdx: max(listStatus.orderIndex) })
    .from(listStatus)
    .where(eq(listStatus.listId, listId));
  return (row?.maxIdx ?? 0) + 1000;
}

// ── Default statuses ───────────────────────────────────────────────────────

const DEFAULT_STATUSES = [
  { name: "Todo", color: "#6B7280", type: "OPEN" as const, orderIndex: 1000 },
  { name: "In Progress", color: "#3B82F6", type: "ACTIVE" as const, orderIndex: 2000 },
  { name: "Review", color: "#F59E0B", type: "ACTIVE" as const, orderIndex: 3000 },
  { name: "Done", color: "#10B981", type: "CLOSED" as const, orderIndex: 4000 },
];

// ── List CRUD ──────────────────────────────────────────────────────────────

export async function createList(
  workspaceId: string,
  spaceId: string,
  data: { name: string; color?: string; description?: string },
): Promise<{ listId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const canManage = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (!canManage) return { error: "You need Full Access to create lists in this space" };

  const name = data.name.trim();
  if (!name) return { error: "List name is required" };

  const orderIndex = await getNextListOrderIndex(spaceId);
  const listId = createId();

  await db.transaction(async (tx) => {
    await tx.insert(list).values({
      id: listId,
      spaceId,
      name,
      color: data.color ?? null,
      description: data.description ?? null,
      orderIndex,
      createdBy: session.user.id,
    });

    await tx.insert(listStatus).values(
      DEFAULT_STATUSES.map((s) => ({ id: createId(), listId, ...s })),
    );
  });

  revalidatePath(`/${workspaceId}`, "layout");
  return { listId };
}

export async function updateList(
  workspaceId: string,
  spaceId: string,
  listId: string,
  data: { name: string; color?: string | null; description?: string | null },
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const canManage = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (!canManage) return { error: "You need Full Access to edit lists" };

  const name = data.name.trim();
  if (!name) return { error: "List name is required" };

  await db
    .update(list)
    .set({ name, color: data.color ?? null, description: data.description ?? null, updatedAt: new Date() })
    .where(and(eq(list.id, listId), eq(list.spaceId, spaceId)));

  revalidatePath(`/${workspaceId}`, "layout");
  return { ok: true };
}

export async function archiveList(
  workspaceId: string,
  spaceId: string,
  listId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const canManage = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (!canManage) return { error: "You need Full Access to archive lists" };

  await db
    .update(list)
    .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(list.id, listId), eq(list.spaceId, spaceId)));

  revalidatePath(`/${workspaceId}`, "layout");
  return { ok: true };
}

export async function unarchiveList(
  workspaceId: string,
  spaceId: string,
  listId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const canManage = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (!canManage) return { error: "You need Full Access to unarchive lists" };

  await db
    .update(list)
    .set({ isArchived: false, archivedAt: null, updatedAt: new Date() })
    .where(and(eq(list.id, listId), eq(list.spaceId, spaceId)));

  revalidatePath(`/${workspaceId}`, "layout");
  return { ok: true };
}

export async function deleteList(
  workspaceId: string,
  spaceId: string,
  listId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    return { error: "Only Admin and Owner can permanently delete lists" };
  }

  // Collect R2 attachment keys before cascade-deleting
  const tasks = await db.select({ id: task.id }).from(task).where(eq(task.listId, listId));
  const taskIds = tasks.map((t) => t.id);

  if (taskIds.length > 0) {
    const attachments = await db
      .select({ fileUrl: taskAttachment.fileUrl })
      .from(taskAttachment)
      .where(inArray(taskAttachment.taskId, taskIds));

    // TODO: delete from R2 in batches when lib/storage.ts is configured
    // for (let i = 0; i < attachments.length; i += 50) {
    //   await Promise.allSettled(attachments.slice(i, i + 50).map(a => deleteFromR2(a.fileUrl)));
    // }
    void attachments; // referenced to satisfy lint until storage is wired
  }

  await db.delete(list).where(and(eq(list.id, listId), eq(list.spaceId, spaceId)));

  revalidatePath(`/${workspaceId}`, "layout");
  return { ok: true };
}

export async function duplicateList(
  workspaceId: string,
  spaceId: string,
  listId: string,
): Promise<{ listId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const canManage = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (!canManage) return { error: "You need Full Access to duplicate lists" };

  const [source] = await db.select().from(list).where(eq(list.id, listId));
  if (!source) return { error: "List not found" };

  const statuses = await db
    .select()
    .from(listStatus)
    .where(eq(listStatus.listId, listId))
    .orderBy(listStatus.orderIndex);

  const orderIndex = await getNextListOrderIndex(spaceId);
  const newListId = createId();

  await db.transaction(async (tx) => {
    await tx.insert(list).values({
      id: newListId,
      spaceId,
      name: `Copy of ${source.name}`,
      color: source.color,
      description: source.description,
      orderIndex,
      createdBy: session.user.id,
    });

    if (statuses.length > 0) {
      await tx.insert(listStatus).values(
        statuses.map((s) => ({
          id: createId(),
          listId: newListId,
          name: s.name,
          color: s.color,
          type: s.type,
          orderIndex: s.orderIndex,
        })),
      );
    }
  });

  revalidatePath(`/${workspaceId}`, "layout");
  return { listId: newListId };
}

// ── Status management ──────────────────────────────────────────────────────

export async function createListStatus(
  workspaceId: string,
  spaceId: string,
  listId: string,
  data: { name: string; color: string; type: "OPEN" | "ACTIVE" | "CLOSED" },
): Promise<{ statusId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const canManage = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (!canManage) return { error: "You need Full Access to manage statuses" };

  const name = data.name.trim();
  if (!name) return { error: "Status name is required" };

  const orderIndex = await getNextStatusOrderIndex(listId);
  const statusId = createId();

  await db.insert(listStatus).values({
    id: statusId,
    listId,
    name,
    color: data.color,
    type: data.type,
    orderIndex,
  });

  revalidatePath(`/${workspaceId}`, "layout");
  return { statusId };
}

export async function updateListStatus(
  workspaceId: string,
  spaceId: string,
  listId: string,
  statusId: string,
  data: { name?: string; color?: string; type?: "OPEN" | "ACTIVE" | "CLOSED" },
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const canManage = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (!canManage) return { error: "You need Full Access to manage statuses" };

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) updates.name = data.name.trim();
  if (data.color !== undefined) updates.color = data.color;
  if (data.type !== undefined) updates.type = data.type;

  await db
    .update(listStatus)
    .set(updates)
    .where(and(eq(listStatus.id, statusId), eq(listStatus.listId, listId)));

  revalidatePath(`/${workspaceId}`, "layout");
  return { ok: true };
}

export async function deleteListStatus(
  workspaceId: string,
  spaceId: string,
  listId: string,
  statusId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const canManage = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (!canManage) return { error: "You need Full Access to manage statuses" };

  try {
    await db.transaction(async (tx) => {
      const [{ taskCount }] = await tx
        .select({ taskCount: count() })
        .from(task)
        .where(and(eq(task.statusId, statusId), eq(task.isArchived, false)));

      if (taskCount > 0) throw new Error(`TASKS_EXIST:${taskCount}`);

      const [status] = await tx
        .select()
        .from(listStatus)
        .where(eq(listStatus.id, statusId));

      if (status?.type === "CLOSED") {
        const [{ remaining }] = await tx
          .select({ remaining: count() })
          .from(listStatus)
          .where(
            and(
              eq(listStatus.listId, listId),
              eq(listStatus.type, "CLOSED"),
              ne(listStatus.id, statusId),
            ),
          );
        if (remaining === 0) throw new Error("LAST_CLOSED_STATUS");
      }

      await tx.delete(listStatus).where(eq(listStatus.id, statusId));
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.startsWith("TASKS_EXIST:")) {
      const n = msg.split(":")[1];
      return { error: `Reassign or delete the ${n} task(s) using this status first` };
    }
    if (msg === "LAST_CLOSED_STATUS") {
      return { error: "A list must have at least one closed status" };
    }
    throw err;
  }

  revalidatePath(`/${workspaceId}`, "layout");
  return { ok: true };
}

export async function reorderListStatuses(
  workspaceId: string,
  spaceId: string,
  listId: string,
  orderedIds: string[],
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const canManage = await requireFullAccess(session.user.id, workspaceId, spaceId);
  if (!canManage) return { error: "You need Full Access to reorder statuses" };

  await db.transaction(async (tx) => {
    await Promise.all(
      orderedIds.map((id, i) =>
        tx
          .update(listStatus)
          .set({ orderIndex: (i + 1) * 1000, updatedAt: new Date() })
          .where(and(eq(listStatus.id, id), eq(listStatus.listId, listId))),
      ),
    );
  });

  revalidatePath(`/${workspaceId}`, "layout");
  return { ok: true };
}

// ─── getWorkspaceLists ────────────────────────────────────────────────────────

export async function getWorkspaceLists(
  workspaceId: string,
  excludeListId: string,
): Promise<{
  spaces: {
    id: string;
    name: string;
    color: string | null;
    lists: { id: string; name: string; color: string | null }[];
  }[];
} | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) return { error: "Unauthorized" };

  const rows = await db
    .select({
      spaceId:    space.id,
      spaceName:  space.name,
      spaceColor: space.color,
      listId:     list.id,
      listName:   list.name,
      listColor:  list.color,
    })
    .from(space)
    .innerJoin(list, and(eq(list.spaceId, space.id), eq(list.isArchived, false)))
    .where(and(eq(space.workspaceId, workspaceId), eq(space.isArchived, false)))
    .orderBy(space.name, list.name);

  const spaceMap = new Map<string, { id: string; name: string; color: string | null; lists: { id: string; name: string; color: string | null }[] }>();
  for (const r of rows) {
    if (r.listId === excludeListId) continue;
    if (!spaceMap.has(r.spaceId)) {
      spaceMap.set(r.spaceId, { id: r.spaceId, name: r.spaceName, color: r.spaceColor, lists: [] });
    }
    spaceMap.get(r.spaceId)!.lists.push({ id: r.listId, name: r.listName, color: r.listColor });
  }

  return { spaces: [...spaceMap.values()].filter((s) => s.lists.length > 0) };
}

export async function getListStatuses(
  workspaceId: string,
  spaceId: string,
  listId: string,
): Promise<{ id: string; name: string; color: string; type: "OPEN" | "ACTIVE" | "CLOSED"; orderIndex: number }[] | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) return { error: "Unauthorized" };

  const statuses = await db
    .select({ id: listStatus.id, name: listStatus.name, color: listStatus.color, type: listStatus.type, orderIndex: listStatus.orderIndex })
    .from(listStatus)
    .where(eq(listStatus.listId, listId))
    .orderBy(listStatus.orderIndex);

  return statuses;
}
