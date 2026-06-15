"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";
import { s3Delete } from "@/lib/storage/s3";
import type { SpacePermission } from "@prisma/client";

// ── Permission helpers ────────────────────────────────────────────────────────

/** Returns workspace membership if user is Admin or Owner, else null. */
async function requireWorkspaceAdmin(userId: string, workspaceId: string) {
  const m = await getWorkspaceMembership(userId, workspaceId);
  if (!m || (m.role !== "OWNER" && m.role !== "ADMIN")) return null;
  return m;
}

/**
 * Returns the user's effective access level for a space action:
 * - workspace Owner/Admin → "admin"
 * - SpaceMember with FULL_ACCESS → "full"
 * - else → null (no access)
 */
async function requireSpaceManageAccess(
  userId: string,
  workspaceId: string,
  spaceId: string,
): Promise<"admin" | "full" | null> {
  const wm = await getWorkspaceMembership(userId, workspaceId);
  if (!wm) return null;
  if (wm.role === "OWNER" || wm.role === "ADMIN") return "admin";
  const sm = await db.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
  });
  if (sm?.permission === "FULL_ACCESS") return "full";
  return null;
}

// ── Create Space ─────────────────────────────────────────────────────────────

export async function createSpace(
  workspaceId: string,
  data: { name: string; color: string; isPrivate: boolean },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const admin = await requireWorkspaceAdmin(session.user.id, workspaceId);
  if (!admin) return { error: "Only Admin and Owner can create Spaces" };

  const name = data.name.trim();
  if (!name) return { error: "Space name is required" };

  // Count existing spaces to set order index
  const count = await db.space.count({ where: { workspaceId } });

  const space = await db.$transaction(async (tx) => {
    const newSpace = await tx.space.create({
      data: {
        workspaceId,
        name,
        color: data.color,
        isPrivate: data.isPrivate,
        createdBy: session.user.id,
        orderIndex: count,
      },
    });

    // Creator gets Full Access
    await tx.spaceMember.create({
      data: {
        spaceId: newSpace.id,
        userId: session.user.id,
        permission: "FULL_ACCESS",
      },
    });

    // Auto-create default List
    const list = await tx.list.create({
      data: {
        spaceId: newSpace.id,
        name: "List",
        createdBy: session.user.id,
        orderIndex: 0,
      },
    });

    // Default statuses: Todo, In Progress, Review, Done
    const statuses = [
      { name: "Todo", color: "#6B7280", type: "OPEN" as const, orderIndex: 0 },
      { name: "In Progress", color: "#3B82F6", type: "ACTIVE" as const, orderIndex: 1 },
      { name: "Review", color: "#F59E0B", type: "ACTIVE" as const, orderIndex: 2 },
      { name: "Done", color: "#10B981", type: "CLOSED" as const, orderIndex: 3 },
    ];
    await tx.listStatus.createMany({
      data: statuses.map((s) => ({ listId: list.id, ...s })),
    });

    return newSpace;
  });

  return { spaceId: space.id };
}

// ── Update Space ─────────────────────────────────────────────────────────────

export async function updateSpace(
  workspaceId: string,
  spaceId: string,
  data: { name?: string; color?: string; isPrivate?: boolean },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const access = await requireSpaceManageAccess(session.user.id, workspaceId, spaceId);
  if (!access) return { error: "Insufficient permissions to edit this Space" };

  const name = data.name?.trim();
  if (name !== undefined && !name) return { error: "Space name cannot be empty" };

  await db.space.update({
    where: { id: spaceId, workspaceId },
    data: {
      ...(name !== undefined && { name }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.isPrivate !== undefined && { isPrivate: data.isPrivate }),
    },
  });

  return { ok: true };
}

// ── Archive / Unarchive Space ─────────────────────────────────────────────────

export async function archiveSpace(workspaceId: string, spaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const access = await requireSpaceManageAccess(session.user.id, workspaceId, spaceId);
  if (!access) return { error: "Insufficient permissions to archive this Space" };

  await db.space.update({
    where: { id: spaceId, workspaceId },
    data: { isArchived: true, archivedAt: new Date() },
  });

  return { ok: true };
}

export async function unarchiveSpace(workspaceId: string, spaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  // Unarchive is Admin+ only per docs
  const admin = await requireWorkspaceAdmin(session.user.id, workspaceId);
  if (!admin) return { error: "Only Admin and Owner can unarchive Spaces" };

  await db.space.update({
    where: { id: spaceId, workspaceId },
    data: { isArchived: false, archivedAt: null },
  });

  return { ok: true };
}

// ── Delete Space ─────────────────────────────────────────────────────────────

export async function deleteSpace(workspaceId: string, spaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const admin = await requireWorkspaceAdmin(session.user.id, workspaceId);
  if (!admin) return { error: "Only Admin and Owner can delete Spaces" };

  // R2 files must be deleted before the DB records (orphaned files are unrecoverable)
  const attachments = await db.taskAttachment.findMany({
    where: { task: { list: { spaceId } } },
    select: { fileUrl: true },
  });

  for (const att of attachments) {
    try {
      await s3Delete(att.fileUrl);
    } catch {
      // Log and continue — don't block deletion on R2 failure
    }
  }

  // Delete Space; DB cascades handle all child records
  await db.space.delete({ where: { id: spaceId, workspaceId } });

  return { ok: true };
}

// ── Space Members ─────────────────────────────────────────────────────────────

export async function getSpaceMembers(workspaceId: string, spaceId: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  // Must be an active workspace member with space access
  const wm = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!wm) return { error: "Unauthorized" };

  const members = await db.spaceMember.findMany({
    where: { spaceId },
    select: {
      id: true,
      userId: true,
      permission: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const userIds = members.map((m) => m.userId);
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  return {
    members: members.map((m) => ({
      ...m,
      user: userById.get(m.userId) ?? { id: m.userId, name: null, email: "" },
    })),
  };
}

export async function addSpaceMember(
  workspaceId: string,
  spaceId: string,
  userId: string,
  permission: SpacePermission,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const access = await requireSpaceManageAccess(session.user.id, workspaceId, spaceId);
  if (!access) return { error: "Insufficient permissions to manage Space members" };

  // Target user must be an active workspace member
  const targetMembership = await getWorkspaceMembership(userId, workspaceId);
  if (!targetMembership) return { error: "User is not a member of this workspace" };

  await db.spaceMember.upsert({
    where: { spaceId_userId: { spaceId, userId } },
    create: { spaceId, userId, permission },
    update: { permission },
  });

  return { ok: true };
}

export async function changeSpaceMemberPermission(
  workspaceId: string,
  spaceId: string,
  userId: string,
  permission: SpacePermission,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const access = await requireSpaceManageAccess(session.user.id, workspaceId, spaceId);
  if (!access) return { error: "Insufficient permissions to manage Space members" };

  await db.spaceMember.update({
    where: { spaceId_userId: { spaceId, userId } },
    data: { permission },
  });

  return { ok: true };
}

export async function removeSpaceMember(
  workspaceId: string,
  spaceId: string,
  userId: string,
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Unauthorized" };

  const access = await requireSpaceManageAccess(session.user.id, workspaceId, spaceId);
  if (!access) return { error: "Insufficient permissions to manage Space members" };

  await db.spaceMember.delete({
    where: { spaceId_userId: { spaceId, userId } },
  });

  return { ok: true };
}
