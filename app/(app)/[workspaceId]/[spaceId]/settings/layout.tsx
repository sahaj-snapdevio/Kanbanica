import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";
import { SpaceSettingsNav } from "@/components/space/space-settings-nav";

interface SpaceSettingsLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

export default async function SpaceSettingsLayout({
  children,
  params,
}: SpaceSettingsLayoutProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { workspaceId, spaceId } = await params;

  const wm = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!wm) notFound();

  const isAdmin = wm.role === "OWNER" || wm.role === "ADMIN";

  // Check space-level access if not workspace admin
  if (!isAdmin) {
    const sm = await db.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId, userId: session.user.id } },
    });
    if (sm?.permission !== "FULL_ACCESS") {
      redirect(`/${workspaceId}`);
    }
  }

  const space = await db.space.findFirst({
    where: { id: spaceId, workspaceId },
    select: { name: true },
  });
  if (!space) notFound();

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{space.name} — Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manage this Space</p>
      </div>
      <SpaceSettingsNav workspaceId={workspaceId} spaceId={spaceId} />
      {children}
    </div>
  );
}
