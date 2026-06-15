import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";
import { SpaceMembersManager } from "@/components/space/space-members-manager";

interface PageProps {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

export const metadata = { title: "Space Members — Kanbanica" };

export default async function SpaceMembersPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { workspaceId, spaceId } = await params;

  const wm = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!wm) notFound();

  // Fetch space members with user info
  const spaceMembers = await db.spaceMember.findMany({
    where: { spaceId },
    select: {
      id: true,
      userId: true,
      permission: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const userIds = spaceMembers.map((m) => m.userId);
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const members = spaceMembers.map((m) => ({
    ...m,
    user: userById.get(m.userId) ?? { id: m.userId, name: null, email: "" },
  }));

  // All active workspace members (for the "Add member" dropdown)
  const wsMembersRaw = await db.workspaceMember.findMany({
    where: { workspaceId, status: "ACTIVE", userId: { not: null } },
    select: { userId: true },
  });
  const wsUserIds = wsMembersRaw.map((m) => m.userId).filter((id): id is string => !!id);
  const wsUsers = await db.user.findMany({
    where: { id: { in: wsUserIds } },
    select: { id: true, name: true, email: true },
  });
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
