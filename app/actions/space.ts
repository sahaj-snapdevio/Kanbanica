"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createId } from "@paralleldrive/cuid2";
import { and, count, eq, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { list, listStatus, space, spaceMember } from "@/db/schema";
import { getWorkspaceMembership } from "@/lib/permissions";

type SpacePermission = "FULL_ACCESS" | "EDIT" | "VIEW";

async function requireWorkspaceAdmin(userId: string, workspaceId: string) {
  const m = await getWorkspaceMembership(userId, workspaceId);
  if (!m || (m.role !== "OWNER" && m.role !== "ADMIN")) return null;
  return m;
}

const DEFAULT_STATUSES = [
  { name: "Todo", color: "#6B7280", type: "OPEN" as const, orderIndex: 0 },
  { name: "In Progress", color: "#3B82F6", type: "ACTIVE" as const, orderIndex: 1 },
  { name: "Review", color: "#F59E0B", type: "ACTIVE" as const, orderIndex: 2 },
  { name: "Done", color: "#10B981", type: "CLOSED" as const, orderIndex: 3 },
];

export async function createSpace(
  workspaceId: string,
  data: { name: string; color: string; isPrivate: boolean },
): Promise<{ spaceId: string; listId: string } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const admin = await requireWorkspaceAdmin(session.user.id, workspaceId);
  if (!admin) return { error: "Only Admin and Owner can create Spaces" };

  const name = data.name.trim();
  if (!name) return { error: "Space name is required" };

  const existing = await db
    .select({ id: space.id })
    .from(space)
    .where(and(eq(space.workspaceId, workspaceId), eq(space.name, name)))
    .limit(1);
  if (existing.length > 0) return { error: `A space named "${name}" already exists in this workspace` };

  const [{ value: spaceCount }] = await db
    .select({ value: count() })
    .from(space)
    .where(eq(space.workspaceId, workspaceId));

  const spaceId = createId();
  const listId = createId();

  await db.transaction(async (tx) => {
    await tx.insert(space).values({
      id: spaceId,
      workspaceId,
      name,
      color: data.color,
      isPrivate: data.isPrivate,
      createdBy: session.user.id,
      orderIndex: spaceCount,
    });

    await tx.insert(spaceMember).values({
      id: createId(),
      spaceId,
      userId: session.user.id,
      permission: "FULL_ACCESS",
    });

    await tx.insert(list).values({
      id: listId,
      spaceId,
      name: "List",
      createdBy: session.user.id,
      orderIndex: 0,
    });

    await tx.insert(listStatus).values(
      DEFAULT_STATUSES.map((s) => ({ id: createId(), listId, ...s })),
    );
  });

  revalidatePath(`/${workspaceId}`, "layout");
  return { spaceId, listId };
}

// ── Update / Archive / Delete ──────────────────────────────────────────────

export async function updateSpace(
  workspaceId: string,
  spaceId: string,
  data: { name: string; color: string; isPrivate: boolean },
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const name = data.name.trim();
  if (!name) return { error: "Name is required" };

  const existing = await db
    .select({ id: space.id })
    .from(space)
    .where(and(eq(space.workspaceId, workspaceId), eq(space.name, name), ne(space.id, spaceId)))
    .limit(1);
  if (existing.length > 0) return { error: `A space named "${name}" already exists in this workspace` };

  await db
    .update(space)
    .set({ name, color: data.color, isPrivate: data.isPrivate, updatedAt: new Date() })
    .where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId)));

  revalidatePath(`/${workspaceId}`, "layout");
  return { ok: true };
}

export async function archiveSpace(
  workspaceId: string,
  spaceId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  await db
    .update(space)
    .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId)));

  revalidatePath(`/${workspaceId}`, "layout");
  return { ok: true };
}

export async function deleteSpace(
  workspaceId: string,
  spaceId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const m = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!m || (m.role !== "OWNER" && m.role !== "ADMIN")) return { error: "Only admins can delete spaces" };

  await db.delete(space).where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId)));

  revalidatePath(`/${workspaceId}`, "layout");
  return { ok: true };
}

// ── Space Members ──────────────────────────────────────────────────────────

export async function addSpaceMember(
  workspaceId: string,
  spaceId: string,
  userId: string,
  permission: SpacePermission,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  await db.insert(spaceMember).values({
    id: createId(),
    spaceId,
    userId,
    permission,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return { ok: true };
}

export async function changeSpaceMemberPermission(
  workspaceId: string,
  spaceId: string,
  userId: string,
  permission: SpacePermission,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  await db
    .update(spaceMember)
    .set({ permission, updatedAt: new Date() })
    .where(and(eq(spaceMember.spaceId, spaceId), eq(spaceMember.userId, userId)));

  return { ok: true };
}

export async function removeSpaceMember(
  workspaceId: string,
  spaceId: string,
  userId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  await db
    .delete(spaceMember)
    .where(and(eq(spaceMember.spaceId, spaceId), eq(spaceMember.userId, userId)));

  return { ok: true };
}
