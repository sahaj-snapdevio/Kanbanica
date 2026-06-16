import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { task, list } from "@/db/schema";
import { canAccessSpace, getWorkspaceMembership } from "@/lib/permissions";
import { TaskDetailPage } from "./_components/task-detail-page";

interface TaskPageProps {
  params: Promise<{ workspaceId: string; taskId: string }>;
}

export default async function TaskPage({ params }: TaskPageProps) {
  const { workspaceId, taskId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const membership = await getWorkspaceMembership(session.user.id, workspaceId);
  if (!membership) notFound();

  const [t] = await db
    .select({ id: task.id, listId: task.listId, workspaceId: task.workspaceId })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);

  if (!t || t.workspaceId !== workspaceId) notFound();

  const [l] = await db
    .select({ id: list.id, spaceId: list.spaceId, name: list.name })
    .from(list)
    .where(eq(list.id, t.listId))
    .limit(1);

  if (!l) notFound();

  const accessible = await canAccessSpace(session.user.id, workspaceId, l.spaceId);
  if (!accessible) notFound();

  return (
    <div className="h-screen flex flex-col overflow-hidden m-0">
      <TaskDetailPage
        workspaceId={workspaceId}
        spaceId={l.spaceId}
        listId={l.id}
        taskId={taskId}
        listName={l.name}
      />
    </div>
  );
}
