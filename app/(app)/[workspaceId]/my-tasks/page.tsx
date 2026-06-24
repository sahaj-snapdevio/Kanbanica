import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MyTasksView } from "@/components/my-tasks/my-tasks-view";
import { auth } from "@/lib/auth";
import { getWorkspaceMembership } from "@/lib/permissions";

interface Props {
  params: Promise<{ workspaceId: string }>;
}

export default async function MyTasksPage({ params }: Props) {
  const { workspaceId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) {
    redirect("/");
  }

  return <MyTasksView workspaceId={workspaceId} />;
}

export const metadata = { title: "My Tasks" };
