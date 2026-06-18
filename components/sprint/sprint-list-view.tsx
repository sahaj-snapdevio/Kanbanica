"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  CopyIcon,
  DotsThreeIcon,
  FlagIcon,
  LightningIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { format, isToday, isPast } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getActiveSprintView, addTaskToSprint } from "@/app/actions/sprint";
import { createTask, archiveTask, deleteTask, duplicateTask } from "@/app/actions/task";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Status {
  id: string;
  name: string;
  color: string;
  type: "OPEN" | "ACTIVE" | "CLOSED";
  orderIndex: number;
}

interface SprintTask {
  id: string;
  title: string;
  seqNumber: number;
  priority: string | null;
  statusId: string;
  orderIndex: number;
  dueDateStart: Date | null;
  dueDateEnd: Date | null;
  tags: { id: string; name: string; color: string }[];
  assignees: { userId: string; name: string; image: string | null }[];
}

interface SprintInfo {
  id: string;
  name: string;
  goal: string | null;
  startDate: Date | null;
  endDate: Date | null;
  status: "PLANNED" | "ACTIVE" | "CLOSED";
}

interface SprintListViewProps {
  workspaceId: string;
  spaceId: string;
  listId: string;
  statuses: Status[];
  isAdmin?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  NONE:   { label: "—",      color: "text-muted-foreground/40", icon: "😴" },
  LOW:    { label: "Low",    color: "text-blue-500",             icon: "🐢" },
  MEDIUM: { label: "Medium", color: "text-yellow-500",           icon: "🚶" },
  HIGH:   { label: "High",   color: "text-orange-500",           icon: "🏃" },
  URGENT: { label: "Urgent", color: "text-red-500",              icon: "⚡" },
};

function userInitials(name: string) {
  if (!name) return "?";
  const clean = name.includes("@") ? name.split("@")[0] : name;
  return clean.split(/[\s._-]+/).map((n) => n[0]).filter(Boolean).join("").toUpperCase().slice(0, 2) || "?";
}

function formatDueDate(date: Date | null) {
  if (!date) return null;
  const d = new Date(date);
  const overdue = isPast(d) && !isToday(d);
  return { label: isToday(d) ? "Today" : format(d, "MMM d"), overdue };
}

