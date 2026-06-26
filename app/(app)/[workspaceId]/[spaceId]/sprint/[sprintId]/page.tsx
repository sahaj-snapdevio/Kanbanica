import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { space, sprint, workspaceMember, user } from "@/db/schema";
import { canAccessSpace, getSpacePermission, hasPermissionLevel } from "@/lib/permissions";
import { SprintPageClient } from "./_components/sprint-page-client";

interface SprintPageProps {
  params: Promise<{ workspaceId: string; spaceId: string; sprintId: string }>;
}

export default async function SprintPage({ params }: SprintPageProps) {
  const { workspaceId, spaceId, sprintId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId);
  if (!accessible) notFound();

  const [currentSpace, permission, membersRaw, sprintRow] = await Promise.all([
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
    db.select({ status: sprint.status })
      .from(sprint)
      .where(and(eq(sprint.id, sprintId), eq(sprint.spaceId, spaceId)))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  if (!currentSpace) notFound();
  if (!sprintRow) notFound();

  const isAdmin = permission !== null && hasPermissionLevel(permission, "full_access");
  const canEdit = permission !== null && hasPermissionLevel(permission, "edit");

  const members = membersRaw.map((m) => ({
    userId: m.userId ?? "",
    name: m.name,
    email: m.email,
  }));

  return (
    <div className="space-y-5 p-6">
      <SprintPageClient
        workspaceId={workspaceId}
        spaceId={spaceId}
        sprintId={sprintId}
        sprintStatus={sprintRow.status}
        spaceName={currentSpace.name}
        spaceColor={currentSpace.color}
        isAdmin={isAdmin}
        canEdit={canEdit}
        members={members}
      />
    </div>
  );
}
