/**
 * Auth helpers for server actions.
 *
 * Server actions can't use `lib/api/auth-helpers.ts` because those take a
 * Request object and throw Response objects. These helpers use Next.js `headers()`
 * and return `{ error }` objects compatible with server action return types.
 */

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import * as schema from "@/db/schema";
import type { PermissionValue } from "@/db/schema/types";
import { auth } from "@/lib/auth";
import { checkCubeAccess } from "@/lib/auth-core";
import { db } from "@/lib/db";

export type ActionSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

/**
 * Get the current session from server action context.
 */
export async function getActionSession(): Promise<
  ActionSession | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  // Defense-in-depth: re-check ban status against DB on every request.
  // Better Auth's session cookie cache may serve up to 60 seconds of stale
  // data after a ban; this query closes that window.
  const [userRow] = await db
    .select({
      banned: schema.user.banned,
      banExpires: schema.user.banExpires,
    })
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id))
    .limit(1);

  if (!userRow) {
    return { error: "Account no longer exists" };
  }
  if (userRow.banned) {
    const expired =
      userRow.banExpires && userRow.banExpires.getTime() <= Date.now();
    if (!expired) {
      return { error: "Account is banned" };
    }
  }

  return session;
}

/**
 * Admin-only auth helper for server actions. Mirrors `requireAdmin` in
 * `lib/api/auth-helpers.ts` but follows the server-action `{ error }` return
 * convention. Defense-in-depth: re-checks role + ban status against the DB
 * on every call so a freshly-banned or freshly-demoted admin can't slip
 * through the 60s Better Auth cookie cache window.
 *
 * Returns the same Better Auth session shape that `getActionSession` returns
 * (so `session.user.id` / `session.user.email` work identically).
 */
export async function requireActionAdmin(): Promise<
  ActionSession | { error: string }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }

  const [userRow] = await db
    .select({
      role: schema.user.role,
      banned: schema.user.banned,
      banExpires: schema.user.banExpires,
    })
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id))
    .limit(1);

  if (!userRow) {
    return { error: "Account no longer exists" };
  }
  if (userRow.banned) {
    const expired =
      userRow.banExpires && userRow.banExpires.getTime() <= Date.now();
    if (!expired) {
      return { error: "Account is banned" };
    }
  }
  if (userRow.role !== "admin") {
    return { error: "Forbidden: admin required" };
  }

  return session;
}

/**
 * Require membership in a space with a specific permission.
 * Owners bypass all permission checks.
 */
export async function requireActionMembershipAndPermission(
  userId: string,
  spaceId: string,
  permissionName: PermissionValue
): Promise<
  | { membership: typeof schema.spaceMemberships.$inferSelect }
  | { error: string }
> {
  const [membership] = await db
    .select()
    .from(schema.spaceMemberships)
    .where(
      and(
        eq(schema.spaceMemberships.userId, userId),
        eq(schema.spaceMemberships.spaceId, spaceId)
      )
    )
    .limit(1);

  if (!membership) {
    return { error: "Forbidden: not a member of this space" };
  }

  if (!membership.isOwner) {
    const [perm] = await db
      .select()
      .from(schema.memberPermissions)
      .where(
        and(
          eq(schema.memberPermissions.membershipId, membership.id),
          eq(schema.memberPermissions.permission, permissionName)
        )
      )
      .limit(1);

    if (!perm) {
      return { error: `Forbidden: missing permission ${permissionName}` };
    }
  }

  return { membership };
}

/**
 * Check if a member has access to a specific cube.
 * Owners bypass this check.
 */
export async function requireActionCubeAccess(
  membership: typeof schema.spaceMemberships.$inferSelect,
  cubeId: string
): Promise<{ error: string } | null> {
  const error = await checkCubeAccess(
    membership.id,
    membership.isOwner,
    cubeId
  );
  if (error) {
    return { error };
  }
  return null;
}
