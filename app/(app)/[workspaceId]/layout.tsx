import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspace, workspaceMember, space, list } from "@/db/schema";
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

  const [ws, allMemberships, spaceIds] = await Promise.all([
    db
      .select({ id: workspace.id, name: workspace.name, logoEmoji: workspace.logoEmoji })
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), eq(workspace.status, "ACTIVE")))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        workspaceId: workspaceMember.workspaceId,
        name: workspace.name,
        logoEmoji: workspace.logoEmoji,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
      .where(
        and(
          eq(workspaceMember.userId, userId),
          eq(workspaceMember.status, "ACTIVE"),
          eq(workspace.status, "ACTIVE"),
        ),
      )
      .orderBy(asc(workspaceMember.createdAt)),
    getAccessibleSpaceIds(userId, workspaceId),
  ]);

  if (!ws) notFound();

  const spaces =
    spaceIds.length > 0
      ? await db
          .select({
            id: space.id,
            name: space.name,
            color: space.color,
            isPrivate: space.isPrivate,
          })
          .from(space)
          .where(and(inArray(space.id, spaceIds), eq(space.isArchived, false)))
          .orderBy(asc(space.orderIndex), asc(space.createdAt))
      : [];

  const spaceListMap: Record<string, { id: string; name: string }[]> = {};
  if (spaces.length > 0) {
    const lists = await db
      .select({ id: list.id, name: list.name, spaceId: list.spaceId })
      .from(list)
      .where(
        and(
          inArray(
            list.spaceId,
            spaces.map((s) => s.id),
          ),
          eq(list.isArchived, false),
        ),
      )
      .orderBy(asc(list.orderIndex), asc(list.createdAt));

    for (const l of lists) {
      if (!spaceListMap[l.spaceId]) spaceListMap[l.spaceId] = [];
      spaceListMap[l.spaceId].push({ id: l.id, name: l.name });
    }
  }

  return (
    <WorkspaceShell
      workspace={ws}
      workspaces={allMemberships.map((m) => ({
        id: m.workspaceId,
        name: m.name,
        logoEmoji: m.logoEmoji,
      }))}
      spaces={spaces.map((s) => ({ ...s, lists: spaceListMap[s.id] ?? [] }))}
      role={membership.role}
      user={{ name: session.user.name ?? null, email: session.user.email }}
    >
      {children}
    </WorkspaceShell>
  );
}
