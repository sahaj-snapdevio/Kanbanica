import { and, count, desc, eq, isNull, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { SpaceSettings } from "@/components/space-settings";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server/session";

export default async function SettingsPage({
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

  const canManageMembers =
    membership.isOwner || permissions.includes("members.manage");

  // Fetch space
  const [space] = await db
    .select()
    .from(schema.spaces)
    .where(eq(schema.spaces.id, spaceId))
    .limit(1);

  if (!space) {
    redirect("/");
  }

  // Fetch members (needed for ownership transfer in danger zone)
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

  const members = memberships.map((m) => ({
    membershipId: m.membershipId,
    userId: m.userId,
    isOwner: m.isOwner,
    name: m.userName,
    email: m.userEmail,
    image: m.userImage,
    permissions: [] as string[],
    cubeAssignments: [] as string[],
  }));

  // Count how many spaces this user belongs to
  const [{ spaceCount }] = await db
    .select({ spaceCount: count() })
    .from(schema.spaceMemberships)
    .where(eq(schema.spaceMemberships.userId, session.user.id));

  // Check for active cubes, backups, and credit balance to determine if deletion is allowed
  const [{ activeCubeCount }] = await db
    .select({ activeCubeCount: count() })
    .from(schema.cubes)
    .where(
      and(eq(schema.cubes.spaceId, spaceId), ne(schema.cubes.status, "deleted"))
    );

  const [{ backupCount }] = await db
    .select({ backupCount: count() })
    .from(schema.cubeBackups)
    .where(eq(schema.cubeBackups.spaceId, spaceId));

  const hasCredits = Number.parseFloat(space.creditBalance) !== 0;

  // Fetch API keys for this space
  const apiKeys = await db
    .select({
      id: schema.apiKeys.id,
      name: schema.apiKeys.name,
      keyPrefix: schema.apiKeys.keyPrefix,
      lastUsedAt: schema.apiKeys.lastUsedAt,
      createdAt: schema.apiKeys.createdAt,
    })
    .from(schema.apiKeys)
    .where(
      and(eq(schema.apiKeys.spaceId, spaceId), isNull(schema.apiKeys.revokedAt))
    )
    .orderBy(desc(schema.apiKeys.createdAt));

  // Domain claims gate on cube.manage (the permission governing custom domains).
  const canManageDomains =
    membership.isOwner || permissions.includes("cube.manage");

  const claimRows = await db
    .select({
      id: schema.spaceDomainClaims.id,
      domain: schema.spaceDomainClaims.domain,
      status: schema.spaceDomainClaims.status,
      token: schema.spaceDomainClaims.token,
      verifiedAt: schema.spaceDomainClaims.verifiedAt,
      createdAt: schema.spaceDomainClaims.createdAt,
    })
    .from(schema.spaceDomainClaims)
    .where(eq(schema.spaceDomainClaims.spaceId, spaceId))
    .orderBy(desc(schema.spaceDomainClaims.createdAt));

  const domainClaims = claimRows.map((c) => ({
    id: c.id,
    domain: c.domain,
    status: c.status,
    token: c.token,
    verifiedAt: c.verifiedAt ? c.verifiedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <SpaceSettings
      activeCubeCount={activeCubeCount}
      apiKeys={apiKeys}
      backupCount={backupCount}
      canManageDomains={canManageDomains}
      canManageMembers={canManageMembers}
      domainClaims={domainClaims}
      hasCredits={hasCredits}
      isOwner={membership.isOwner}
      members={members}
      space={{ id: space.id, name: space.name }}
      spaceCount={spaceCount}
    />
  );
}
