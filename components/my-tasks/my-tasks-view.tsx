"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  ClockIcon,
  FlagIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { format, isToday, isPast, isThisWeek, isFuture, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { getMyTasks, type MyTask, type MyTasksGroupBy } from "@/app/actions/my-tasks";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MyTasksViewProps {
  workspaceId: string;
}

interface Group {
  key: string;
  label: string;
  icon?: React.ReactNode;
  tasks: MyTask[];
  accent?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  URGENT: { label: "Urgent", color: "text-red-500",    icon: "⚡" },
  HIGH:   { label: "High",   color: "text-orange-500", icon: "🏃" },
  MEDIUM: { label: "Medium", color: "text-yellow-500", icon: "🚶" },
  LOW:    { label: "Low",    color: "text-blue-500",   icon: "🐢" },
  NONE:   { label: "—",      color: "text-muted-foreground/40", icon: "😴" },
} as const;

function formatDue(task: MyTask): { label: string; overdue: boolean } | null {
  const date = task.dueDateEnd ?? task.dueDateStart;
  if (!date) return null;
  const d = new Date(date);
  const overdue = isPast(d) && !isToday(d) && task.status.type !== "CLOSED";
  if (isToday(d)) return { label: "Today", overdue: false };
  if (overdue) return { label: format(d, "MMM d"), overdue: true };
  return { label: format(d, "MMM d"), overdue: false };
}

function groupByDueDate(tasks: MyTask[]): Group[] {
  const today = startOfDay(new Date());

  const overdue: MyTask[] = [];
  const dueToday: MyTask[] = [];
  const thisWeek: MyTask[] = [];
  const upcoming: MyTask[] = [];
  const noDate: MyTask[] = [];

  for (const t of tasks) {
    const date = t.dueDateEnd ?? t.dueDateStart;
    if (!date) { noDate.push(t); continue; }
    const d = startOfDay(new Date(date));
    if (d < today) { overdue.push(t); continue; }
    if (isToday(d)) { dueToday.push(t); continue; }
    if (isThisWeek(d, { weekStartsOn: 1 })) { thisWeek.push(t); continue; }
    upcoming.push(t);
  }

  return [
    { key: "overdue",   label: "Overdue",        icon: <WarningIcon className="size-3.5 text-red-500" />,          tasks: overdue,   accent: "text-red-500" },
    { key: "today",     label: "Due Today",       icon: <ClockIcon className="size-3.5 text-orange-500" />,         tasks: dueToday,  accent: "text-orange-500" },
    { key: "thisWeek",  label: "Due This Week",   icon: <CalendarBlankIcon className="size-3.5 text-blue-500" />,   tasks: thisWeek,  accent: "text-blue-500" },
    { key: "upcoming",  label: "Upcoming",        icon: <CalendarBlankIcon className="size-3.5 text-muted-foreground" />, tasks: upcoming },
    { key: "noDate",    label: "No Due Date",     icon: <CalendarBlankIcon className="size-3.5 text-muted-foreground/40" />, tasks: noDate },
  ].filter((g) => g.tasks.length > 0);
}

function groupBySpace(tasks: MyTask[]): Group[] {
  const map = new Map<string, { label: string; color: string | null; tasks: MyTask[] }>();
  for (const t of tasks) {
    const existing = map.get(t.space.id);
    if (existing) existing.tasks.push(t);
    else map.set(t.space.id, { label: t.space.name, color: t.space.color, tasks: [t] });
  }
  return Array.from(map.values()).map((g, i) => ({ key: `space-${i}`, label: g.label, tasks: g.tasks }));
}

function groupByList(tasks: MyTask[]): Group[] {
  const map = new Map<string, { space: string; label: string; tasks: MyTask[] }>();
  for (const t of tasks) {
    const existing = map.get(t.list.id);
    if (existing) existing.tasks.push(t);
    else map.set(t.list.id, { space: t.space.name, label: t.list.name, tasks: [t] });
  }
  return Array.from(map.values()).map((g, i) => ({
    key: `list-${i}`,
    label: `${g.space} › ${g.label}`,
    tasks: g.tasks,
  }));
}

function groupByPriority(tasks: MyTask[]): Group[] {
  const order: MyTask["priority"][] = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];
  const map = new Map<string, MyTask[]>();
  for (const p of order) map.set(p, []);
  for (const t of tasks) map.get(t.priority)?.push(t);
  return order
    .filter((p) => (map.get(p)?.length ?? 0) > 0)
    .map((p) => {
      const cfg = PRIORITY_CONFIG[p];
      return {
        key: p,
        label: cfg.label,
        icon: <span className="mr-1">{cfg.icon}</span>,
        tasks: map.get(p) ?? [],
      };
    });
}

