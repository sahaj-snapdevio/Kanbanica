"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  FlagIcon,
  LockIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { getClosedSprintView, type ClosedSprintTask } from "@/app/actions/sprint";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClosedSprintViewProps {
  workspaceId: string;
  spaceId: string;
  sprintId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return format(new Date(date), "MMM d, yyyy");
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  NONE: { label: "No Priority", color: "text-muted-foreground/40", icon: "😴" },
  LOW: { label: "Low", color: "text-blue-500", icon: "🐢" },
  MEDIUM: { label: "Medium", color: "text-yellow-500", icon: "🚶" },
  HIGH: { label: "High", color: "text-orange-500", icon: "🏃" },
  URGENT: { label: "Urgent", color: "text-red-500", icon: "⚡" },
};

// ─── Assignee avatars ─────────────────────────────────────────────────────────

function AssigneeAvatars({ assignees }: { assignees: ClosedSprintTask["assignees"] }) {
  if (assignees.length === 0) {
    return <UserIcon className="size-4 text-muted-foreground/30" />;
  }
  return (
    <div className="flex -space-x-1">
      {assignees.slice(0, 3).map((a) => (
        <div
          key={a.userId}
          title={a.name}
          className="size-5 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[9px] font-semibold text-muted-foreground overflow-hidden shrink-0"
        >
          {a.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.image} alt={a.name} className="size-full object-cover" />
          ) : (
            (a.name?.[0] ?? "?").toUpperCase()
          )}
        </div>
      ))}
      {assignees.length > 3 && (
        <div className="size-5 rounded-full border-2 border-background bg-muted flex items-center justify-center text-[9px] font-semibold text-muted-foreground">
          +{assignees.length - 3}
        </div>
      )}
    </div>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({ task, workspaceId }: { task: ClosedSprintTask; workspaceId: string }) {
  const router = useRouter();
  const priority = PRIORITY_CONFIG[task.priority ?? "NONE"] ?? PRIORITY_CONFIG.NONE;
  const isDone = task.statusType === "CLOSED";

  return (
    <tr
      className="group/row border-b border-border/40 hover:bg-accent/30 cursor-pointer transition-colors"
      onClick={() => router.push(`/${workspaceId}/task/${task.id}`)}
    >
      {/* Title */}
      <td className="py-2.5 pl-4 pr-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] text-muted-foreground/50 shrink-0 w-7">
            #{task.seqNumber}
          </span>
          <span className={cn("text-sm truncate", isDone && "line-through text-muted-foreground/60")}>
            {task.title}
          </span>
          {task.tags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="hidden sm:inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `${tag.color}22`, color: tag.color }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      </td>

      {/* Status */}
      <td className="py-2.5 px-3 w-36">
        {task.statusName ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: `${task.statusColor ?? "#9CA3AF"}18`, color: task.statusColor ?? "#9CA3AF" }}
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: task.statusColor ?? "#9CA3AF" }} />
            {task.statusName}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}
      </td>

      {/* Assignees */}
      <td className="py-2.5 px-3 w-24">
        <AssigneeAvatars assignees={task.assignees} />
      </td>

      {/* Priority */}
      <td className="py-2.5 px-3 w-28">
        {task.priority && task.priority !== "NONE" ? (
          <span className={cn("flex items-center gap-1 text-xs font-medium", priority.color)}>
            <span>{priority.icon}</span>
            {priority.label}
          </span>
        ) : (
          <FlagIcon className="size-4 text-muted-foreground/30" />
        )}
      </td>

      {/* Story points */}
      <td className="py-2.5 px-3 w-16 text-right">
        {task.storyPoints != null ? (
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            {task.storyPoints}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/30">—</span>
        )}
      </td>

      {/* Due date */}
      <td className="py-2.5 px-3 w-28">
        {(task.dueDateEnd ?? task.dueDateStart) ? (
          <span className="text-xs text-muted-foreground">
            {format(new Date((task.dueDateEnd ?? task.dueDateStart)!), "MMM d")}
          </span>
        ) : (
          <CalendarBlankIcon className="size-4 text-muted-foreground/30" />
        )}
      </td>
    </tr>
  );
}

// ─── Status group ─────────────────────────────────────────────────────────────

