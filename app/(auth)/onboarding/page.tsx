import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleSpaceIds } from "@/lib/permissions";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { PendingInvites } from "@/components/onboarding/pending-invites";

export const metadata = { title: "Get started — Kanbanica" };

interface OnboardingPageProps {
  searchParams: Promise<{ new?: string }>;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const { new: createNew } = await searchParams;

  // ?new=1 — deliberately creating an additional workspace from the switcher
  if (createNew === "1") {
    return <OnboardingWizard existingWorkspace={null} />;
  }

  const membership = await db.workspaceMember.findFirst({
    where: { userId: session.user.id, status: "ACTIVE", workspace: { status: "ACTIVE" } },
    orderBy: { createdAt: "asc" },
    include: { workspace: { select: { id: true, name: true } } },
  });

  // Already fully onboarded (workspace + at least one space) → into the app
  if (membership) {
    const spaceIds = await getAccessibleSpaceIds(session.user.id, membership.workspaceId);
    if (spaceIds.length > 0) {
      const list = await db.list.findFirst({
        where: { spaceId: { in: spaceIds }, isArchived: false },
        orderBy: { createdAt: "asc" },
        select: { id: true, spaceId: true },
      });
      if (list) redirect(`/${membership.workspaceId}/${list.spaceId}/list/${list.id}`);
    }
  }

  // Pending email invites — surfaced so invited users don't miss them
  const inviteRecords = await db.workspaceMember.findMany({
    where: {
      email: session.user.email.toLowerCase(),
      status: "INVITED",
      workspace: { status: "ACTIVE" },
      OR: [{ inviteExpiresAt: null }, { inviteExpiresAt: { gt: new Date() } }],
    },
    include: { workspace: { select: { name: true } } },
  });
  const inviterIds = [...new Set(inviteRecords.map((i) => i.invitedBy).filter((id): id is string => !!id))];
  const inviters = inviterIds.length
    ? await db.user.findMany({ where: { id: { in: inviterIds } }, select: { id: true, name: true } })
    : [];
  const inviterById = new Map(inviters.map((u) => [u.id, u.name]));
  const invites = inviteRecords
    .filter((i) => i.inviteToken)
    .map((i) => ({
      token: i.inviteToken!,
      workspaceName: i.workspace.name,
      inviterName: i.invitedBy ? (inviterById.get(i.invitedBy) ?? "a teammate") : "a teammate",
    }));

  // Resume at step 2 if the workspace exists but its first Space was never created
  return (
    <div className="space-y-4">
      {invites.length > 0 && <PendingInvites invites={invites} />}
      <OnboardingWizard
        existingWorkspace={
          membership ? { id: membership.workspace.id, name: membership.workspace.name } : null
        }
      />
    </div>
  );
}