function groupByStatus(tasks: MyTask[]): Group[] {
  const map = new Map<string, { label: string; color: string; tasks: MyTask[] }>();
  for (const t of tasks) {
    const existing = map.get(t.status.id);
    if (existing) existing.tasks.push(t);
    else map.set(t.status.id, { label: t.status.name, color: t.status.color, tasks: [t] });
  }
  return Array.from(map.values()).map((g, i) => ({ key: `status-${i}`, label: g.label, tasks: g.tasks }));
}

function buildGroups(tasks: MyTask[], groupBy: MyTasksGroupBy): Group[] {
  switch (groupBy) {
    case "due_date": return groupByDueDate(tasks);
    case "space":    return groupBySpace(tasks);
    case "list":     return groupByList(tasks);
    case "priority": return groupByPriority(tasks);
    case "status":   return groupByStatus(tasks);
  }
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({ task, workspaceId }: { task: MyTask; workspaceId: string }) {
  const router = useRouter();
  const priority = PRIORITY_CONFIG[task.priority];
  const due = formatDue(task);

  return (
    <tr
      className="group/row border-b border-border/40 hover:bg-accent/30 cursor-pointer transition-colors"
      onClick={() => router.push(`/${workspaceId}/task/${task.id}`)}
    >
      {/* Title + breadcrumb */}
      <td className="py-2.5 pl-10 pr-4">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground/50 font-mono shrink-0 w-6">
              #{task.seqNumber}
            </span>
            <span className="text-sm font-medium truncate">{task.title}</span>
          </div>
          <span className="pl-8 text-xs text-muted-foreground/60 truncate">
            {task.space.name} › {task.list.name}
          </span>
        </div>
      </td>

      {/* Status */}
      <td className="py-2.5 px-4 w-32">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: `${task.status.color}18`, color: task.status.color }}
        >
          <span className="size-1.5 rounded-full" style={{ backgroundColor: task.status.color }} />
          {task.status.name}
        </span>
      </td>

      {/* Due date */}
      <td className="py-2.5 px-4 w-28">
        {due ? (
          <span className={cn("text-xs font-medium", due.overdue ? "text-red-500" : "text-muted-foreground")}>
            {due.label}
          </span>
        ) : (
          <CalendarBlankIcon className="size-4 text-muted-foreground/30" />
        )}
      </td>

      {/* Priority */}
      <td className="py-2.5 px-4 w-28">
        {task.priority !== "NONE" ? (
          <span className={cn("flex items-center gap-1 text-xs font-medium", priority.color)}>
            <span>{priority.icon}</span>
            {priority.label}
          </span>
        ) : (
          <FlagIcon className="size-4 text-muted-foreground/30" />
        )}
      </td>
    </tr>
  );
}

// ─── Task group ───────────────────────────────────────────────────────────────

