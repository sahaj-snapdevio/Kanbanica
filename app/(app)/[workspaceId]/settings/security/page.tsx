import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { workspace } from "@/db/schema";
import { getWorkspaceMembership } from "@/lib/permissions";
import { SecuritySettings } from "@/components/workspace/security-settings";

interface SecurityPageProps {
  params: Promise<{ workspaceId: string }>;
}

export const metadata = { title: "Security — Kanbanica" };

export default async function SecurityPage({ params }: SecurityPageProps) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (membership?.role !== "OWNER") redirect(`/${workspaceId}/settings/general`);

  const [ws] = await db
    .select({ id: workspace.id, name: workspace.name, inviteLinkToken: workspace.inviteLinkToken })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  if (!ws) notFound();

  return (
    <SecuritySettings
      workspaceId={ws.id}
      workspaceName={ws.name}
      inviteLinkToken={ws.inviteLinkToken ?? null}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
    />
  );
}
