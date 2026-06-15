import { db } from "@/lib/db";
import type { WorkspaceMember } from "@prisma/client";

/**
 * Returns the user's active membership in a workspace, or null.
 * Owner/Admin checks should go through this — workspace role first,
 * then space permission (see docs/permission-model.md).
 */
export async function getWorkspaceMembership(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceMember | null> {
  return db.workspaceMember.findFirst({
    where: { workspaceId, userId, status: "ACTIVE" },
  });
}

/**
 * All space ids the user may see in a workspace. The single privacy
 * enforcement query — search, My Tasks, and notifications must all use it
 * (see docs/space.md Implementation Notes).
 */
export async function getAccessibleSpaceIds(
  userId: string,
  workspaceId: string,
): Promise<string[]> {
  const member = await getWorkspaceMembership(userId, workspaceId);
  if (!member) return [];

  // Owner and Admin always have implicit access to all spaces
  if (member.role === "OWNER" || member.role === "ADMIN") {
    const all = await db.space.findMany({
      where: { workspaceId, isArchived: false },
      select: { id: true },
    });
    return all.map((s) => s.id);
  }

  // Guests: only spaces they are explicitly a member of
  if (member.role === "GUEST") {
    const memberships = await db.spaceMember.findMany({
      where: { userId, space: { workspaceId, isArchived: false } },
      select: { spaceId: true },
    });
    return memberships.map((m) => m.spaceId);
  }

  // Members: public spaces + private spaces they are explicitly in
  const spaces = await db.space.findMany({
    where: {
      workspaceId,
      isArchived: false,
      OR: [{ isPrivate: false }, { members: { some: { userId } } }],
    },
    select: { id: true },
  });
  return spaces.map((s) => s.id);
}

/** True if the user can see the given space (uses the same rules as above). */
export async function canAccessSpace(
  userId: string,
  workspaceId: string,
  spaceId: string,
): Promise<boolean> {
  const ids = await getAccessibleSpaceIds(userId, workspaceId);
  return ids.includes(spaceId);
}