function StatusGroup({ statusName, statusColor, tasks, workspaceId }: {
  statusName: string;
  statusColor: string;
  tasks: ClosedSprintTask[];
  workspaceId: string;
}) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <>
      <tr className="bg-muted/20 border-b border-border/40">
        <td colSpan={6} className="py-2 pl-3 pr-4">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center gap-2 select-none"
          >
            {collapsed
              ? <CaretRightIcon className="size-3.5 text-muted-foreground shrink-0" />
              : <CaretDownIcon className="size-3.5 text-muted-foreground shrink-0" />}
            <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
            <span className="text-sm font-semibold">{statusName}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
          </button>
        </td>
      </tr>
      {!collapsed && tasks.map((t) => (
        <TaskRow key={t.id} task={t} workspaceId={workspaceId} />
      ))}
    </>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export function ClosedSprintView({ workspaceId, spaceId, sprintId }: ClosedSprintViewProps) {
  const [data, setData] = React.useState<Awaited<ReturnType<typeof getClosedSprintView>> | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const result = await getClosedSprintView(workspaceId, spaceId, sprintId);
        setData(result);
      } finally {
        setLoading(false);
      }
    })();
  }, [workspaceId, spaceId, sprintId]);

  if (loading) {
    return (
      <div className="rounded-xl border bg-card animate-pulse">
        <div className="h-28 bg-muted/40 rounded-t-xl" />
        <div className="p-4 space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-10 rounded bg-muted" />)}
        </div>
      </div>
    );
  }

  if (!data || "error" in data) {
    return (
      <div className="rounded-xl border bg-card flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">
          {"error" in (data ?? {}) ? (data as { error: string }).error : "Sprint not found"}
        </p>
      </div>
    );
  }

  const { sprint, tasks, stats } = data;
  const percent = stats.totalTasks > 0 ? Math.round((stats.closedTasks / stats.totalTasks) * 100) : 0;

  // Group tasks by status, preserving order
  const statusOrder: { id: string | null; name: string; color: string; tasks: ClosedSprintTask[] }[] = [];
  const statusMap = new Map<string, (typeof statusOrder)[number]>();
  for (const t of tasks) {
    const key = t.statusId ?? "__no_status__";
    if (!statusMap.has(key)) {
      const entry = {
        id: t.statusId,
        name: t.statusName ?? "No Status",
        color: t.statusColor ?? "#9CA3AF",
        tasks: [],
      };
      statusMap.set(key, entry);
      statusOrder.push(entry);
    }
    statusMap.get(key)!.tasks.push(t);
  }

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <LockIcon className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{sprint.name}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}
              </p>
              {sprint.goal && (
                <p className="text-sm text-muted-foreground/80 mt-1 line-clamp-2">{sprint.goal}</p>
              )}
            </div>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <CheckCircleIcon className="size-3.5 text-green-500" weight="fill" />
            Closed
          </span>
        </div>

        {/* Stats */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {stats.closedTasks} / {stats.totalTasks} tasks completed
            </span>
            <span className="font-semibold tabular-nums">{percent}%</span>
          </div>
          <Progress value={percent} className="h-2" />
        </div>

        {stats.totalPoints > 0 && (
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Story points:</span>
              <span className="font-medium tabular-nums">
                {stats.closedPoints} / {stats.totalPoints}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Task table */}
      {tasks.length === 0 ? (
        <div className="rounded-xl border bg-card flex flex-col items-center gap-2 py-16 text-center">
          <CheckCircleIcon className="size-10 text-muted-foreground/20" weight="fill" />
          <p className="text-sm text-muted-foreground">No tasks were in this sprint</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border/60 bg-muted/20">
                <th className="py-2 pl-4 pr-3 text-left text-xs font-semibold text-muted-foreground">
                  Task
                </th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground w-36">
                  Status
                </th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground w-24">
                  Assignee
                </th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground w-28">
                  Priority
                </th>
                <th className="py-2 px-3 text-right text-xs font-semibold text-muted-foreground w-16">
                  Pts
                </th>
                <th className="py-2 px-3 text-left text-xs font-semibold text-muted-foreground w-28">
                  Due Date
                </th>
              </tr>
            </thead>
            <tbody>
              {statusOrder.map((group, i) => (
                <React.Fragment key={group.id ?? `group-${i}`}>
                  <StatusGroup
                    statusName={group.name}
                    statusColor={group.color}
                    tasks={group.tasks}
                    workspaceId={workspaceId}
                  />
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
