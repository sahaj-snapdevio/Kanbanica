import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspace, workspaceMember } from "@/db/schema";
import { user } from "@/db/schema/auth";
import { MembersManager } from "@/components/workspace/members-manager";
import { PRODUCT_NAME } from "@/config/platform";

interface MembersPageProps {
  params: Promise<{ workspaceId: string }>;
}

export const metadata = { title: `Members — ${PRODUCT_NAME}` };

export default async function MembersPage({ params }: MembersPageProps) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const [ws] = await db
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  if (!ws) notFound();

  const memberRecords = await db
    .select()
    .from(workspaceMember)
    .where(eq(workspaceMember.workspaceId, workspaceId))
    .orderBy(workspaceMember.createdAt);

  const userIds = [
    ...new Set(
      memberRecords.flatMap((m) => [m.userId, m.invitedBy].filter((id): id is string => !!id)),
    ),
  ];

  const users = userIds.length
    ? await db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(user)
        .where(inArray(user.id, userIds))
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const actor = memberRecords.find((m) => m.userId === session.user.id && m.status === "ACTIVE");
  if (!actor) notFound();

  const members = memberRecords
    .filter((m) => m.status === "ACTIVE" && m.userId)
    .map((m) => {
      const u = userById.get(m.userId!);
      return {
        id: m.id,
        userId: m.userId!,
        name: u?.name ?? "Deleted User",
        email: u?.email ?? "—",
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
      workspaceName={ws.name}
      members={members}
      pendingInvites={pendingInvites}
      currentUserId={session.user.id}
      actorRole={actor.role}
    />
  );
}