function formatDateRange(start: Date | null, end: Date | null): string {
  const fmt = (d: Date | null) => (d ? format(new Date(d), "M/d") : "—");
  return `${fmt(start)} - ${fmt(end)}`;
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  workspaceId,
  spaceId,
  listId,
  isAdmin,
}: {
  task: SprintTask;
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const priority = PRIORITY_CONFIG[task.priority ?? "NONE"] ?? PRIORITY_CONFIG.NONE;
  const dueDate = formatDueDate(task.dueDateStart);

  return (
    <tr
      className="group/row border-b border-border/40 hover:bg-accent/30 cursor-pointer transition-colors"
      onClick={() => router.push(`/${workspaceId}/task/${task.id}?from=sprint`)}
    >
      {/* Name */}
      <td className="py-2.5 pl-10 pr-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-muted-foreground/50 font-mono shrink-0 w-6">
            #{task.seqNumber}
          </span>
          <span className="text-sm font-semibold truncate">{task.title}</span>
          {task.tags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="hidden md:inline-flex shrink-0 rounded-full px-1.5 py-px text-xs font-medium"
              style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      </td>

      {/* Assignee */}
      <td className="py-2.5 px-4 w-36">
        {task.assignees.length > 0 ? (
          <div className="flex -space-x-1.5">
            {task.assignees.slice(0, 3).map((a) => (
              <Avatar key={a.userId} className="size-7 border-2 border-background" title={a.name}>
                {a.image && <AvatarImage src={a.image} alt={a.name} />}
                <AvatarFallback className="text-xs bg-primary text-primary-foreground font-semibold">
                  {userInitials(a.name)}
                </AvatarFallback>
              </Avatar>
            ))}
            {task.assignees.length > 3 && (
              <div className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium text-muted-foreground">
                +{task.assignees.length - 3}
              </div>
            )}
          </div>
        ) : (
          <UserIcon className="size-4 text-muted-foreground/30" />
        )}
      </td>

      {/* Due date */}
      <td className="py-2.5 px-4 w-28">
        {dueDate ? (
          <span className={cn("text-xs font-medium", dueDate.overdue ? "text-red-500" : "text-muted-foreground")}>
            {dueDate.label}
          </span>
        ) : (
          <CalendarBlankIcon className="size-4 text-muted-foreground/30" />
        )}
      </td>

      {/* Priority */}
      <td className="py-2.5 px-4 w-28">
        {task.priority && task.priority !== "NONE" ? (
          <span className={cn("flex items-center gap-1 text-xs font-medium", priority.color)}>
            <span>{priority.icon}</span>
            {priority.label}
          </span>
        ) : (
          <FlagIcon className="size-4 text-muted-foreground/30" />
        )}
      </td>

      {/* Actions */}
      <td className="py-2.5 pr-3 w-10" onClick={(e) => e.stopPropagation()}>
        <Popover>
          <PopoverTrigger asChild>
            <button className="opacity-0 group-hover/row:opacity-100 flex size-7 items-center justify-center rounded-md hover:bg-accent transition-opacity ml-auto">
              <DotsThreeIcon className="size-4 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-40 p-1">
            <button
              onClick={async () => { await duplicateTask(workspaceId, spaceId, listId, task.id); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <CopyIcon className="size-3.5 text-muted-foreground" /> Duplicate
            </button>
            <button
              onClick={async () => { await archiveTask(workspaceId, spaceId, listId, task.id); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <ArchiveIcon className="size-3.5 text-muted-foreground" /> Archive
            </button>
            {isAdmin && (
              <button
                onClick={async () => {
                  if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
                  await deleteTask(workspaceId, spaceId, listId, task.id);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
              >
                <TrashIcon className="size-3.5" /> Delete
              </button>
            )}
          </PopoverContent>
        </Popover>
      </td>
    </tr>
  );
}

// ─── Quick create row ─────────────────────────────────────────────────────────

function QuickCreateRow({
  workspaceId,
  spaceId,
  listId,
  sprintId,
  statusId,
  onCreated,
}: {
  workspaceId: string;
  spaceId: string;
  listId: string;
  sprintId: string;
  statusId: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) { setOpen(false); return; }
    setSaving(true);
    try {
      const res = await createTask(workspaceId, spaceId, listId, { title: trimmed, statusId });
      if ("error" in res) return;
      await addTaskToSprint(workspaceId, spaceId, listId, sprintId, res.taskId);
      setTitle("");
      onCreated();
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <tr>
        <td colSpan={5} className="py-0">
          <button
            onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className="flex w-full items-center gap-2 pl-10 pr-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors"
          >
            <PlusIcon className="size-3.5 shrink-0" />
            Add Task
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={5} className="py-1.5 pl-10 pr-4">
        <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-background px-2 py-1.5 ring-1 ring-primary/20">
          <input
            ref={inputRef}
            type="text"
            placeholder="Task title…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void submit(); }
              if (e.key === "Escape") { setOpen(false); setTitle(""); }
            }}
            disabled={saving}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
          <button
            onClick={() => void submit()}
            disabled={saving || !title.trim()}
            className="rounded px-2 py-0.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
          >
            {saving ? "…" : "Add"}
          </button>
          <button
            onClick={() => { setOpen(false); setTitle(""); }}
            className="text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            Esc
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Status group ─────────────────────────────────────────────────────────────

function StatusGroup({
  status,
  tasks,
  workspaceId,
  spaceId,
  listId,
  sprintId,
  isAdmin,
  onRefresh,
}: {
  status: Status;
  tasks: SprintTask[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  sprintId: string;
  isAdmin?: boolean;
  onRefresh: () => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <>
      <tr className="bg-muted/20">
        <td colSpan={5} className="py-2 pl-4 pr-3">
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="flex items-center gap-2 select-none"
          >
            {collapsed
              ? <CaretRightIcon className="size-3.5 text-muted-foreground shrink-0" />
              : <CaretDownIcon className="size-3.5 text-muted-foreground shrink-0" />}
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: `${status.color}18`, color: status.color }}
            >
              <span className="size-1.5 rounded-full" style={{ backgroundColor: status.color }} />
              {status.name}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
          </button>
        </td>
      </tr>

      {!collapsed && (
        <>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              workspaceId={workspaceId}
              spaceId={spaceId}
              listId={listId}
              isAdmin={isAdmin}
            />
          ))}
          <QuickCreateRow
            workspaceId={workspaceId}
            spaceId={spaceId}
            listId={listId}
            sprintId={sprintId}
            statusId={status.id}
            onCreated={onRefresh}
          />
        </>
      )}
    </>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function SprintListView({ workspaceId, spaceId, listId, statuses, isAdmin }: SprintListViewProps) {
  const [sprintInfo, setSprintInfo] = React.useState<SprintInfo | null>(null);
  const [tasks, setTasks] = React.useState<SprintTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [sprintCollapsed, setSprintCollapsed] = React.useState(false);

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await getActiveSprintView(workspaceId, spaceId, listId);
      if ("error" in res) return;
      setSprintInfo(res.sprint);
      setTasks(res.tasks);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, spaceId, listId]);

  React.useEffect(() => { void fetchData(); }, [fetchData]);

  const tasksByStatus = React.useMemo(() => {
    const map = new Map<string, SprintTask[]>();
    for (const s of statuses) map.set(s.id, []);
    for (const t of tasks) {
      const group = map.get(t.statusId);
      if (group) group.push(t);
      else map.get(statuses[0]?.id ?? "")?.push(t);
    }
    return map;
  }, [statuses, tasks]);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-xl border bg-card overflow-hidden animate-pulse">
        <div className="h-12 bg-muted/40 border-b" />
        <div className="p-4 space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-9 rounded bg-muted" />)}
        </div>
      </div>
    );
  }

  // ── No active sprint ──────────────────────────────────────────────────────
  if (!sprintInfo) {
    return (
      <div className="rounded-xl border bg-card flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
        <LightningIcon className="size-8 opacity-30" />
        <p className="text-sm font-medium">No active sprint</p>
        <p className="text-xs opacity-70">Start a sprint from the Sprints panel above</p>
      </div>
    );
  }

  // ── Sprint card with tasks inside ─────────────────────────────────────────
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Sprint header — inside the card */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/20">
        <button
          onClick={() => setSprintCollapsed((v) => !v)}
          className="flex items-center gap-2 flex-1 text-left min-w-0"
        >
          {sprintCollapsed
            ? <CaretRightIcon className="size-3.5 text-muted-foreground shrink-0" />
            : <CaretDownIcon className="size-3.5 text-muted-foreground shrink-0" />}
          <LightningIcon className="size-3.5 text-primary shrink-0" weight="fill" />
          <span className="text-sm font-semibold">{sprintInfo.name}</span>
          <span className="text-xs text-muted-foreground">
            ({formatDateRange(sprintInfo.startDate, sprintInfo.endDate)})
          </span>
        </button>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 text-xs px-2 py-1 rounded uppercase tracking-wide",
            sprintInfo.status === "ACTIVE"  && "border-primary/30 text-primary bg-primary/10",
            sprintInfo.status === "PLANNED" && "border-border text-muted-foreground bg-muted",
            sprintInfo.status === "CLOSED"  && "border-border text-muted-foreground bg-muted",
          )}
        >
          {sprintInfo.status}
        </Badge>
      </div>

      {/* Task table — inside the same card */}
      {!sprintCollapsed && (
        <table className="w-full border-collapse">
          {/* Column headers */}
          <thead>
            <tr className="border-b border-border/60 bg-background/50">
              <th className="py-2 pl-10 pr-4 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Name
              </th>
              <th className="py-2 px-4 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase w-36">
                Assignee
              </th>
              <th className="py-2 px-4 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase w-28">
                Due date
              </th>
              <th className="py-2 px-4 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase w-28">
                Priority
              </th>
              <th className="w-10" />
            </tr>
          </thead>

          <tbody>
            {statuses.map((status, i) => (
              <React.Fragment key={status.id}>
                {i > 0 && (
                  <tr aria-hidden>
                    <td colSpan={5} className="h-2 bg-transparent border-none" />
                  </tr>
                )}
                <StatusGroup
                  status={status}
                  tasks={tasksByStatus.get(status.id) ?? []}
                  workspaceId={workspaceId}
                  spaceId={spaceId}
                  listId={listId}
                  sprintId={sprintInfo.id}
                  isAdmin={isAdmin}
                  onRefresh={fetchData}
                />
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
