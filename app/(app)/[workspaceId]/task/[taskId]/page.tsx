import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
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
    .select({ id: task.id, listId: task.listId, spaceId: task.spaceId, workspaceId: task.workspaceId })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);

  if (!t || t.workspaceId !== workspaceId) notFound();

  let spaceId: string;
  let listId: string | null = null;
  let listName: string | null = null;

  if (t.listId) {
    const [l] = await db
      .select({ id: list.id, spaceId: list.spaceId, name: list.name })
      .from(list)
      .where(and(eq(list.id, t.listId)))
      .limit(1);
    if (!l) notFound();
    spaceId = l.spaceId;
    listId = l.id;
    listName = l.name;
  } else if (t.spaceId) {
    spaceId = t.spaceId;
  } else {
    notFound();
  }

  const accessible = await canAccessSpace(session.user.id, workspaceId, spaceId!);
  if (!accessible) notFound();

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <TaskDetailPage
        workspaceId={workspaceId}
        spaceId={spaceId!}
        listId={listId ?? ""}
        taskId={taskId}
        listName={listName ?? ""}
      />
    </div>
  );
}
