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
  PlusIcon,
  TrashIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import {
  archiveTask,
  bulkArchiveTasks,
  bulkDeleteTasks,
  bulkUpdateStatus,
  deleteTask,
  duplicateTask,
} from "@/app/actions/task";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CreateTaskModal } from "@/components/task/create-task-modal";
import { cn } from "@/lib/utils";
import { format, isToday, isPast } from "date-fns";

interface Status {
  id: string;
  name: string;
  color: string;
  type: "OPEN" | "ACTIVE" | "CLOSED";
  orderIndex: number;
}

interface Task {
  id: string;
  title: string;
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  statusId: string;
  seqNumber: number;
  orderIndex: number;
  dueDateStart: Date | null;
  dueDateEnd: Date | null;
  tags: { id: string; name: string; color: string }[];
  assignees: { userId: string; name: string; image: string | null }[];
}

interface ListViewProps {
  workspaceId: string;
  spaceId: string;
  listId: string;
  statuses: Status[];
  tasks: Task[];
  isAdmin?: boolean;
}

const PRIORITY_CONFIG = {
  NONE:   { label: "—",      color: "text-muted-foreground/40",  icon: "😴" },
  LOW:    { label: "Low",    color: "text-blue-500",              icon: "🐢" },
  MEDIUM: { label: "Medium", color: "text-yellow-500",            icon: "🚶" },
  HIGH:   { label: "High",   color: "text-orange-500",            icon: "🏃" },
  URGENT: { label: "Urgent", color: "text-red-500",               icon: "⚡" },
} as const;

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

// ─── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  workspaceId,
  spaceId,
  listId,
  isAdmin,
  selected,
  onSelect,
  onOpen,
}: {
  task: Task;
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onOpen: () => void;
}) {
  const priority = PRIORITY_CONFIG[task.priority];
  const dueDate = formatDueDate(task.dueDateStart);

  async function handleDuplicate(e: React.MouseEvent) {
    e.stopPropagation();
    await duplicateTask(workspaceId, spaceId, listId, task.id);
  }
  async function handleArchive(e: React.MouseEvent) {
    e.stopPropagation();
    await archiveTask(workspaceId, spaceId, listId, task.id);
  }
  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
    await deleteTask(workspaceId, spaceId, listId, task.id);
  }

  return (
    <div
      className={cn(
        "group/row flex items-center border-b border-border/50 transition-colors cursor-pointer",
        selected ? "bg-primary/5" : "hover:bg-accent/30",
      )}
      onClick={onOpen}
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
        <span className="text-xs text-muted-foreground/50 font-mono shrink-0 w-7">#{task.seqNumber}</span>
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
              <Avatar key={a.userId} className="size-7 border-2 border-background ring-0" title={a.name}>
                {a.image && <AvatarImage src={a.image} alt={a.name} />}
                <AvatarFallback className="text-xs bg-primary text-primary-foreground font-semibold">
                  {userInitials(a.name)}
                </AvatarFallback>
              </Avatar>
            ))}
            {task.assignees.length > 3 && (
              <div className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-xs text-muted-foreground font-medium">
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
        {task.priority !== "NONE" ? (
          <span className={cn("flex items-center gap-1 text-sm font-medium", priority.color)}>
            <span>{priority.icon}</span>
            {priority.label}
          </span>
        ) : (
          <FlagIcon className="size-4 text-muted-foreground/30" />
        )}
      </div>

      {/* Actions */}
      <div className="w-10 shrink-0 py-2.5 pr-3 flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
        <Popover>
          <PopoverTrigger asChild>
            <button className="opacity-0 group-hover/row:opacity-100 flex size-7 items-center justify-center rounded-md hover:bg-accent transition-opacity">
              <DotsThreeIcon className="size-4.5 text-muted-foreground" weight="bold" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-40 p-1">
            <button onClick={handleDuplicate} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
              <CopyIcon className="size-3.5 text-muted-foreground" /> Duplicate
            </button>
            <button onClick={handleArchive} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
              <ArchiveIcon className="size-3.5 text-muted-foreground" /> Archive
            </button>
            {isAdmin && (
              <button onClick={handleDelete} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10">
                <TrashIcon className="size-3.5" /> Delete
              </button>
            )}
          </PopoverContent>
        </Popover>
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
  isAdmin,
  selectedIds,
  onSelect,
  onCreateTask,
}: {
  status: Status;
  tasks: Task[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  onCreateTask: (statusId: string) => void;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);

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
      <div className="group/header flex items-center gap-2 py-2 px-3 cursor-pointer select-none">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex size-5 items-center justify-center rounded hover:bg-accent transition-colors shrink-0 cursor-pointer"
        >
          {collapsed
            ? <CaretRightIcon weight="fill" className="size-3 text-muted-foreground" />
            : <CaretDownIcon weight="fill" className="size-3 text-muted-foreground" />
          }
        </button>

        <Badge
          variant="outline"
          className="text-xs px-2 py-1 rounded font-semibold cursor-pointer"
          style={{ borderColor: `${status.color}50`, backgroundColor: `${status.color}18`, color: status.color }}
          onClick={() => setCollapsed(!collapsed)}
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
            onClick={() => onCreateTask(status.id)}
          >
            <PlusIcon className="size-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Expanded: column headers + tasks */}
      {!collapsed && (
        <div>
          {/* Column headers row */}
          <div className="flex items-center border-y border-border bg-muted/40">
            {/* Select-all checkbox */}
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
              onOpen={() => router.push(`/${workspaceId}/task/${task.id}`)}
            />
          ))}

          <button
            onClick={() => onCreateTask(status.id)}
            className="flex w-full items-center gap-2 pl-10 pr-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors"
          >
            <PlusIcon className="size-3.5 shrink-0" />
            Add Task
          </button>
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
      {/* Count + clear */}
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

      {/* Delete — admin only */}
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

export function ListView({
  workspaceId,
  spaceId,
  listId,
  statuses,
  tasks,
  isAdmin,
}: ListViewProps) {
  const [createForStatusId, setCreateForStatusId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  function handleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  const tasksByStatus = React.useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const s of statuses) map.set(s.id, []);
    for (const t of tasks) {
      const group = map.get(t.statusId);
      if (group) group.push(t);
      else map.get(statuses[0]?.id ?? "")?.push(t);
    }
    return map;
  }, [statuses, tasks]);

  return (
    <>
      <CreateTaskModal
        open={createForStatusId !== null}
        onOpenChange={(open) => { if (!open) setCreateForStatusId(null); }}
        workspaceId={workspaceId}
        spaceId={spaceId}
        listId={listId}
        statuses={statuses}
        defaultStatusId={createForStatusId ?? undefined}
      />

      <div className="overflow-hidden">
        <div>
          {statuses.map((status) => (
            <StatusGroup
              key={status.id}
              status={status}
              tasks={tasksByStatus.get(status.id) ?? []}
              workspaceId={workspaceId}
              spaceId={spaceId}
              listId={listId}
              isAdmin={isAdmin}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onCreateTask={setCreateForStatusId}
            />
          ))}
        </div>
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
