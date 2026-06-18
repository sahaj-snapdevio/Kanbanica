import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { spaceMember, workspaceMember } from "@/db/schema";
import { user } from "@/db/schema/auth";
import { getWorkspaceMembership } from "@/lib/permissions";
import { SpaceMembersManager } from "@/components/space/space-members-manager";
import { PRODUCT_NAME } from "@/config/platform";

interface PageProps {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

export const metadata = { title: `Space Members — ${PRODUCT_NAME}` };

export default async function SpaceMembersPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { workspaceId, spaceId } = await params;

  const wm = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!wm) notFound();

  const spaceMembers = await db
    .select({ id: spaceMember.id, userId: spaceMember.userId, permission: spaceMember.permission })
    .from(spaceMember)
    .where(eq(spaceMember.spaceId, spaceId))
    .orderBy(spaceMember.createdAt);

  const spaceMemberUserIds = spaceMembers.map((m) => m.userId);
  const spaceUsers = spaceMemberUserIds.length
    ? await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(inArray(user.id, spaceMemberUserIds))
    : [];
  const userById = new Map(spaceUsers.map((u) => [u.id, u]));

  const members = spaceMembers.map((m) => ({
    ...m,
    user: userById.get(m.userId) ?? { id: m.userId, name: null, email: "" },
  }));

  // All active workspace members for the Add dropdown
  const wsMembersRaw = await db
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.status, "ACTIVE")));

  const wsUserIds = wsMembersRaw.map((m) => m.userId).filter((id): id is string => !!id);
  const wsUsers = wsUserIds.length
    ? await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(inArray(user.id, wsUserIds))
    : [];

  const workspaceMembers = wsUsers.map((u) => ({
    userId: u.id,
    name: u.name,
    email: u.email,
  }));

  return (
    <SpaceMembersManager
      workspaceId={workspaceId}
      spaceId={spaceId}
      members={members}
      workspaceMembers={workspaceMembers}
    />
  );
}