function TaskGroup({
  group,
  workspaceId,
}: {
  group: Group;
  workspaceId: string;
}) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <>
      <tr className="bg-muted/20">
        <td colSpan={4} className="py-2 pl-4 pr-3">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center gap-2 select-none"
          >
            {collapsed
              ? <CaretRightIcon className="size-3.5 text-muted-foreground shrink-0" />
              : <CaretDownIcon className="size-3.5 text-muted-foreground shrink-0" />}
            {group.icon}
            <span className={cn("text-sm font-semibold", group.accent)}>{group.label}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{group.tasks.length}</span>
          </button>
        </td>
      </tr>
      {!collapsed && group.tasks.map((t) => (
        <TaskRow key={t.id} task={t} workspaceId={workspaceId} />
      ))}
    </>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

const GROUP_BY_OPTIONS: { value: MyTasksGroupBy; label: string }[] = [
  { value: "due_date",  label: "Due Date" },
  { value: "space",     label: "Space" },
  { value: "list",      label: "List" },
  { value: "priority",  label: "Priority" },
  { value: "status",    label: "Status" },
];

export function MyTasksView({ workspaceId }: MyTasksViewProps) {
  const [tasks, setTasks] = React.useState<MyTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [groupBy, setGroupBy] = React.useState<MyTasksGroupBy>("due_date");
  const [showCompleted, setShowCompleted] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const fetchTasks = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyTasks(workspaceId, { showCompleted });
      if ("error" in res) return;
      setTasks(res.tasks);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, showCompleted]);

  React.useEffect(() => { void fetchTasks(); }, [fetchTasks]);

  const filtered = search.trim()
    ? tasks.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
    : tasks;

  const groups = buildGroups(filtered, groupBy);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <CheckCircleIcon className="size-5 text-primary" weight="fill" />
          <h1 className="text-lg font-semibold">My Tasks</h1>
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">
          {loading ? "…" : `${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-48 rounded-md border bg-background pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all focus:w-64"
          />
        </div>

        {/* Group by */}
        <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 h-8">
          <SquaresFourIcon className="size-3.5 text-muted-foreground shrink-0" />
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as MyTasksGroupBy)}
            className="h-full bg-transparent text-xs text-foreground outline-none cursor-pointer pr-1"
          >
            {GROUP_BY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>Group by: {o.label}</option>
            ))}
          </select>
        </div>

        {/* Show completed */}
        <button
          onClick={() => setShowCompleted((v) => !v)}
          className={cn(
            "h-8 rounded-md border px-3 text-xs font-medium transition-colors",
            showCompleted
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          {showCompleted ? "Hide Completed" : "Show Completed"}
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="rounded-xl border bg-card overflow-hidden animate-pulse">
          <div className="h-10 bg-muted/40 border-b" />
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-10 rounded bg-muted" />)}
          </div>
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border bg-card flex flex-col items-center gap-3 py-20 text-center">
          <CheckCircleIcon className="size-10 text-muted-foreground/20" weight="fill" />
          <p className="text-sm font-medium text-muted-foreground">
            {search ? "No tasks match your search" : showCompleted ? "No tasks assigned to you" : "You're all caught up!"}
          </p>
          {!showCompleted && tasks.length === 0 && (
            <p className="text-xs text-muted-foreground/60">Tasks assigned to you will appear here</p>
          )}
          {!showCompleted && tasks.length > 0 && filtered.length === 0 && search && (
            <button onClick={() => setSearch("")} className="text-xs text-primary hover:underline">
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border/60 bg-muted/20">
                <th className="py-2 pl-10 pr-4 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Task
                </th>
                <th className="py-2 px-4 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase w-32">
                  Status
                </th>
                <th className="py-2 px-4 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase w-28">
                  Due Date
                </th>
                <th className="py-2 px-4 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase w-28">
                  Priority
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, i) => (
                <React.Fragment key={group.key}>
                  {i > 0 && (
                    <tr aria-hidden>
                      <td colSpan={4} className="h-2 bg-transparent border-none" />
                    </tr>
                  )}
                  <TaskGroup group={group} workspaceId={workspaceId} />
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
