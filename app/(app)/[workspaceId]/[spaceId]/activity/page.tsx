import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SpaceActivityFeed } from "@/components/space/space-activity-feed";
import { auth } from "@/lib/auth";
import { canAccessSpace } from "@/lib/permissions";

interface Props {
  params: Promise<{ workspaceId: string; spaceId: string }>;
}

export default async function SpaceActivityPage({ params }: Props) {
  const { workspaceId, spaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const accessible = await canAccessSpace(
    session.user.id,
    workspaceId,
    spaceId
  );
  if (!accessible) {
    redirect(`/${workspaceId}`);
  }

  return <SpaceActivityFeed spaceId={spaceId} workspaceId={workspaceId} />;
}

export const metadata = { title: "Project Activity" };
