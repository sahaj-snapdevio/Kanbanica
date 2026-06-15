import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleSpaceIds } from "@/lib/permissions";

/**
 * Post-login resolver: routes the user to their first List, or into
 * onboarding when they have no workspace / space yet.
 */
export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const membership = await db.workspaceMember.findFirst({
    where: { userId: session.user.id, status: "ACTIVE", workspace: { status: "ACTIVE" } },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true },
  });
  if (!membership) redirect("/onboarding");

  const spaceIds = await getAccessibleSpaceIds(session.user.id, membership.workspaceId);
  if (spaceIds.length === 0) redirect("/onboarding");

  const list = await db.list.findFirst({
    where: { spaceId: { in: spaceIds }, isArchived: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, spaceId: true },
  });
  if (!list) redirect("/onboarding");

  redirect(`/${membership.workspaceId}/${list.spaceId}/list/${list.id}`);
}
