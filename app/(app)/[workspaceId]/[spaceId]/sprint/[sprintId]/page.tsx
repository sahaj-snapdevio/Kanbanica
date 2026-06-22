import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { space, workspaceMember, user } from "@/db/schema";
import { canAccessSpace, getSpacePermission, hasPermissionLevel } from "@/lib/permissions";
import { SprintPanel } from "@/components/sprint/sprint-panel";
import { SprintListView } from "@/components/sprint/sprint-list-view";

interface SprintPageProps {
  params: Promise<{ workspaceId: string; spaceId: string; sprintId: string }>;
}

export default async function SprintPage({ params }: SprintPageProps) {
  const { workspaceId, spaceId, sprintId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId);
  if (!accessible) notFound();

  const [currentSpace, permission, membersRaw] = await Promise.all([
    db.select({ id: space.id, name: space.name, color: space.color })
      .from(space)
      .where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId), eq(space.isArchived, false)))
      .limit(1)
      .then((r) => r[0] ?? null),
    getSpacePermission(session.user.id, workspaceId, spaceId),
    db.select({
        userId: workspaceMember.userId,
        name: user.name,
        email: user.email,
      })
      .from(workspaceMember)
      .innerJoin(user, eq(user.id, workspaceMember.userId))
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.status, "ACTIVE"))),
  ]);

  if (!currentSpace) notFound();

  const isAdmin = permission !== null && hasPermissionLevel(permission, "full_access");
  const canEdit = permission !== null && hasPermissionLevel(permission, "edit");

  const members = membersRaw.map((m) => ({
    userId: m.userId ?? "",
    name: m.name,
    email: m.email,
  }));

  void sprintId; // param used for routing, data fetched via getActiveSprintView

  return (
    <div className="space-y-5 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          {currentSpace.color && (
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: currentSpace.color }} />
          )}
          {currentSpace.name}
        </span>
        <span className="text-muted-foreground">/</span>
        <h1 className="font-semibold">Sprints</h1>
      </div>

      <SprintPanel workspaceId={workspaceId} spaceId={spaceId} />

      <SprintListView
        workspaceId={workspaceId}
        spaceId={spaceId}
        isAdmin={isAdmin}
        canEdit={canEdit}
        members={members}
      />
    </div>
  );
}
