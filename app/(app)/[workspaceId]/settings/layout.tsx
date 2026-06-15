import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getWorkspaceMembership } from "@/lib/permissions";
import { SettingsNav } from "@/components/workspace/settings-nav";

interface SettingsLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}

export default async function SettingsLayout({ children, params }: SettingsLayoutProps) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  // Settings are Admin+ only — everyone else back to the workspace
  if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
    redirect(`/${workspaceId}`);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Workspace Settings</h1>
      <div className="flex flex-col gap-6 md:flex-row">
        <SettingsNav workspaceId={workspaceId} isOwner={membership.role === "OWNER"} />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
