import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { list, space } from "@/db/schema";
import {
  canAccessSpace,
  getWorkspaceMembership,
  getSpacePermission,
} from "@/lib/permissions";
import { EmptySpace } from "./_components/empty-space";

interface SpacePageProps {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

export async function generateMetadata({ params }: SpacePageProps): Promise<Metadata> {
  const { spaceId } = await params;
  const spaceRow = await db
    .select({ name: space.name })
    .from(space)
    .where(eq(space.id, spaceId))
    .limit(1)
    .then((r) => r[0]);
  return { title: spaceRow?.name ?? "Space" };
}

export default async function SpacePage({ params }: SpacePageProps) {
  const { workspaceId, spaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const [membership, accessible] = await Promise.all([
    getWorkspaceMembership(session.user.id, workspaceId),
    canAccessSpace(session.user.id, workspaceId, spaceId),
  ]);
  if (!membership || !accessible) notFound();

  const [currentSpace, firstList] = await Promise.all([
    db
      .select({ id: space.id, name: space.name, color: space.color })
      .from(space)
      .where(eq(space.id, spaceId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({ id: list.id })
      .from(list)
      .where(and(eq(list.spaceId, spaceId), eq(list.isArchived, false)))
      .orderBy(asc(list.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  if (!currentSpace) notFound();
  if (firstList) redirect(`/${workspaceId}/${spaceId}/list/${firstList.id}`);

  const isAdminOrOwner = membership.role === "OWNER" || membership.role === "ADMIN";
  const canManage = isAdminOrOwner
    ? true
    : (await getSpacePermission(session.user.id, workspaceId, spaceId)) === "full_access";

  return <EmptySpace workspaceId={workspaceId} space={currentSpace} canManage={canManage} />;
}
