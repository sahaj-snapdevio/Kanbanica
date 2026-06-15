import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleSpaceIds, getWorkspaceMembership } from "@/lib/permissions";

interface WorkspaceHomeProps {
  params: Promise<{ workspaceId: string }>;
}

/** Workspace home: forwards to the first accessible List. */
export default async function WorkspaceHomePage({ params }: WorkspaceHomeProps) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  if (!(await getWorkspaceMembership(session.user.id, workspaceId))) notFound();

  const spaceIds = await getAccessibleSpaceIds(session.user.id, workspaceId);
  const list = spaceIds.length
    ? await db.list.findFirst({
        where: { spaceId: { in: spaceIds }, isArchived: false },
        orderBy: { createdAt: "asc" },
        select: { id: true, spaceId: true },
      })
    : null;

  if (list) redirect(`/${workspaceId}/${list.spaceId}/list/${list.id}`);
  redirect("/onboarding");
}
