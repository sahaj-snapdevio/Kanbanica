import { and, eq, inArray } from "drizzle-orm";
import { space, spaceMember, workspaceMember } from "@/db/schema";
import { db } from "@/lib/db";

export async function getWorkspaceMembership(userId: string, workspaceId: string) {
  const [membership] = await db
    .select()
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.userId, userId),
        eq(workspaceMember.status, "ACTIVE"),
      ),
    )
    .limit(1);
  return membership ?? null;
}

export async function getAccessibleSpaceIds(userId: string, workspaceId: string): Promise<string[]> {
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) return [];

  // Owner/Admin see all spaces
  if (membership.role === "OWNER" || membership.role === "ADMIN") {
    const spaces = await db
      .select({ id: space.id })
      .from(space)
      .where(and(eq(space.workspaceId, workspaceId), eq(space.isArchived, false)));
    return spaces.map((s) => s.id);
  }

  // Guest: only explicitly-joined spaces
  if (membership.role === "GUEST") {
    const memberships = await db
      .select({ spaceId: spaceMember.spaceId })
      .from(spaceMember)
      .innerJoin(space, eq(spaceMember.spaceId, space.id))
      .where(
        and(
          eq(spaceMember.userId, userId),
          eq(space.workspaceId, workspaceId),
          eq(space.isArchived, false),
        ),
      );
    return memberships.map((m) => m.spaceId);
  }

  // Member: public spaces + private spaces they are explicitly in
  const [publicSpaces, privateAccess] = await Promise.all([
    db
      .select({ id: space.id })
      .from(space)
      .where(
        and(
          eq(space.workspaceId, workspaceId),
          eq(space.isArchived, false),
          eq(space.isPrivate, false),
        ),
      ),
    db
      .select({ spaceId: spaceMember.spaceId })
      .from(spaceMember)
      .innerJoin(space, eq(spaceMember.spaceId, space.id))
      .where(
        and(
          eq(spaceMember.userId, userId),
          eq(space.workspaceId, workspaceId),
          eq(space.isArchived, false),
          eq(space.isPrivate, true),
        ),
      ),
  ]);

  const ids = new Set([
    ...publicSpaces.map((s) => s.id),
    ...privateAccess.map((m) => m.spaceId),
  ]);
  return [...ids];
}

export async function canAccessSpace(userId: string, workspaceId: string, spaceId: string): Promise<boolean> {
  const ids = await getAccessibleSpaceIds(userId, workspaceId);
  return ids.includes(spaceId);
}
