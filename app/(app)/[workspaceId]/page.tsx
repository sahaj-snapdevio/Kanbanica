import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { list } from "@/db/schema";
import { getAccessibleSpaceIds, getWorkspaceMembership } from "@/lib/permissions";

interface WorkspaceHomeProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function WorkspaceHomePage({ params }: WorkspaceHomeProps) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  if (!(await getWorkspaceMembership(session.user.id, workspaceId))) notFound();

  const spaceIds = await getAccessibleSpaceIds(session.user.id, workspaceId);
  if (spaceIds.length > 0) {
    const [firstList] = await db
      .select({ id: list.id, spaceId: list.spaceId })
      .from(list)
      .where(and(eq(list.spaceId, spaceIds[0]), eq(list.isArchived, false)))
      .orderBy(asc(list.createdAt))
      .limit(1);

    if (firstList) redirect(`/${workspaceId}/${firstList.spaceId}/list/${firstList.id}`);
  }

  redirect("/onboarding");
}
