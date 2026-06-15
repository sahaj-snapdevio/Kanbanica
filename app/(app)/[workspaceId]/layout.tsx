import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleSpaceIds, getWorkspaceMembership } from "@/lib/permissions";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}

export default async function WorkspaceLayout({ children, params }: WorkspaceLayoutProps) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const userId = session.user.id;

  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) notFound();

  const [workspace, allMemberships, spaceIds] = await Promise.all([
    db.workspace.findFirst({
      where: { id: workspaceId, status: "ACTIVE" },
      select: { id: true, name: true, logoEmoji: true },
    }),
    db.workspaceMember.findMany({
      where: { userId, status: "ACTIVE", workspace: { status: "ACTIVE" } },
      orderBy: { createdAt: "asc" },
      include: { workspace: { select: { id: true, name: true, logoEmoji: true } } },
    }),
    getAccessibleSpaceIds(userId, workspaceId),
  ]);
  if (!workspace) notFound();

  const spaces = await db.space.findMany({
    where: { id: { in: spaceIds } },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      color: true,
      isPrivate: true,
      lists: {
        where: { isArchived: false },
        orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true },
      },
    },
  });

  return (
    <WorkspaceShell
      workspace={workspace}
      workspaces={allMemberships.map((m) => m.workspace)}
      spaces={spaces}
      role={membership.role}
      user={{ name: session.user.name ?? null, email: session.user.email }}
    >
      {children}
    </WorkspaceShell>
  );
}
