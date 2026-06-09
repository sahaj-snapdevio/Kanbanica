import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { MembersPage } from "@/components/members-page";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server/session";

export default async function MembersRoute({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // Check membership
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
    redirect("/");
  }

  // Get permissions
  const permissions = membership.isOwner
    ? [...PERMISSION_VALUES]
    : (
        await db
          .select({ permission: schema.memberPermissions.permission })
          .from(schema.memberPermissions)
          .where(eq(schema.memberPermissions.membershipId, membership.id))
      ).map((p) => p.permission);

  // Fetch all members with user info, permissions, and cube assignments
  const memberships = await db
    .select({
      membershipId: schema.spaceMemberships.id,
      userId: schema.spaceMemberships.userId,
      isOwner: schema.spaceMemberships.isOwner,
      userName: schema.user.name,
      userEmail: schema.user.email,
      userImage: schema.user.image,
    })
    .from(schema.spaceMemberships)
    .innerJoin(schema.user, eq(schema.user.id, schema.spaceMemberships.userId))
    .where(eq(schema.spaceMemberships.spaceId, spaceId))
    .orderBy(desc(schema.spaceMemberships.createdAt));

  const membershipIds = memberships.map((m) => m.membershipId);

  const allPerms =
    membershipIds.length > 0
      ? await db
          .select()
          .from(schema.memberPermissions)
          .where(inArray(schema.memberPermissions.membershipId, membershipIds))
      : [];

  const allAssignments =
    membershipIds.length > 0
      ? await db
          .select()
          .from(schema.memberCubeAssignments)
          .where(
            inArray(schema.memberCubeAssignments.membershipId, membershipIds)
          )
      : [];

  const permsMap = new Map<string, typeof allPerms>();
  for (const p of allPerms) {
    const arr = permsMap.get(p.membershipId) ?? [];
    arr.push(p);
    permsMap.set(p.membershipId, arr);
  }

  const assignMap = new Map<string, typeof allAssignments>();
  for (const a of allAssignments) {
    const arr = assignMap.get(a.membershipId) ?? [];
    arr.push(a);
    assignMap.set(a.membershipId, arr);
  }

  const membersWithDetails = memberships.map((m) => ({
    membershipId: m.membershipId,
    userId: m.userId,
    isOwner: m.isOwner,
    name: m.userName,
    email: m.userEmail,
    image: m.userImage,
    permissions: (permsMap.get(m.membershipId) ?? []).map((p) => p.permission),
    cubeAssignments: (assignMap.get(m.membershipId) ?? []).map((a) => a.cubeId),
  }));

  // Fetch active invites (pending or expired) so operators can revoke / resend
  // them. Accepted invites become memberships; revoked ones are hidden — both
  // remain in audit_logs for forensic review.
  const pendingInvites = await db
    .select()
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.spaceId, spaceId),
        or(
          eq(schema.invites.status, "pending"),
          eq(schema.invites.status, "expired")
        )
      )
    )
    .orderBy(desc(schema.invites.createdAt));

  // Fetch Cubes for assignment purposes
  const cubes = await db
    .select({ id: schema.cubes.id, name: schema.cubes.name })
    .from(schema.cubes)
    .where(
      and(eq(schema.cubes.spaceId, spaceId), ne(schema.cubes.status, "deleted"))
    );

  return (
    <MembersPage
      cubes={cubes}
      currentUserId={session.user.id}
      isOwner={membership.isOwner}
      members={membersWithDetails}
      pendingInvites={pendingInvites.map((inv) => ({
        id: inv.id,
        email: inv.email,
        permissions: inv.permissions as string[],
        cubeAssignments: inv.cubeAssignments as string[],
        token: inv.token,
        status: inv.status,
        expiresAt: inv.expiresAt.toISOString(),
        createdAt: inv.createdAt.toISOString(),
      }))}
      permissions={permissions}
      spaceId={spaceId}
    />
  );
}
