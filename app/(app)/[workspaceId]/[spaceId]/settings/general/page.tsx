import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspaceMembership } from "@/lib/permissions";
import { SpaceGeneralSettingsForm } from "@/components/space/space-general-settings-form";

interface PageProps {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { spaceId } = await params;
  const space = await db.space.findUnique({ where: { id: spaceId }, select: { name: true } });
  return { title: `${space?.name ?? "Space"} Settings — Kanbanica` };
}

export default async function SpaceGeneralSettingsPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { workspaceId, spaceId } = await params;

  const space = await db.space.findFirst({
    where: { id: spaceId, workspaceId },
    select: { name: true, color: true, isPrivate: true, isArchived: true },
  });
  if (!space) notFound();

  const wm = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!wm) notFound();
  const isAdmin = wm.role === "OWNER" || wm.role === "ADMIN";

  return (
    <SpaceGeneralSettingsForm
      workspaceId={workspaceId}
      spaceId={spaceId}
      spaceName={space.name}
      spaceColor={space.color}
      isPrivate={space.isPrivate}
      isArchived={space.isArchived}
      isAdmin={isAdmin}
    />
  );
}
