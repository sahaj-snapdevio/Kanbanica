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
  PencilSimpleIcon,
  PlusIcon,
  TrayIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import { addDays, format, isToday, isPast } from "date-fns";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getActiveSprintView,
  addTaskToSprint,
  getSprints,
  bulkMoveTasksToSprint,
  bulkRemoveTasksFromSprint,
} from "@/app/actions/sprint";
import {
  archiveTask,
  bulkArchiveTasks,
  bulkDeleteTasks,
  bulkMoveTasks,
  bulkUpdateStatus,
  createTask,
  deleteTask,
  duplicateTask,
  getWorkspaceMembers,
  updateTask,
} from "@/app/actions/task";
import { addAssignee, removeAssignee } from "@/app/actions/task-assignee";
import { createListStatus, getWorkspaceLists, updateListStatus } from "@/app/actions/list";
import { cn } from "@/lib/utils";

const STATUS_PRESET_COLORS = [
  "#6B7280", "#3B82F6", "#10B981", "#F59E0B",
  "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4",
  "#F97316", "#84CC16",
];

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

type WorkspaceMember = { userId: string | null; name: string | null; email: string | null; image: string | null };

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

  // ── Inline editing ────────────────────────────────────────────────────────
  const [assigneeOpen, setAssigneeOpen] = React.useState(false);
  const [members, setMembers] = React.useState<WorkspaceMember[] | null>(null);
  const [memberSearch, setMemberSearch] = React.useState("");
  const [dateOpen, setDateOpen] = React.useState(false);
  const [priorityOpen, setPriorityOpen] = React.useState(false);

  async function loadMembers() {
    if (members !== null) return;
    const res = await getWorkspaceMembers(workspaceId);
    if ("error" in res) return;
    setMembers(res.members);
  }

  async function handleToggleAssignee(userId: string | null) {
    if (!userId) return;
    const isAssigned = task.assignees.some((a) => a.userId === userId);
    if (isAssigned) {
      await removeAssignee(workspaceId, spaceId, listId, task.id, userId);
    } else {
      await addAssignee(workspaceId, spaceId, listId, task.id, userId);
    }
    router.refresh();
  }

  async function handleSetDueDate(date: Date | null) {
    await updateTask(workspaceId, spaceId, listId, task.id, { dueDateStart: date, dueDateEnd: date });
    setDateOpen(false);
    router.refresh();
  }

  async function handleSetPriority(p: string) {
    await updateTask(workspaceId, spaceId, listId, task.id, { priority: p as "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT" });
    setPriorityOpen(false);
    router.refresh();
  }

  const filteredMembers = (members ?? []).filter(
    (m) =>
      m.name?.toLowerCase().includes(memberSearch.toLowerCase()) ||
      m.email?.toLowerCase().includes(memberSearch.toLowerCase()),
  );

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
      <div className="w-36 shrink-0 px-2 flex items-stretch" onClick={(e) => e.stopPropagation()}>
        <Popover open={assigneeOpen} onOpenChange={(o) => { setAssigneeOpen(o); if (o) void loadMembers(); }}>
          <PopoverTrigger asChild>
            <button className="flex flex-1 items-center gap-2 rounded px-2 py-2.5 hover:bg-accent transition-colors text-left">
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
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="w-72 p-2">
            <Input
              placeholder="Search members…"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="h-8 text-xs mb-2"
            />
            {members === null ? (
              <p className="py-2 px-1 text-xs text-muted-foreground">Loading…</p>
            ) : filteredMembers.length === 0 ? (
              <p className="py-2 px-1 text-xs text-muted-foreground">No members found</p>
            ) : (
              <div className="max-h-52 overflow-y-auto">
                <p className="px-1 pb-1 text-2xs font-semibold text-muted-foreground uppercase tracking-wide">People</p>
                {filteredMembers.map((m) => {
                  const assigned = task.assignees.some((a) => a.userId === m.userId);
                  return (
                    <button
                      key={m.userId}
                      onClick={() => void handleToggleAssignee(m.userId)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors",
                        assigned ? "bg-primary/10" : "hover:bg-accent",
                      )}
                    >
                      <Avatar className="size-6 shrink-0">
                        {m.image && <AvatarImage src={m.image} />}
                        <AvatarFallback className="text-2xs bg-primary/10 text-primary font-semibold">
                          {userInitials(m.name ?? m.email ?? "?")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex-1 min-w-0 text-left truncate">{m.name ?? m.email}</span>
                      {assigned && <CheckIcon className="size-3.5 text-primary shrink-0" weight="bold" />}
                    </button>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Due date */}
      <div className="w-28 shrink-0 px-2 flex items-stretch" onClick={(e) => e.stopPropagation()}>
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <button className={cn(
              "flex flex-1 items-center gap-1.5 rounded px-2 py-2.5 text-sm font-medium hover:bg-accent transition-colors",
              dueDate?.overdue ? "text-red-500" : "text-muted-foreground",
            )}>
              {dueDate ? dueDate.label : <CalendarBlankIcon className="size-4 text-muted-foreground/30" />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="w-44 p-1">
            {[
              { label: "Today",     date: new Date() },
              { label: "Tomorrow",  date: addDays(new Date(), 1) },
              { label: "Next week", date: addDays(new Date(), 7) },
              { label: "2 weeks",   date: addDays(new Date(), 14) },
            ].map(({ label, date }) => (
              <button
                key={label}
                onClick={() => void handleSetDueDate(date)}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-accent"
              >
                <span>{label}</span>
                <span className="text-xs text-muted-foreground">{format(date, "MMM d")}</span>
              </button>
            ))}
            {task.dueDateStart && (
              <>
                <div className="h-px bg-border my-1" />
                <button
                  onClick={() => void handleSetDueDate(null)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                >
                  <XIcon className="size-3.5 shrink-0" />
                  Clear date
                </button>
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Priority */}
      <div className="w-28 shrink-0 px-2 flex items-stretch" onClick={(e) => e.stopPropagation()}>
        <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
          <PopoverTrigger asChild>
            <button className="flex flex-1 items-center gap-1.5 rounded px-2 py-2.5 hover:bg-accent transition-colors">
              {task.priority && task.priority !== "NONE" ? (
                <span className={cn("flex items-center gap-1.5 text-sm font-medium", priority.color)}>
                  <FlagIcon className="size-4 shrink-0" weight="fill" />
                  {priority.label}
                </span>
              ) : (
                <FlagIcon className="size-4 text-muted-foreground/30" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="w-44 p-1">
            <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">Priority</p>
            {([
              { value: "URGENT", label: "Urgent", color: "text-red-500"    },
              { value: "HIGH",   label: "High",   color: "text-yellow-500" },
              { value: "MEDIUM", label: "Medium", color: "text-blue-500"   },
              { value: "LOW",    label: "Low",    color: "text-gray-400"   },
            ] as const).map(({ value, label, color }) => (
              <button
                key={value}
                onClick={() => void handleSetPriority(value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent",
                  task.priority === value && "bg-accent",
                )}
              >
                <FlagIcon className={cn("size-3.5 shrink-0", color)} weight="fill" />
                {label}
              </button>
            ))}
            <div className="h-px bg-border my-1" />
            <button
              onClick={() => void handleSetPriority("NONE")}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            >
              <XIcon className="size-3.5 shrink-0" />
              Clear
            </button>
          </PopoverContent>
        </Popover>
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
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [newStatusOpen, setNewStatusOpen] = React.useState(false);
  const [renameName, setRenameName] = React.useState(status.name);
  const [newStatusName, setNewStatusName] = React.useState("");
  const [newStatusColor, setNewStatusColor] = React.useState("#6B7280");
  const [saving, setSaving] = React.useState(false);

  async function handleRename() {
    const trimmed = renameName.trim();
    if (!trimmed || trimmed === status.name) { setRenameOpen(false); return; }
    setSaving(true);
    const res = await updateListStatus(workspaceId, spaceId, listId, status.id, { name: trimmed });
    setSaving(false);
    if ("error" in res) { toast.error(res.error); return; }
    setRenameOpen(false);
    onRefresh();
  }

  async function handleCreateStatus() {
    if (!newStatusName.trim()) return;
    setSaving(true);
    const res = await createListStatus(workspaceId, spaceId, listId, {
      name: newStatusName.trim(),
      color: newStatusColor,
      type: "OPEN",
    });
    setSaving(false);
    if ("error" in res) { toast.error(res.error); return; }
    setNewStatusName("");
    setNewStatusColor("#6B7280");
    setNewStatusOpen(false);
    onRefresh();
  }

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
    <>
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
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button className="flex size-6 items-center justify-center rounded hover:bg-accent transition-colors">
                <DotsThreeIcon className="size-4.5 text-muted-foreground" weight="bold" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-48 p-1 mt-1">
              <p className="px-2 py-1 text-xs font-semibold text-muted-foreground">Group options</p>
              <button
                onClick={() => { setMenuOpen(false); setRenameName(status.name); setRenameOpen(true); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
              >
                <PencilSimpleIcon className="size-3.5 text-muted-foreground shrink-0" />
                Rename
              </button>
              <button
                onClick={() => { setMenuOpen(false); setNewStatusOpen(true); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
              >
                <PlusIcon className="size-3.5 text-muted-foreground shrink-0" />
                New status
              </button>
              <div className="h-px bg-border my-1" />
              <button
                onClick={() => { setCollapsed((v) => !v); setMenuOpen(false); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
              >
                {collapsed
                  ? <CaretRightIcon className="size-3.5 text-muted-foreground shrink-0" />
                  : <CaretDownIcon className="size-3.5 text-muted-foreground shrink-0" />
                }
                {collapsed ? "Expand group" : "Collapse group"}
              </button>
            </PopoverContent>
          </Popover>
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

    {/* Rename status dialog */}
    <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Rename status</DialogTitle>
        </DialogHeader>
        <Input
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleRename(); }}
          autoFocus
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setRenameOpen(false)}>Cancel</Button>
          <Button onClick={() => void handleRename()} disabled={saving || !renameName.trim()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* New status dialog */}
    <Dialog open={newStatusOpen} onOpenChange={setNewStatusOpen}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>New status</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Status name"
            value={newStatusName}
            onChange={(e) => setNewStatusName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleCreateStatus(); }}
            autoFocus
          />
          <div className="flex flex-wrap gap-2">
            {STATUS_PRESET_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setNewStatusColor(color)}
                className={cn(
                  "size-6 rounded-full border-2 transition-transform",
                  newStatusColor === color ? "border-foreground scale-110" : "border-transparent",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setNewStatusOpen(false)}>Cancel</Button>
          <Button onClick={() => void handleCreateStatus()} disabled={saving || !newStatusName.trim()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ─── Bulk action bar ──────────────────────────────────────────────────────────

type SprintOption = { id: string; name: string; status: "PLANNED" | "ACTIVE" | "CLOSED" };

function BulkActionBar({
  count,
  selectedIds,
  statuses,
  workspaceId,
  spaceId,
  listId,
  currentSprintId,
  isAdmin,
  onClear,
  onRefresh,
}: {
  count: number;
  selectedIds: Set<string>;
  statuses: Status[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  currentSprintId: string;
  isAdmin?: boolean;
  onClear: () => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [sprints, setSprints] = React.useState<SprintOption[] | null>(null);
  const [loadingSprints, setLoadingSprints] = React.useState(false);
  const [listSpaces, setListSpaces] = React.useState<{ id: string; name: string; color: string | null; lists: { id: string; name: string; color: string | null }[] }[] | null>(null);
  const [loadingLists, setLoadingLists] = React.useState(false);

  async function loadSprints() {
    if (sprints !== null) return;
    setLoadingSprints(true);
    const res = await getSprints(workspaceId, spaceId, listId);
    setLoadingSprints(false);
    if ("error" in res) return;
    setSprints(res.sprints.filter((s) => s.status !== "CLOSED" && s.id !== currentSprintId));
  }

  async function loadLists() {
    if (listSpaces !== null) return;
    setLoadingLists(true);
    const res = await getWorkspaceLists(workspaceId, listId);
    setLoadingLists(false);
    if ("error" in res) return;
    setListSpaces(res.spaces);
  }

  async function handleMoveToList(targetListId: string, targetListName: string) {
    setBusy(true);
    const res = await bulkMoveTasks(workspaceId, spaceId, [...selectedIds], targetListId);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Moved ${res.moved} task${res.moved !== 1 ? "s" : ""} to ${targetListName}`);
    onClear();
    onRefresh();
  }

  async function handleBulkStatus(statusId: string) {
    setBusy(true);
    const res = await bulkUpdateStatus(workspaceId, spaceId, listId, [...selectedIds], statusId);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Updated ${count} task${count > 1 ? "s" : ""}`);
    onClear();
  }

  async function handleMoveToSprint(sprintId: string, sprintName: string) {
    setBusy(true);
    const res = await bulkMoveTasksToSprint(workspaceId, spaceId, listId, [...selectedIds], sprintId);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Moved ${res.moved} task${res.moved !== 1 ? "s" : ""} to ${sprintName}`);
    onClear();
    onRefresh();
  }

  async function handleMoveToBacklog() {
    setBusy(true);
    const res = await bulkRemoveTasksFromSprint(workspaceId, spaceId, listId, currentSprintId, [...selectedIds]);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Moved ${count} task${count > 1 ? "s" : ""} to backlog`);
    onClear();
    onRefresh();
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

      {/* Status */}
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

      {/* Move (Sprint + List) */}
      <Popover onOpenChange={(open) => { if (open) { void loadSprints(); void loadLists(); } }}>
        <PopoverTrigger asChild>
          <button
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
          >
            <CaretDownIcon className="size-3.5" />
            Move
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" side="top" className="w-56 p-1 mb-1 max-h-72 overflow-y-auto">
          {/* Sprint section */}
          <p className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sprint</p>
          {loadingSprints && <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>}
          {!loadingSprints && sprints?.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No other sprints available</p>
          )}
          {!loadingSprints && sprints?.map((s) => (
            <button
              key={s.id}
              onClick={() => handleMoveToSprint(s.id, s.name)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <LightningIcon
                className={cn("size-3.5 shrink-0", s.status === "ACTIVE" ? "text-primary" : "text-muted-foreground")}
                weight="fill"
              />
              <span className="flex-1 text-left truncate">{s.name}</span>
              <span className={cn(
                "text-2xs font-medium px-1.5 py-0.5 rounded-full shrink-0",
                s.status === "ACTIVE" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}>
                {s.status === "ACTIVE" ? "Active" : "Planned"}
              </span>
            </button>
          ))}

          {/* Divider */}
          <div className="h-px bg-border my-1" />

          {/* List section */}
          <p className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">List</p>
          {loadingLists && <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>}
          {!loadingLists && listSpaces?.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No other lists available</p>
          )}
          {!loadingLists && listSpaces?.map((sp) => (
            <div key={sp.id}>
              <p className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground">
                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: sp.color ?? "#6B7280" }} />
                {sp.name}
              </p>
              {sp.lists.map((l) => (
                <button
                  key={l.id}
                  onClick={() => handleMoveToList(l.id, l.name)}
                  className="flex w-full items-center gap-2 rounded pl-5 pr-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: l.color ?? "#6B7280" }} />
                  <span className="flex-1 text-left truncate">{l.name}</span>
                </button>
              ))}
            </div>
          ))}
        </PopoverContent>
      </Popover>

      {/* Move to Backlog */}
      <button
        disabled={busy}
        onClick={handleMoveToBacklog}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
      >
        <TrayIcon className="size-3.5" />
        Backlog
      </button>

      <div className="h-4 w-px bg-white/20 mx-1" />

      {/* Archive */}
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
          currentSprintId={sprintInfo.id}
          isAdmin={isAdmin}
          onClear={() => setSelectedIds(new Set())}
          onRefresh={fetchData}
        />
      )}
    </>
  );
}
