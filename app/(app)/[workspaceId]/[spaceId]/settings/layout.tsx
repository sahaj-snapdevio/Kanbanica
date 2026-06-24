import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SpaceSettingsNav } from "@/components/space/space-settings-nav";
import { space, spaceMember } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";

interface SpaceSettingsLayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

export default async function SpaceSettingsLayout({
  children,
  params,
}: SpaceSettingsLayoutProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const { workspaceId, spaceId } = await params;

  const wm = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!wm) {
    notFound();
  }

  const isAdmin = wm.role === "OWNER" || wm.role === "ADMIN";

  if (!isAdmin) {
    const [sm] = await db
      .select({ permission: spaceMember.permission })
      .from(spaceMember)
      .where(
        and(
          eq(spaceMember.spaceId, spaceId),
          eq(spaceMember.userId, session.user.id)
        )
      );
    if (sm?.permission !== "FULL_ACCESS") {
      redirect(`/${workspaceId}`);
    }
  }

  const [s] = await db
    .select({ name: space.name })
    .from(space)
    .where(and(eq(space.id, spaceId), eq(space.workspaceId, workspaceId)));
  if (!s) {
    notFound();
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{s.name} — Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage this Project
        </p>
      </div>
      <SpaceSettingsNav spaceId={spaceId} workspaceId={workspaceId} />
      {children}
    </div>
  );
}
