import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";
import { SecuritySettings } from "@/components/workspace/security-settings";

interface SecurityPageProps {
  params: Promise<{ workspaceId: string }>;
}

export default async function SecurityPage({ params }: SecurityPageProps) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  // Security page is Owner-only (docs/settings.md §2.3)
  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (membership?.role !== "OWNER") redirect(`/${workspaceId}/settings/general`);

  const workspace = await db.workspace.findFirst({
    where: { id: workspaceId, status: "ACTIVE" },
    select: { id: true, name: true, inviteLinkToken: true },
  });
  if (!workspace) notFound();

  return (
    <SecuritySettings
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      inviteLinkToken={workspace.inviteLinkToken}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
    />
  );
}
