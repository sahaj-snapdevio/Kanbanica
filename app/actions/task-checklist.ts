"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, max } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { checklist, checklistItem } from "@/db/schema";
import { canAccessSpace } from "@/lib/permissions";

function revalidateList(workspaceId: string, spaceId: string, listId: string) {
  revalidatePath(`/${workspaceId}/${spaceId}/list/${listId}`);
}

async function requireAccess(userId: string, workspaceId: string, spaceId: string) {
  const accessible = await canAccessSpace(userId, workspaceId, spaceId);
  return accessible;
}

async function nextChecklistOrder(taskId: string) {
  const [row] = await db
    .select({ max: max(checklist.orderIndex) })
    .from(checklist)
    .where(eq(checklist.taskId, taskId));
  return (row?.max ?? 0) + 1000;
}

async function nextItemOrder(checklistId: string) {
  const [row] = await db
    .select({ max: max(checklistItem.orderIndex) })
    .from(checklistItem)
    .where(eq(checklistItem.checklistId, checklistId));
  return (row?.max ?? 0) + 1000;
}

// ─── Checklist CRUD ────────────────────────────────────────────────────────

export async function createChecklist(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  name: string,
): Promise<{ checklistId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  if (!(await requireAccess(session.user.id, workspaceId, spaceId))) return { error: "Unauthorized" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Checklist name is required" };

  const checklistId = createId();
  await db.insert(checklist).values({
    id: checklistId,
    taskId,
    name: trimmed,
    orderIndex: await nextChecklistOrder(taskId),
  });

  revalidateList(workspaceId, spaceId, listId);
  return { checklistId };
}

export async function updateChecklist(
  workspaceId: string,
  spaceId: string,
  listId: string,
  checklistId: string,
  name: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  if (!(await requireAccess(session.user.id, workspaceId, spaceId))) return { error: "Unauthorized" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Name is required" };

  await db
    .update(checklist)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(eq(checklist.id, checklistId));

  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

export async function deleteChecklist(
  workspaceId: string,
  spaceId: string,
  listId: string,
  checklistId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  if (!(await requireAccess(session.user.id, workspaceId, spaceId))) return { error: "Unauthorized" };

  await db.delete(checklist).where(eq(checklist.id, checklistId));

  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

// ─── Checklist Item CRUD ──────────────────────────────────────────────────

export async function addChecklistItem(
  workspaceId: string,
  spaceId: string,
  listId: string,
  checklistId: string,
  title: string,
): Promise<{ itemId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  if (!(await requireAccess(session.user.id, workspaceId, spaceId))) return { error: "Unauthorized" };

  const trimmed = title.trim();
  if (!trimmed) return { error: "Item title is required" };

  const itemId = createId();
  await db.insert(checklistItem).values({
    id: itemId,
    checklistId,
    title: trimmed,
    orderIndex: await nextItemOrder(checklistId),
  });

  revalidateList(workspaceId, spaceId, listId);
  return { itemId };
}

export async function updateChecklistItem(
  workspaceId: string,
  spaceId: string,
  listId: string,
  itemId: string,
  title: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  if (!(await requireAccess(session.user.id, workspaceId, spaceId))) return { error: "Unauthorized" };

  const trimmed = title.trim();
  if (!trimmed) return { error: "Title is required" };

  await db
    .update(checklistItem)
    .set({ title: trimmed, updatedAt: new Date() })
    .where(eq(checklistItem.id, itemId));

  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

export async function toggleChecklistItem(
  workspaceId: string,
  spaceId: string,
  listId: string,
  itemId: string,
): Promise<{ isChecked: boolean } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  if (!(await requireAccess(session.user.id, workspaceId, spaceId))) return { error: "Unauthorized" };

  const [item] = await db
    .select({ isChecked: checklistItem.isChecked })
    .from(checklistItem)
    .where(eq(checklistItem.id, itemId))
    .limit(1);
  if (!item) return { error: "Item not found" };

  const newChecked = !item.isChecked;
  await db
    .update(checklistItem)
    .set({
      isChecked: newChecked,
      checkedBy: newChecked ? session.user.id : null,
      checkedAt: newChecked ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(checklistItem.id, itemId));

  revalidateList(workspaceId, spaceId, listId);
  return { isChecked: newChecked };
}

export async function deleteChecklistItem(
  workspaceId: string,
  spaceId: string,
  listId: string,
  itemId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  if (!(await requireAccess(session.user.id, workspaceId, spaceId))) return { error: "Unauthorized" };

  await db.delete(checklistItem).where(eq(checklistItem.id, itemId));

  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}
