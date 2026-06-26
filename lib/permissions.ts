import { and, eq } from "drizzle-orm";
import { space, spaceMember, workspaceMember } from "@/db/schema";
import { db } from "@/lib/db";

// ─── Permission level helpers ─────────────────────────────────────────────────

const LEVEL_ORDER: Record<"view" | "edit" | "full_access", number> = {
  view: 0,
  edit: 1,
  full_access: 2,
};

// Returns true if `permission` satisfies the minimum level.
// full_access >= edit >= view
export function hasPermissionLevel(
  permission: "full_access" | "edit" | "view",
  minLevel: "view" | "edit" | "full_access",
): boolean {
  return LEVEL_ORDER[permission] >= LEVEL_ORDER[minLevel];
}

// Returns the user's effective space permission level, or null if they have no access.
// Owner/Admin always return "full_access" even without a SpaceMember record.
export async function getSpacePermission(
  userId: string,
  workspaceId: string,
  spaceId: string,
): Promise<"full_access" | "edit" | "view" | null> {
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) return null;

  if (membership.role === "OWNER" || membership.role === "ADMIN") return "full_access";

  const [sm] = await db
    .select({ permission: spaceMember.permission })
    .from(spaceMember)
    .where(and(eq(spaceMember.spaceId, spaceId), eq(spaceMember.userId, userId)))
    .limit(1);

  if (!sm) return null;

  // Map DB enum values (FULL_ACCESS / EDIT / VIEW) to lowercase union
  const map: Record<string, "full_access" | "edit" | "view"> = {
    FULL_ACCESS: "full_access",
    EDIT: "edit",
    VIEW: "view",
  };
  return map[sm.permission] ?? null;
}

// Returns { error, status } if the user does not have at least the required permission level.
// For private spaces with no access, returns status 404 to avoid leaking existence.
// Returns null if access is granted.
export async function requireSpacePermission(
  userId: string,
  workspaceId: string,
  spaceId: string,
  minLevel: "view" | "edit" | "full_access",
): Promise<{ error: string; status: number } | null> {
  const permission = await getSpacePermission(userId, workspaceId, spaceId);

  if (permission === null) {
    // No access — check if space is private to decide 404 vs 403
    const [spaceRow] = await db
      .select({ isPrivate: space.isPrivate })
      .from(space)
      .where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId)))
      .limit(1);

    if (!spaceRow || spaceRow.isPrivate) {
      return { error: "Not found", status: 404 };
    }
    return { error: "Forbidden", status: 403 };
  }

  if (!hasPermissionLevel(permission, minLevel)) {
    return { error: "Forbidden", status: 403 };
  }

  return null;
}

// ─── Workspace membership ─────────────────────────────────────────────────────

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

export async function getAccessibleSpaceIds(
  userId: string,
  workspaceId: string,
  archivedOnly = false,
): Promise<string[]> {
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) return [];

  const archivedFilter = eq(space.isArchived, archivedOnly);

  // Owner/Admin see all spaces
  if (membership.role === "OWNER" || membership.role === "ADMIN") {
    const spaces = await db
      .select({ id: space.id })
      .from(space)
      .where(and(eq(space.workspaceId, workspaceId), archivedFilter));
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
          archivedFilter,
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
          archivedFilter,
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
          archivedFilter,
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
