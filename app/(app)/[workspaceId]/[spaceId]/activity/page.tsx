import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { canAccessSpace } from "@/lib/permissions";
import { SpaceActivityFeed } from "@/components/space/space-activity-feed";

interface Props {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

export default async function SpaceActivityPage({ params }: Props) {
  const { workspaceId, spaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId);
  if (!accessible) redirect(`/${workspaceId}`);

  return <SpaceActivityFeed workspaceId={workspaceId} spaceId={spaceId} />;
}

export const metadata = { title: "Space Activity" };
