import { and, asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_ROLE } from "@/config/platform";
import { list, workspace, workspaceMember } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleSpaceIds } from "@/lib/permissions";

export default async function PostAuthPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  if (session.user.role === ADMIN_ROLE) {
    redirect("/orbit");
  }

  const [membership] = await db
    .select({
      workspaceId: workspaceMember.workspaceId,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
    .where(
      and(
        eq(workspaceMember.userId, session.user.id),
        eq(workspaceMember.status, "ACTIVE"),
        eq(workspace.status, "ACTIVE")
      )
    )
    .orderBy(asc(workspaceMember.createdAt))
    .limit(1);

  if (!membership) {
    redirect("/onboarding");
  }

  const spaceIds = await getAccessibleSpaceIds(
    session.user.id,
    membership.workspaceId
  );
  if (spaceIds.length > 0) {
    const [firstList] = await db
      .select({ id: list.id, spaceId: list.spaceId })
      .from(list)
      .where(and(eq(list.spaceId, spaceIds[0]), eq(list.isArchived, false)))
      .orderBy(asc(list.createdAt))
      .limit(1);

    if (firstList) {
      redirect(
        `/${membership.workspaceId}/${firstList.spaceId}/list/${firstList.id}`
      );
    }
  }

  redirect("/onboarding");
}
