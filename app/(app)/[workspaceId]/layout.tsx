import { and, asc, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import {
  channel,
  list,
  space,
  spaceMember,
  workspace,
  workspaceMember,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getAccessibleSpaceIds,
  getWorkspaceMembership,
} from "@/lib/permissions";

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }
  const userId = session.user.id;

  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) {
    notFound();
  }

  const [ws, allMemberships, spaceIds, channels] = await Promise.all([
    db
      .select({
        id: workspace.id,
        name: workspace.name,
        logoEmoji: workspace.logoEmoji,
        theme: workspace.theme,
        appearanceMode: workspace.appearanceMode,
      })
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
          eq(workspace.status, "ACTIVE")
        )
      )
      .orderBy(asc(workspaceMember.createdAt)),
    getAccessibleSpaceIds(userId, workspaceId),
    db
      .select({
        id: channel.id,
        name: channel.name,
        createdAt: channel.createdAt,
      })
      .from(channel)
      .where(eq(channel.workspaceId, workspaceId))
      .orderBy(asc(channel.createdAt)),
  ]);

  if (!ws) {
    notFound();
  }

  const [spaces, archivedSpaces] = await Promise.all([
    spaceIds.length > 0
      ? db
          .select({
            id: space.id,
            name: space.name,
            color: space.color,
            isPrivate: space.isPrivate,
          })
          .from(space)
          .where(and(inArray(space.id, spaceIds), eq(space.isArchived, false)))
          .orderBy(asc(space.orderIndex), asc(space.createdAt))
      : Promise.resolve([] as { id: string; name: string; color: string | null; isPrivate: boolean }[]),
    spaceIds.length > 0
      ? db
          .select({ id: space.id, name: space.name, color: space.color, isPrivate: space.isPrivate })
          .from(space)
          .where(and(inArray(space.id, spaceIds), eq(space.isArchived, true)))
          .orderBy(asc(space.orderIndex), asc(space.createdAt))
      : Promise.resolve([] as { id: string; name: string; color: string | null; isPrivate: boolean }[]),
  ]);

  const isAdminOrOwner =
    membership.role === "OWNER" || membership.role === "ADMIN";

  const spaceListMap: Record<
    string,
    {
      id: string;
      name: string;
      color: string | null;
      description: string | null;
    }[]
  > = {};
  // Per-space canManageList: OWNER/ADMIN always can; others need FULL_ACCESS in spaceMember
  const spaceCanManageMap: Record<string, boolean> = {};
  const archivedListsBySpace: Record<string, { id: string; name: string; color: string | null; description: string | null }[]> = {};

  if (spaces.length > 0) {
    const spaceIdList = spaces.map((s) => s.id);

    const [lists, spacePermissions, archivedListRows] = await Promise.all([
      db
        .select({
          id: list.id,
          name: list.name,
          spaceId: list.spaceId,
          color: list.color,
          description: list.description,
        })
        .from(list)
        .where(
          and(inArray(list.spaceId, spaceIdList), eq(list.isArchived, false))
        )
        .orderBy(asc(list.orderIndex), asc(list.createdAt)),

      isAdminOrOwner
        ? Promise.resolve([] as { spaceId: string; permission: string }[])
        : db
            .select({
              spaceId: spaceMember.spaceId,
              permission: spaceMember.permission,
            })
            .from(spaceMember)
            .where(
              and(
                eq(spaceMember.userId, userId),
                inArray(spaceMember.spaceId, spaceIdList)
              )
            ),

      // Fetch archived lists for active spaces
      db
        .select({ id: list.id, name: list.name, spaceId: list.spaceId, color: list.color, description: list.description })
        .from(list)
        .where(and(inArray(list.spaceId, spaceIdList), eq(list.isArchived, true)))
        .orderBy(asc(list.orderIndex), asc(list.createdAt)),
    ]);

    for (const l of archivedListRows) {
      if (!archivedListsBySpace[l.spaceId]) archivedListsBySpace[l.spaceId] = [];
      archivedListsBySpace[l.spaceId].push({ id: l.id, name: l.name, color: l.color, description: l.description });
    }

    for (const l of lists) {
      if (!spaceListMap[l.spaceId]) {
        spaceListMap[l.spaceId] = [];
      }
      spaceListMap[l.spaceId].push({
        id: l.id,
        name: l.name,
        color: l.color,
        description: l.description,
      });
    }

    const permMap: Record<string, string> = {};
    for (const sp of spacePermissions) {
      permMap[sp.spaceId] = sp.permission;
    }

    for (const s of spaces) {
      spaceCanManageMap[s.id] =
        isAdminOrOwner || permMap[s.id] === "FULL_ACCESS";
    }
  }

  return (
    <ThemeProvider
      initialAppearanceMode={ws.appearanceMode as "light" | "dark" | "auto"}
      initialTheme={ws.theme}
      workspaceId={workspaceId}
    >
      <WorkspaceShell
        role={membership.role}
        spaces={spaces.map((s) => ({
          ...s,
          lists: spaceListMap[s.id] ?? [],
          archivedLists: archivedListsBySpace[s.id] ?? [],
          canManageList: spaceCanManageMap[s.id] ?? isAdminOrOwner,
        }))}
        archivedSpaces={archivedSpaces.map((s) => ({
          ...s,
          lists: [],
          archivedLists: [],
          canManageList: isAdminOrOwner,
        }))}
        channels={channels}
        user={{ name: session.user.name ?? null, email: session.user.email }}
        workspace={ws}
        workspaces={allMemberships.map((m) => ({
          id: m.workspaceId,
          name: m.name,
          logoEmoji: m.logoEmoji,
        }))}
      >
        {children}
      </WorkspaceShell>
    </ThemeProvider>
  );
}
