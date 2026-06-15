import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { MembersManager } from "@/components/workspace/members-manager";

interface MembersPageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function MembersPage({ params }: MembersPageProps) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  if (!workspace) notFound();

  const memberRecords = await db.workspaceMember.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });

  // No FK relation from member to user by design — resolve names in one query
  const userIds = [
    ...new Set(
      memberRecords.flatMap((m) => [m.userId, m.invitedBy].filter((id): id is string => !!id)),
    ),
  ];
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const actor = memberRecords.find((m) => m.userId === session.user.id && m.status === "ACTIVE");
  if (!actor) notFound();

  const members = memberRecords
    .filter((m) => m.status === "ACTIVE" && m.userId)
    .map((m) => {
      const user = userById.get(m.userId!);
      return {
        id: m.id,
        userId: m.userId!,
        name: user?.name ?? "Deleted User",
        email: user?.email ?? "—",
        role: m.role,
        joinedAt: (m.joinedAt ?? m.createdAt).toISOString(),
      };
    });

  const pendingInvites = memberRecords
    .filter((m) => m.status === "INVITED")
    .map((m) => ({
      id: m.id,
      email: m.email ?? "—",
      role: m.role,
      invitedByName: m.invitedBy ? (userById.get(m.invitedBy)?.name ?? "—") : "—",
      sentAt: m.createdAt.toISOString(),
      expiresAt: m.inviteExpiresAt?.toISOString() ?? null,
    }));

  return (
    <MembersManager
      workspaceId={workspaceId}
      workspaceName={workspace.name}
      members={members}
      pendingInvites={pendingInvites}
      currentUserId={session.user.id}
      actorRole={actor.role}
    />
  );
}
