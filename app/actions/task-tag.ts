"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, ilike } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { tag, taskTag } from "@/db/schema";
import { getSpacePermission, hasPermissionLevel, getWorkspaceMembership } from "@/lib/permissions";
import { writeActivityLog } from "@/lib/activity-log";

const TAG_COLORS = [
  "#6B7280", "#EF4444", "#F97316", "#EAB308",
  "#22C55E", "#14B8A6", "#3B82F6", "#8B5CF6",
  "#EC4899", "#F43F5E",
];

function randomTagColor() {
  return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
}

function revalidateList(workspaceId: string, spaceId: string, listId: string) {
  revalidatePath(`/${workspaceId}/${spaceId}/list/${listId}`);
}

export async function getWorkspaceTags(workspaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const tags = await db
    .select({ id: tag.id, name: tag.name, color: tag.color })
    .from(tag)
    .where(eq(tag.workspaceId, workspaceId))
    .orderBy(asc(tag.name));

  return { tags };
}

export async function createTag(
  workspaceId: string,
  name: string,
  color?: string,
): Promise<{ tag: { id: string; name: string; color: string } } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) return { error: "Unauthorized" };

  const trimmed = name.trim();
  if (!trimmed) return { error: "Tag name is required" };

  // Check duplicate
  const [existing] = await db
    .select({ id: tag.id })
    .from(tag)
    .where(and(eq(tag.workspaceId, workspaceId), ilike(tag.name, trimmed)))
    .limit(1);
  if (existing) return { error: "A tag with this name already exists" };

  const tagColor = color ?? randomTagColor();
  const tagId = createId();

  await db.insert(tag).values({
    id: tagId,
    workspaceId,
    name: trimmed,
    color: tagColor,
  });

  return { tag: { id: tagId, name: trimmed, color: tagColor } };
}

export async function addTaskTag(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  tagId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permission = await getSpacePermission(session.user.id, workspaceId, spaceId);
  if (permission === null || !hasPermissionLevel(permission, "edit")) return { error: "Forbidden" };

  await db.insert(taskTag).values({ taskId, tagId }).onConflictDoNothing();

  const [t] = await db.select({ name: tag.name }).from(tag).where(eq(tag.id, tagId)).limit(1);
  await writeActivityLog(taskId, session.user.id, "tag_added", { tagName: t?.name });

  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}

export async function removeTaskTag(
  workspaceId: string,
  spaceId: string,
  listId: string,
  taskId: string,
  tagId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const permission = await getSpacePermission(session.user.id, workspaceId, spaceId);
  if (permission === null || !hasPermissionLevel(permission, "edit")) return { error: "Forbidden" };

  await db
    .delete(taskTag)
    .where(and(eq(taskTag.taskId, taskId), eq(taskTag.tagId, tagId)));

  const [t] = await db.select({ name: tag.name }).from(tag).where(eq(tag.id, tagId)).limit(1);
  await writeActivityLog(taskId, session.user.id, "tag_removed", { tagName: t?.name });

  revalidateList(workspaceId, spaceId, listId);
  return { ok: true };
}
