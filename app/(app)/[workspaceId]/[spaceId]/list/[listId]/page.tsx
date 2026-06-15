import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { CaretRightIcon, ClipboardIcon } from "@phosphor-icons/react/dist/ssr";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { canAccessSpace, getWorkspaceMembership } from "@/lib/permissions";
import { GettingStartedChecklist } from "@/components/onboarding/getting-started-checklist";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ListPageProps {
  params: Promise<{ workspaceId: string; spaceId: string; listId: string }>;
}

export default async function ListPage({ params }: ListPageProps) {
  const { workspaceId, spaceId, listId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const userId = session.user.id;

  // 404 (not 403) so private structure stays invisible — docs/permission-model.md
  const membership = await getWorkspaceMembership(userId, workspaceId);
  if (!membership) notFound();
  if (!(await canAccessSpace(userId, workspaceId, spaceId))) notFound();

  const list = await db.list.findFirst({
    where: { id: listId, spaceId, isArchived: false, space: { workspaceId } },
    include: {
      space: { include: { workspace: { select: { name: true, createdBy: true } } } },
      tasks: {
        where: { isArchived: false, parentTaskId: null },
        orderBy: { orderIndex: "asc" },
        include: {
          status: true,
          tags: { include: { tag: true } },
          assignees: true,
        },
      },
    },
  });
  if (!list) notFound();

  // Resolve assignee users (no FK relation on TaskAssignee by design)
  const assigneeIds = [...new Set(list.tasks.flatMap((t) => t.assignees.map((a) => a.userId)))];
  const users = assigneeIds.length
    ? await db.user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, name: true },
      })
    : [];
  const userNameById = new Map(users.map((u) => [u.id, u.name]));

  // Getting Started checklist — workspace creator only, until dismissed
  const isCreator = list.space.workspace.createdBy === userId;
  const progress = isCreator
    ? await db.userOnboardingProgress.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
      })
    : null;
  const showChecklist = !!progress && progress.dismissedAt === null;
  const firstName = (session.user.name ?? session.user.email).split(" ")[0];

  return (
    <div className="space-y-5">
      {/* Header: breadcrumb + view switcher */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            {list.space.color && (
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: list.space.color }}
              />
            )}
            {list.space.name}
          </span>
          <CaretRightIcon className="size-3.5 text-muted-foreground" />
          <h1 className="font-semibold">{list.name}</h1>
        </div>

        <div className="flex items-center gap-1 border-b">
          <button className="px-3 py-1.5 text-sm font-medium border-b-2 border-primary -mb-px">
            List
          </button>
          <button
            className="px-3 py-1.5 text-sm text-muted-foreground/60 cursor-not-allowed"
            title="Board view arrives with the Views module"
            disabled
          >
            Board
          </button>
          <button
            className="px-3 py-1.5 text-sm text-muted-foreground/60 cursor-not-allowed"
            title="Calendar view arrives with the Views module"
            disabled
          >
            Calendar
          </button>
        </div>
      </div>

      {/* Tasks */}
      {list.tasks.length > 0 ? (
        <Card>
          <CardContent className="p-0 divide-y">
            {list.tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: `${task.status.color}1A`, color: task.status.color }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: task.status.color }}
                  />
                  {task.status.name}
                </span>
                <p className="flex-1 min-w-0 truncate text-sm font-medium">{task.title}</p>
                {task.tags.map(({ tag }) => (
                  <Badge key={tag.id} variant="secondary" className="shrink-0 hidden sm:inline-flex">
                    {tag.name}
                  </Badge>
                ))}
                <div className="flex shrink-0 -space-x-1.5">
                  {task.assignees.map((a) => {
                    const name = userNameById.get(a.userId) ?? "?";
                    const initials = name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2);
                    return (
                      <Avatar key={a.userId} size="sm" className="border-2 border-background">
                        <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                      </Avatar>
                    );
                  })}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  #{task.seqNumber}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        /* Empty List state — docs/empty-states.md §2 */
        <Card>
          <CardContent className="py-14 flex flex-col items-center text-center gap-3">
            <ClipboardIcon className="size-10 text-muted-foreground/40" weight="duotone" />
            <div className="space-y-1">
              <h2 className="font-medium">This list has no tasks yet</h2>
              <p className="text-sm text-muted-foreground">
                Add your first task to start tracking work
              </p>
            </div>
            <Button disabled title="Quick-create arrives with the Task module">
              + Add your first task
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Getting Started — below the demo task, workspace creator only */}
      {showChecklist && (
        <GettingStartedChecklist
          firstName={firstName}
          workspaceId={workspaceId}
          progress={{
            stepWorkspace: progress.stepWorkspace,
            stepSpace: progress.stepSpace,
            stepFirstTask: progress.stepFirstTask,
            stepInvite: progress.stepInvite,
            stepDueDate: progress.stepDueDate,
            stepBoardView: progress.stepBoardView,
          }}
        />
      )}
    </div>
  );
}
