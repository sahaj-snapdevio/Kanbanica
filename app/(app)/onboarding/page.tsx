import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspaceMember, workspace, space, list } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { getAccessibleSpaceIds } from "@/lib/permissions";
import { OnboardingWizard } from "@/components/workspace/onboarding-wizard";

export const metadata = { title: "Get started — Kanbanica" };

interface OnboardingPageProps {
  searchParams: Promise<{ new?: string }>;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { new: createNew } = await searchParams;
  if (createNew === "1") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <OnboardingWizard existingWorkspace={null} userName={session.user.name ?? ""} />
      </div>
    );
  }

  const [membership] = await db
    .select({
      workspaceId: workspaceMember.workspaceId,
      workspaceName: workspace.name,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
    .where(
      and(
        eq(workspaceMember.userId, session.user.id),
        eq(workspaceMember.status, "ACTIVE"),
        eq(workspace.status, "ACTIVE"),
      ),
    )
    .orderBy(asc(workspaceMember.createdAt))
    .limit(1);

  if (membership) {
    const spaceIds = await getAccessibleSpaceIds(session.user.id, membership.workspaceId);
    if (spaceIds.length > 0) {
      const [firstList] = await db
        .select({ id: list.id, spaceId: list.spaceId })
        .from(list)
        .where(and(eq(list.spaceId, spaceIds[0]), eq(list.isArchived, false)))
        .orderBy(asc(list.createdAt))
        .limit(1);
      if (firstList) {
        redirect(`/${membership.workspaceId}/${firstList.spaceId}/list/${firstList.id}`);
      }
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <OnboardingWizard
        existingWorkspace={
          membership ? { id: membership.workspaceId, name: membership.workspaceName } : null
        }
        userName={session.user.name ?? ""}
      />
    </div>
  );
}
