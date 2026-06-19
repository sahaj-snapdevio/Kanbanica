"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  FlagIcon,
  LightningIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import { format, isToday, isPast } from "date-fns";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getActiveSprintView, addTaskToSprint } from "@/app/actions/sprint";
import {
  archiveTask,
  bulkArchiveTasks,
  bulkDeleteTasks,
  bulkUpdateStatus,
  createTask,
  deleteTask,
  duplicateTask,
} from "@/app/actions/task";
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
  selected,
  onSelect,
}: {
  task: SprintTask;
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
}) {
  const router = useRouter();
  const priority = PRIORITY_CONFIG[task.priority ?? "NONE"] ?? PRIORITY_CONFIG.NONE;
  const dueDate = formatDueDate(task.dueDateStart);

  return (
    <div
      className={cn(
        "group/row flex items-center border-b border-border/50 transition-colors cursor-pointer",
        selected ? "bg-primary/5" : "hover:bg-accent/30",
      )}
      onClick={() => router.push(`/${workspaceId}/task/${task.id}?from=sprint`)}
    >
      {/* Checkbox */}
      <div
        className="flex w-10 shrink-0 items-center justify-center py-2.5 pl-3"
        onClick={(e) => { e.stopPropagation(); onSelect(task.id, !selected); }}
      >
        <div className={cn(
          "flex size-4 items-center justify-center rounded border transition-colors",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border group-hover/row:bg-accent/50",
        )}>
          {selected && <CheckIcon className="size-2.5" weight="bold" />}
        </div>
      </div>

      {/* Name */}
      <div className="flex flex-1 items-center gap-2 min-w-0 py-3 pr-4">
        <span className="text-xs text-muted-foreground/50 font-mono shrink-0 w-6">
          #{task.seqNumber}
        </span>
        <span className="text-[15px] font-medium truncate">{task.title}</span>
        {task.tags.slice(0, 2).map((tag) => (
          <span
            key={tag.id}
            className="hidden md:inline-flex shrink-0 rounded-full px-1.5 py-px text-2xs font-medium"
            style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
          >
            {tag.name}
          </span>
        ))}
      </div>

      {/* Assignee */}
      <div className="w-36 shrink-0 py-2.5 px-4">
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
      </div>

      {/* Due date */}
      <div className="w-28 shrink-0 py-3 px-4">
        {dueDate ? (
          <span className={cn("text-sm font-medium", dueDate.overdue ? "text-red-500" : "text-muted-foreground")}>
            {dueDate.label}
          </span>
        ) : (
          <CalendarBlankIcon className="size-4 text-muted-foreground/30" />
        )}
      </div>

      {/* Priority */}
      <div className="w-28 shrink-0 py-3 px-4">
        {task.priority && task.priority !== "NONE" ? (
          <span className={cn("flex items-center gap-1 text-sm font-medium", priority.color)}>
            <span>{priority.icon}</span>
            {priority.label}
          </span>
        ) : (
          <FlagIcon className="size-4 text-muted-foreground/30" />
        )}
      </div>

      {/* Actions */}
      <div
        className="w-10 shrink-0 py-2.5 pr-3 flex items-center justify-end"
        onClick={(e) => e.stopPropagation()}
      >
        <Popover>
          <PopoverTrigger asChild>
            <button className="opacity-0 group-hover/row:opacity-100 flex size-7 items-center justify-center rounded-md hover:bg-accent transition-opacity">
              <DotsThreeIcon className="size-4.5 text-muted-foreground" weight="bold" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-40 p-1">
            <button
              onClick={async (e) => { e.stopPropagation(); await duplicateTask(workspaceId, spaceId, listId, task.id); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <CopyIcon className="size-3.5 text-muted-foreground" /> Duplicate
            </button>
            <button
              onClick={async (e) => { e.stopPropagation(); await archiveTask(workspaceId, spaceId, listId, task.id); }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <ArchiveIcon className="size-3.5 text-muted-foreground" /> Archive
            </button>
            {isAdmin && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
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
      </div>
    </div>
  );
}

// ─── Quick create row ─────────────────────────────────────────────────────────

function QuickCreateRow({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  listId,
  sprintId,
  statusId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  spaceId: string;
  listId: string;
  sprintId: string;
  statusId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) { onOpenChange(false); return; }
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
      <button
        onClick={() => onOpenChange(true)}
        className="flex w-full items-center gap-2 pl-10 pr-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors"
      >
        <PlusIcon className="size-3.5 shrink-0" />
        Add Task
      </button>
    );
  }

  return (
    <div className="py-1.5 pl-10 pr-4">
      <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-background px-2 py-1.5 ring-1 ring-primary/20">
        <input
          ref={inputRef}
          type="text"
          placeholder="Task title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void submit(); }
            if (e.key === "Escape") { onOpenChange(false); setTitle(""); }
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
          onClick={() => { onOpenChange(false); setTitle(""); }}
          className="text-xs text-muted-foreground hover:text-foreground shrink-0"
        >
          Esc
        </button>
      </div>
    </div>
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
  selectedIds,
  onSelect,
  onRefresh,
}: {
  status: Status;
  tasks: SprintTask[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  sprintId: string;
  isAdmin?: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  onRefresh: () => void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = React.useState(false);

  const allSelected = tasks.length > 0 && tasks.every((t) => selectedIds.has(t.id));
  const someSelected = tasks.some((t) => selectedIds.has(t.id));

  function toggleAll() {
    if (allSelected) {
      tasks.forEach((t) => onSelect(t.id, false));
    } else {
      tasks.forEach((t) => onSelect(t.id, true));
    }
  }

  return (
    <div>
      {/* Group header */}
      <div className="group/header flex items-center gap-2 py-2 px-3 select-none">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex size-5 items-center justify-center rounded hover:bg-accent transition-colors shrink-0 cursor-pointer"
        >
          {collapsed
            ? <CaretRightIcon weight="fill" className="size-3 text-muted-foreground" />
            : <CaretDownIcon weight="fill" className="size-3 text-muted-foreground" />}
        </button>

        <Badge
          variant="outline"
          className="text-xs px-2 py-1 rounded font-semibold cursor-pointer"
          style={{ borderColor: `${status.color}50`, backgroundColor: `${status.color}18`, color: status.color }}
          onClick={() => setCollapsed((v) => !v)}
        >
          <span className="size-1.5 rounded-full mr-1.5 shrink-0 inline-block" style={{ backgroundColor: status.color }} />
          {status.name}
        </Badge>

        <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>

        <div className="ml-1 flex items-center gap-1 opacity-0 group-hover/header:opacity-100 transition-opacity">
          <button className="flex size-6 items-center justify-center rounded hover:bg-accent transition-colors">
            <DotsThreeIcon className="size-4.5 text-muted-foreground" weight="bold" />
          </button>
          <button
            className="flex size-6 items-center justify-center rounded hover:bg-accent transition-colors"
            onClick={() => { setCollapsed(false); setQuickCreateOpen(true); }}
          >
            <PlusIcon className="size-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Expanded: column headers + tasks */}
      {!collapsed && (
        <div>
          {/* Column headers with select-all */}
          <div className="flex items-center border-y border-border bg-muted/40">
            <div
              className="flex w-10 shrink-0 items-center justify-center py-2 pl-3 cursor-pointer"
              onClick={toggleAll}
            >
              <div className={cn(
                "flex size-4 items-center justify-center rounded border transition-colors",
                allSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : someSelected
                    ? "border-primary bg-primary/20"
                    : "border-border hover:border-primary/50",
              )}>
                {allSelected && <CheckIcon className="size-2.5" weight="bold" />}
                {someSelected && !allSelected && <div className="size-1.5 rounded-sm bg-primary" />}
              </div>
            </div>
            <div className="flex-1 py-2 pr-4 text-sm font-semibold text-muted-foreground">Name</div>
            <div className="w-36 shrink-0 py-2 px-4 text-sm font-semibold text-muted-foreground">Assignee</div>
            <div className="w-28 shrink-0 py-2 px-4 text-sm font-semibold text-muted-foreground">Due date</div>
            <div className="w-28 shrink-0 py-2 px-4 text-sm font-semibold text-muted-foreground">Priority</div>
            <div className="w-10 shrink-0" />
          </div>

          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              workspaceId={workspaceId}
              spaceId={spaceId}
              listId={listId}
              isAdmin={isAdmin}
              selected={selectedIds.has(task.id)}
              onSelect={onSelect}
            />
          ))}

          <QuickCreateRow
            open={quickCreateOpen}
            onOpenChange={setQuickCreateOpen}
            workspaceId={workspaceId}
            spaceId={spaceId}
            listId={listId}
            sprintId={sprintId}
            statusId={status.id}
            onCreated={onRefresh}
          />
        </div>
      )}
    </div>
  );
}

// ─── Bulk action bar ──────────────────────────────────────────────────────────

function BulkActionBar({
  count,
  selectedIds,
  statuses,
  workspaceId,
  spaceId,
  listId,
  isAdmin,
  onClear,
}: {
  count: number;
  selectedIds: Set<string>;
  statuses: Status[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
  onClear: () => void;
}) {
  const [busy, setBusy] = React.useState(false);

  async function handleBulkStatus(statusId: string) {
    setBusy(true);
    const res = await bulkUpdateStatus(workspaceId, spaceId, listId, [...selectedIds], statusId);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Updated ${count} task${count > 1 ? "s" : ""}`);
    onClear();
  }

  async function handleBulkArchive() {
    setBusy(true);
    const res = await bulkArchiveTasks(workspaceId, spaceId, listId, [...selectedIds]);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Archived ${count} task${count > 1 ? "s" : ""}`);
    onClear();
  }

  async function handleBulkDelete() {
    if (!confirm(`Delete ${count} task${count > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBusy(true);
    const res = await bulkDeleteTasks(workspaceId, spaceId, listId, [...selectedIds]);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Deleted ${count} task${count > 1 ? "s" : ""}`);
    onClear();
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-xl border border-white/10 bg-neutral-900 px-3 py-2 shadow-2xl text-white text-sm">
      <span className="font-semibold text-white pr-2 border-r border-white/20 mr-2">
        {count} task{count > 1 ? "s" : ""} selected
      </span>
      <button
        onClick={onClear}
        className="flex size-6 items-center justify-center rounded hover:bg-white/10 transition-colors mr-2"
      >
        <XIcon className="size-3.5 text-white/70" />
      </button>

      <Popover>
        <PopoverTrigger asChild>
          <button
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
          >
            <span className="size-2 rounded-full bg-white/60" />
            Status
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" side="top" className="w-48 p-1 mb-1">
          {statuses.map((s) => (
            <button
              key={s.id}
              onClick={() => handleBulkStatus(s.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              {s.name}
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <div className="h-4 w-px bg-white/20 mx-1" />

      <button
        disabled={busy}
        onClick={handleBulkArchive}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
      >
        <ArchiveIcon className="size-3.5" />
        Archive
      </button>

      {isAdmin && (
        <button
          disabled={busy}
          onClick={handleBulkDelete}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50"
        >
          <TrashIcon className="size-3.5" />
          Delete
        </button>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function SprintListView({ workspaceId, spaceId, listId, statuses, isAdmin }: SprintListViewProps) {
  const [sprintInfo, setSprintInfo] = React.useState<SprintInfo | null>(null);
  const [tasks, setTasks] = React.useState<SprintTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [sprintCollapsed, setSprintCollapsed] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  function handleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

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
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/20">
          <Skeleton className="size-3.5 rounded" />
          <Skeleton className="size-3.5 rounded" />
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-3.5 w-20 rounded" />
          <Skeleton className="ml-auto h-6 w-16 rounded" />
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/20">
          <Skeleton className="size-3 rounded" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
        <div className="flex items-center gap-4 border-b border-border/60 bg-muted/40 pl-10 pr-4 py-2">
          <Skeleton className="h-3 w-16 rounded" />
          <Skeleton className="ml-auto h-3 w-16 rounded" />
          <Skeleton className="h-3 w-14 rounded" />
          <Skeleton className="h-3 w-14 rounded" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border/40 py-2.5 pl-10 pr-3">
            <Skeleton className="h-4 w-6 rounded" />
            <Skeleton className="h-4 max-w-65 flex-1 rounded" />
            <div className="ml-auto flex items-center gap-6">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-3.5 w-12 rounded" />
              <Skeleton className="h-3.5 w-14 rounded" />
            </div>
          </div>
        ))}
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

  // ── Sprint card ───────────────────────────────────────────────────────────
  return (
    <>
      <div className="rounded-xl border bg-card overflow-hidden">
        {/* Sprint header */}
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

        {/* Status groups */}
        {!sprintCollapsed && (
          <div>
            {statuses.map((status, i) => (
              <React.Fragment key={status.id}>
                {i > 0 && <div className="h-2" />}
                <StatusGroup
                  status={status}
                  tasks={tasksByStatus.get(status.id) ?? []}
                  workspaceId={workspaceId}
                  spaceId={spaceId}
                  listId={listId}
                  sprintId={sprintInfo.id}
                  isAdmin={isAdmin}
                  selectedIds={selectedIds}
                  onSelect={handleSelect}
                  onRefresh={fetchData}
                />
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          selectedIds={selectedIds}
          statuses={statuses}
          workspaceId={workspaceId}
          spaceId={spaceId}
          listId={listId}
          isAdmin={isAdmin}
          onClear={() => setSelectedIds(new Set())}
        />
      )}
    </>
  );
}
