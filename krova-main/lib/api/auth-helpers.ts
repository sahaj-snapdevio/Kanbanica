import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { PermissionValue, SpaceMembership } from "@/db/schema/types";
import { auth } from "@/lib/auth";
import { checkCubeAccess } from "@/lib/auth-core";
import { db } from "@/lib/db";

export type SessionData = {
  user: {
    id: string;
    email: string;
    name: string;
    role: string | null;
  };
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
  };
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function getSession(
  request: Request
): Promise<SessionData | null> {
  const betterAuthSession = await auth.api.getSession({
    headers: request.headers,
  });

  if (!betterAuthSession) {
    return null;
  }

  const role =
    ((betterAuthSession.user as Record<string, unknown>).role as
      | string
      | null) ?? null;

  return {
    user: {
      id: betterAuthSession.user.id,
      email: betterAuthSession.user.email,
      name: betterAuthSession.user.name,
      role,
    },
    session: {
      id: betterAuthSession.session.id,
      userId: betterAuthSession.session.userId,
      token: betterAuthSession.session.token,
      expiresAt: betterAuthSession.session.expiresAt,
    },
  };
}

export async function requireSession(request: Request): Promise<SessionData> {
  const session = await getSession(request);
  if (!session) {
    throw jsonResponse(401, { error: "Unauthorized" });
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
    throw jsonResponse(401, { error: "Account no longer exists" });
  }

  if (userRow.banned) {
    const expired =
      userRow.banExpires && userRow.banExpires.getTime() <= Date.now();
    if (!expired) {
      throw jsonResponse(403, { error: "Account is banned" });
    }
  }

  return session;
}

export async function requireAdmin(request: Request): Promise<SessionData> {
  const session = await requireSession(request);
  if (session.user.role !== "admin") {
    throw jsonResponse(403, { error: "Forbidden: admin required" });
  }

  // Defense-in-depth: re-verify role against DB. Closes the cookie-cache
  // window where a freshly-demoted admin could still pass this check.
  const [userRow] = await db
    .select({ role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id))
    .limit(1);

  if (userRow?.role !== "admin") {
    throw jsonResponse(403, { error: "Forbidden: admin required" });
  }

  return session;
}

export async function requireSpaceMember(
  request: Request,
  spaceId: string
): Promise<{ session: SessionData; membership: SpaceMembership }> {
  const session = await requireSession(request);

  const [membership] = await db
    .select()
    .from(schema.spaceMemberships)
    .where(
      and(
        eq(schema.spaceMemberships.userId, session.user.id),
        eq(schema.spaceMemberships.spaceId, spaceId)
      )
    )
    .limit(1);

  if (!membership) {
    throw jsonResponse(403, {
      error: "Forbidden: not a member of this space",
    });
  }

  return { session, membership };
}

export async function requirePermission(
  membership: SpaceMembership,
  permissionName: PermissionValue
): Promise<void> {
  if (membership.isOwner) {
    return;
  }

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
    throw jsonResponse(403, {
      error: `Forbidden: missing permission ${permissionName}`,
    });
  }
}

export async function requireCubeAccess(
  membership: SpaceMembership,
  cubeId: string
): Promise<void> {
  const error = await checkCubeAccess(
    membership.id,
    membership.isOwner,
    cubeId
  );
  if (error) {
    throw jsonResponse(403, { error });
  }
}
