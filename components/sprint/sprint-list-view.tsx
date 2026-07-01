"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  DotsThreeIcon,
  FunnelIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  PencilSimpleIcon,
  PlusIcon,
  RowsIcon,
  SquaresFourIcon,
  TrayIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SearchInput } from "@/components/ui/search-input";
import { useRealtimeRefetch, useRealtimePause } from "@/components/realtime/realtime-provider";
import { TaskListRow, type TaskListRowProps } from "@/components/task/task-list-row";
import { PRIORITY_CONFIG, userInitials, avatarSrc } from "@/lib/priority-config";
import { format } from "date-fns";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
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
  getArchivedTasksForSprint,
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
  reorderTasksById,
  unarchiveTask,
  updateTaskStatus,
} from "@/app/actions/task";
import { toastWithUndo } from "@/lib/undo-toast";
import { createListStatus, getWorkspaceLists, updateListStatus } from "@/app/actions/list";
import { CreateTaskModal } from "@/components/task/create-task-modal";
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
  statusId: string | null;
  listId: string | null;
  orderIndex: number;
  dueDateStart: Date | null;
  dueDateEnd: Date | null;
  statusName: string | null;
  statusColor: string | null;
  statusType: "OPEN" | "ACTIVE" | "CLOSED" | null;
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
  listId?: string;
  statuses?: Status[];
  isAdmin?: boolean;
  canEdit?: boolean;
  members?: { userId: string; name: string | null; email: string | null }[];
  tags?: { id: string; name: string; color: string }[];
  refreshKey?: number;
}

type SprintOption = { id: string; name: string; status: "PLANNED" | "ACTIVE" | "CLOSED" };
type ListSpaceOption = { id: string; name: string; color: string | null; lists: { id: string; name: string; color: string | null }[] };

function formatDateRange(start: Date | null, end: Date | null): string {
  const fmt = (d: Date | null) => (d ? format(new Date(d), "M/d") : "—");
  return `${fmt(start)} - ${fmt(end)}`;
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
  listId?: string;
  sprintId: string;
  statusId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Close the quick-create row when the user clicks anywhere outside of it.
  // This also closes it when another group's "Add Task" is clicked, so only
  // one quick-create row is ever open at a time. An in-flight save is left
  // untouched so the submit isn't interrupted.
  React.useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (saving) return;
      if (wrapperRef.current?.contains(e.target as Node)) return;
      onOpenChange(false);
      setTitle("");
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, saving, onOpenChange]);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) { onOpenChange(false); return; }
    setSaving(true);
    try {
      const res = await createTask(workspaceId, spaceId, listId || null, { title: trimmed, statusId });
      if ("error" in res) return;
      await addTaskToSprint(workspaceId, spaceId, sprintId, res.taskId);
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
    <div ref={wrapperRef} className="py-1.5 pl-10 pr-4">
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

// ─── Sortable row wrapper (list view) ─────────────────────────────────────────

function SortableSprintListRow(props: Omit<TaskListRowProps, "dragRef" | "dragStyle" | "dragProps" | "isDragging">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: { type: "sprint-task", statusId: props.task.statusId },
  });
  return (
    <TaskListRow
      {...props}
      dragRef={setNodeRef}
      dragStyle={{ transform: CSS.Transform.toString(transform), transition }}
      dragProps={{ ...attributes, ...listeners }}
      isDragging={isDragging}
    />
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
  statuses,
  isAdmin,
  canEdit,
  selectedIds,
  onSelect,
  onRefresh,
}: {
  status: Status;
  tasks: SprintTask[];
  workspaceId: string;
  spaceId: string;
  listId?: string;
  sprintId: string;
  statuses: Status[];
  isAdmin?: boolean;
  canEdit?: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  onRefresh: () => void;
}) {
  const router = useRouter();
  // Droppable zone so tasks can be dragged into this status group (including
  // when it is empty). Reorder + cross-status persistence is handled by the
  // single parent DndContext, mirroring the project List view.
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: status.id });
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
    const res = await updateListStatus(workspaceId, spaceId, listId ?? "", status.id, { name: trimmed });
    setSaving(false);
    if ("error" in res) { toast.error(res.error); return; }
    setRenameOpen(false);
    onRefresh();
  }

  async function handleCreateStatus() {
    if (!newStatusName.trim()) return;
    setSaving(true);
    const res = await createListStatus(workspaceId, spaceId, listId ?? "", {
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
      <div
        onClick={() => setCollapsed((v) => !v)}
        className="group/header flex items-center gap-2.5 py-1.5 px-3 hover:bg-accent/40 transition-colors cursor-pointer select-none border-b border-border"
      >
        <div className="flex size-5 items-center justify-center rounded hover:bg-accent transition-colors shrink-0 text-muted-foreground group-hover/header:text-foreground/70">
          {collapsed
            ? <CaretRightIcon weight="fill" className="size-3" />
            : <CaretDownIcon weight="fill" className="size-3" />}
        </div>

        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider border transition-all"
          style={{ backgroundColor: `${status.color}12`, color: status.color, borderColor: `${status.color}25` }}
        >
          <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: status.color }} />
          {status.name}
        </span>

        <span className="text-xs text-muted-foreground font-semibold tabular-nums">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
        </span>

        <div className="ml-2 flex items-center gap-1 opacity-0 group-hover/header:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
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
          <div className="flex items-center">
            <div className="w-0.75 self-stretch shrink-0" />
            <div
              className="flex w-14 shrink-0 items-center justify-center py-2 pl-2 cursor-pointer"
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
            <div className="flex-1 py-2 pr-4 pl-1 text-2xs font-bold text-gray-400 uppercase tracking-wider">Name</div>
            <div className="w-36 shrink-0 py-2 px-4 text-2xs font-bold text-gray-400 uppercase tracking-wider text-center">Assignee</div>
            <div className="w-28 shrink-0 py-2 px-4 text-2xs font-bold text-gray-400 uppercase tracking-wider">Due date</div>
            <div className="w-32 shrink-0 py-2 px-4 text-2xs font-bold text-gray-400 uppercase tracking-wider">Priority</div>
            <div className="w-48 shrink-0" />
          </div>

          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <div
              ref={setDropRef}
              className={cn("flex flex-col transition-colors min-h-1", isOver && "bg-accent/20")}
            >
              {tasks.map((task) => (
                <SortableSprintListRow
                  key={task.id}
                  task={task}
                  statusColor={status.color}
                  workspaceId={workspaceId}
                  spaceId={spaceId}
                  excludeSprintId={sprintId}
                  statuses={statuses}
                  isAdmin={isAdmin}
                  canEdit={canEdit}
                  selected={selectedIds.has(task.id)}
                  onSelect={onSelect}
                  onOpen={() => router.push(`/${workspaceId}/task/${task.id}?from=sprint&sid=${sprintId}`)}
                  onRefresh={onRefresh}
                  onAfterDuplicate={async (newTaskId) => {
                    await addTaskToSprint(workspaceId, spaceId, sprintId, newTaskId);
                  }}
                  onMoveToBacklog={async () => {
                    const res = await bulkRemoveTasksFromSprint(workspaceId, spaceId, sprintId, [task.id]);
                    if ("error" in res) { toast.error(res.error); return; }
                    onRefresh();
                  }}
                />
              ))}
            </div>
          </SortableContext>

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
  listId?: string;
  currentSprintId: string;
  isAdmin?: boolean;
  onClear: () => void;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [sprints, setSprints] = React.useState<SprintOption[] | null>(null);
  const [loadingSprints, setLoadingSprints] = React.useState(false);
  const [listSpaces, setListSpaces] = React.useState<{ id: string; name: string; color: string | null; lists: { id: string; name: string; color: string | null }[] }[] | null>(null);
  const [loadingLists, setLoadingLists] = React.useState(false);

  async function loadSprints() {
    if (sprints !== null) return;
    setLoadingSprints(true);
    const res = await getSprints(workspaceId, spaceId);
    setLoadingSprints(false);
    if ("error" in res) return;
    setSprints(res.sprints.filter((s) => s.status !== "CLOSED" && s.id !== currentSprintId));
  }

  async function loadLists() {
    if (listSpaces !== null) return;
    setLoadingLists(true);
    const res = await getWorkspaceLists(workspaceId, listId ?? "");
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
    const res = await bulkUpdateStatus(workspaceId, spaceId, listId ?? "", [...selectedIds], statusId);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Updated ${count} task${count > 1 ? "s" : ""}`);
    onClear();
    onRefresh();
  }

  async function handleMoveToSprint(sprintId: string, sprintName: string) {
    setBusy(true);
    const res = await bulkMoveTasksToSprint(workspaceId, spaceId, listId ?? null, [...selectedIds], sprintId);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Moved ${res.moved} task${res.moved !== 1 ? "s" : ""} to ${sprintName}`);
    onClear();
    onRefresh();
  }

  async function handleMoveToBacklog() {
    setBusy(true);
    const res = await bulkRemoveTasksFromSprint(workspaceId, spaceId, currentSprintId, [...selectedIds]);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Moved ${count} task${count > 1 ? "s" : ""} to backlog`);
    onClear();
    onRefresh();
  }

  async function handleBulkArchive() {
    setBusy(true);
    const res = await bulkArchiveTasks(workspaceId, spaceId, listId ?? "", [...selectedIds]);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Archived ${count} task${count > 1 ? "s" : ""}`);
    onClear();
    onRefresh();
  }

  async function confirmBulkDelete() {
    setDeleteOpen(false);
    setBusy(true);
    const res = await bulkDeleteTasks(workspaceId, spaceId, listId ?? "", [...selectedIds]);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Deleted ${count} task${count > 1 ? "s" : ""}`);
    onClear();
    onRefresh();
  }

  return (
    <>
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DialogContent className="sm:max-w-xs text-center">
        <div className="flex flex-col items-center gap-3 pt-2">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <TrashIcon className="size-6 text-destructive" weight="fill" />
          </div>
          <div>
            <DialogTitle className="text-base font-bold">Delete {count} Task{count > 1 ? "s" : ""}</DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">This action cannot be undone.</p>
          </div>
        </div>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" className="flex-1" onClick={() => setDeleteOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="destructive" className="flex-1" onClick={confirmBulkDelete} disabled={busy}>Delete</Button>
        </div>
      </DialogContent>
    </Dialog>
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
          onClick={() => setDeleteOpen(true)}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50"
        >
          <TrashIcon className="size-3.5" />
          Delete
        </button>
      )}
    </div>
    </>
  );
}

// ─── Board sub-components ─────────────────────────────────────────────────────

function SprintBoardCardContent({
  task,
  workspaceId,
  sprintId,
  overlay = false,
  isDragging = false,
  dragListeners,
}: {
  task: SprintTask;
  workspaceId: string;
  sprintId: string;
  overlay?: boolean;
  isDragging?: boolean;
  dragListeners?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const router = useRouter();
  const priority = PRIORITY_CONFIG[(task.priority ?? "NONE") as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.NONE;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 shadow-sm",
        isDragging && "opacity-40 shadow-none border-dashed",
        overlay && "shadow-xl rotate-1 cursor-grabbing",
        !isDragging && !overlay && "hover:shadow-md transition-shadow cursor-pointer",
      )}
      onClick={() => !isDragging && !overlay && router.push(`/${workspaceId}/task/${task.id}?from=sprint&sid=${sprintId}`)}
    >
      <div {...dragListeners} className={cn(!overlay && "cursor-grab active:cursor-grabbing")}>
        <p className="text-[13px] font-medium text-foreground leading-snug select-none line-clamp-2">{task.title}</p>
        {task.tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {task.tags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-full px-1.5 py-0.5 text-2xs font-medium"
                style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="font-mono text-2xs text-muted-foreground shrink-0">#{task.seqNumber}</span>
          <div className="flex items-center gap-2 min-w-0">
            {(task.priority && task.priority !== "NONE") && (
              <span className={cn("flex items-center gap-1 text-xs font-bold shrink-0", priority.color)}>
                <span>{priority.icon}</span>
                {priority.label}
              </span>
            )}
            {task.assignees.length > 0 && (
              <div className="flex -space-x-1.5 ml-auto">
                {task.assignees.slice(0, 3).map((a) => (
                  <Avatar key={a.userId} className="size-7 border-2 border-background" title={a.name}>
                    {a.image && <AvatarImage src={avatarSrc(a.image)} alt={a.name} />}
                    <AvatarFallback className="text-xs font-semibold bg-primary text-primary-foreground">
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SprintBoardCard({ task, workspaceId, sprintId }: { task: SprintTask; workspaceId: string; sprintId: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: "task", statusId: task.statusId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <SprintBoardCardContent
        task={task}
        workspaceId={workspaceId}
        sprintId={sprintId}
        isDragging={isDragging}
        dragListeners={listeners}
      />
    </div>
  );
}

function SprintBoardStaticCard({ task, workspaceId, sprintId }: { task: SprintTask; workspaceId: string; sprintId: string }) {
  return (
    <div className="opacity-80">
      <SprintBoardCardContent task={task} workspaceId={workspaceId} sprintId={sprintId} />
    </div>
  );
}

function SprintBoardColumn({
  status,
  tasks,
  workspaceId,
  sprintId,
}: {
  status: { id: string; name: string; color: string };
  tasks: SprintTask[];
  workspaceId: string;
  sprintId: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });

  return (
    <div
      className="flex w-72 shrink-0 flex-col rounded-xl p-2 gap-2 max-h-[calc(100vh-16rem)]"
      style={{ backgroundColor: `${status.color}14` }}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-1 py-1">
        <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: status.color }} />
        <span className="flex-1 font-semibold text-sm uppercase tracking-wide text-foreground/80">{status.name}</span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{ backgroundColor: `${status.color}22`, color: status.color }}
        >
          {tasks.length}
        </span>
      </div>

      {/* Droppable task list */}
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "flex flex-col gap-2 rounded-lg p-1 transition-all flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
            tasks.length === 0 && "min-h-8",
          )}
          style={isOver ? { boxShadow: `inset 0 0 0 2px ${status.color}` } : undefined}
        >
          {tasks.map((t) => (
            <SprintBoardCard key={t.id} task={t} workspaceId={workspaceId} sprintId={sprintId} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function NoStatusColumn({ tasks, workspaceId, sprintId }: { tasks: SprintTask[]; workspaceId: string; sprintId: string }) {
  return (
    <div
      className="flex w-72 shrink-0 flex-col rounded-xl p-2 gap-2 max-h-[calc(100vh-16rem)]"
      style={{ backgroundColor: "#94a3b814" }}
    >
      <div className="flex items-center gap-2 px-1 py-1">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground/40 shrink-0" />
        <span className="flex-1 font-semibold text-sm uppercase tracking-wide text-foreground/80">No Status</span>
        <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-muted text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-col gap-2 rounded-lg p-1 flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
        {tasks.map((t) => (
          <SprintBoardStaticCard key={t.id} task={t} workspaceId={workspaceId} sprintId={sprintId} />
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function SprintListView({ workspaceId, spaceId, listId = "", statuses = [], isAdmin, canEdit, members = [], refreshKey }: SprintListViewProps) {
  const router = useRouter();
  const [sprintInfo, setSprintInfo] = React.useState<SprintInfo | null>(null);
  const [tasks, setTasks] = React.useState<SprintTask[]>([]);
  const [fetchedStatuses, setFetchedStatuses] = React.useState<Status[]>([]);
  // List that new tasks created from the sprint view belong to (so they get a
  // real list + default status instead of landing in "No Status").
  const [createListId, setCreateListId] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const initialLoadedRef = React.useRef(false);
  const [sprintCollapsed, setSprintCollapsed] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  // ── View toggle ───────────────────────────────────────────────────────────
  const [view, setView] = React.useState<"list" | "board">("list");
  const [boardTasks, setBoardTasks] = React.useState<SprintTask[]>([]);
  const [activeDragTask, setActiveDragTask] = React.useState<SprintTask | null>(null);

  // ── Toolbar state ─────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = React.useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = React.useState<string[]>([]);

  const hasActiveFilters = statusFilter.length > 0 || priorityFilter.length > 0 || assigneeFilter.length > 0;

  // ── Archived tasks ────────────────────────────────────────────────────────
  const [showArchived, setShowArchived] = React.useState(false);
  const [archivedTasks, setArchivedTasks] = React.useState<{ id: string; title: string; seqNumber: number; listId: string | null }[]>([]);
  const [archivedLoading, setArchivedLoading] = React.useState(false);

  const refreshArchived = React.useCallback(async () => {
    const result = await getArchivedTasksForSprint(workspaceId, spaceId);
    if (!("error" in result)) setArchivedTasks(result.tasks);
  }, [workspaceId, spaceId]);

  async function handleToggleArchived() {
    if (!showArchived && archivedTasks.length === 0) {
      setArchivedLoading(true);
      await refreshArchived();
      setArchivedLoading(false);
    }
    setShowArchived((v) => !v);
  }

  function handleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  const fetchData = React.useCallback(async () => {
    if (!initialLoadedRef.current) setLoading(true);
    try {
      const res = await getActiveSprintView(workspaceId, spaceId);
      if ("error" in res) return;
      setSprintInfo(res.sprint);
      setTasks(res.tasks as SprintTask[]);
      setFetchedStatuses((res.statuses ?? []) as Status[]);
      setCreateListId(res.defaultListId ?? "");
    } finally {
      if (!initialLoadedRef.current) {
        initialLoadedRef.current = true;
        setLoading(false);
      }
    }
  }, [workspaceId, spaceId, listId, refreshKey]);

  React.useEffect(() => { void fetchData(); }, [fetchData]);

  // Sync boardTasks when server tasks change
  React.useEffect(() => { setBoardTasks(tasks); }, [tasks]);

  // ── DnD sensors + handlers ────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Live-sync: re-pull the sprint when another member changes something, and
  // pause auto-refresh while this user is dragging so it can't clobber the drag.
  useRealtimeRefetch(fetchData);
  const pauseRealtime = useRealtimePause();
  const dragResumeRef = React.useRef<null | (() => void)>(null);
  const endDrag = React.useCallback(() => {
    dragResumeRef.current?.();
    dragResumeRef.current = null;
  }, []);

  function onDragStart({ active }: DragStartEvent) {
    endDrag();
    dragResumeRef.current = pauseRealtime();
    setActiveDragTask(boardTasks.find((t) => t.id === active.id) ?? null);
  }

  function onDragCancel() {
    setActiveDragTask(null);
    endDrag();
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    if (activeId === overId) return;
    const activeTask = boardTasks.find((t) => t.id === activeId);
    if (!activeTask) return;
    const overStatus = effectiveStatuses.find((s) => s.id === overId)?.id
      ?? boardTasks.find((t) => t.id === overId)?.statusId;
    if (!overStatus) return;

    if (overStatus === activeTask.statusId) {
      // Same column — reorder positions optimistically
      setBoardTasks((prev) => {
        const oldIndex = prev.findIndex((t) => t.id === activeId);
        const newIndex = prev.findIndex((t) => t.id === overId);
        if (oldIndex === -1 || newIndex === -1) return prev;
        return arrayMove(prev, oldIndex, newIndex);
      });
    } else {
      // Cross-column — move task to new column
      setBoardTasks((prev) => prev.map((t) => t.id === activeId ? { ...t, statusId: overStatus } : t));
    }
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    setActiveDragTask(null);
    endDrag();
    if (!over) return;
    const activeId = active.id as string;
    const activeTask = boardTasks.find((t) => t.id === activeId);
    if (!activeTask) return;
    const finalStatus = activeTask.statusId;
    const originalStatus = tasks.find((t) => t.id === activeId)?.statusId;

    if (finalStatus === originalStatus) {
      // Same column — persist new card order
      const columnTaskIds = boardTasks
        .filter((t) => t.statusId === finalStatus)
        .map((t) => t.id);
      const originalIds = tasks
        .filter((t) => t.statusId === originalStatus)
        .map((t) => t.id);
      if (columnTaskIds.join(",") === originalIds.join(",")) return;
      const res = await reorderTasksById(workspaceId, spaceId, columnTaskIds);
      if ("error" in res) { setBoardTasks(tasks); toast.error("Failed to reorder tasks"); }
    } else {
      // Cross-column — update status
      const res = await updateTaskStatus(workspaceId, spaceId, activeTask.listId, activeId, finalStatus!);
      if ("error" in res) { setBoardTasks(tasks); toast.error("Failed to update status"); }
      else { void fetchData(); }
    }
  }

  // ── Filtered tasks ────────────────────────────────────────────────────────
  // Shared search/filter predicate, applied to both the list grouping and the
  // board grouping (the board uses its own `boardTasks` state for drag-and-drop).
  const matchesFilters = React.useCallback(
    (t: SprintTask) => {
      if (searchQuery.trim() && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (statusFilter.length && !statusFilter.includes(t.statusId ?? "")) return false;
      if (priorityFilter.length && !priorityFilter.includes(t.priority ?? "NONE")) return false;
      if (assigneeFilter.length) {
        const hasUnassigned = assigneeFilter.includes("unassigned");
        const userIds = assigneeFilter.filter((a) => a !== "unassigned");
        const assigneeIds = t.assignees.map((a) => a.userId);
        const matchUnassigned = hasUnassigned && assigneeIds.length === 0;
        const matchUser = userIds.length > 0 && assigneeIds.some((id) => userIds.includes(id));
        if (!matchUnassigned && !matchUser) return false;
      }
      return true;
    },
    [searchQuery, statusFilter, priorityFilter, assigneeFilter],
  );

  const filteredTasks = React.useMemo(
    () => tasks.filter(matchesFilters),
    [tasks, matchesFilters],
  );

  const effectiveStatuses = React.useMemo(() => {
    if (statuses.length > 0) return statuses;
    if (fetchedStatuses.length > 0) return fetchedStatuses;
    const seen = new Set<string>();
    const derived: Status[] = [];
    for (const t of tasks) {
      if (t.statusId && !seen.has(t.statusId)) {
        seen.add(t.statusId);
        derived.push({
          id: t.statusId,
          name: t.statusName ?? t.statusId,
          color: t.statusColor ?? "#94a3b8",
          type: (t.statusType ?? "OPEN") as "OPEN" | "ACTIVE" | "CLOSED",
          orderIndex: derived.length,
        });
      }
    }
    return derived;
  }, [statuses, fetchedStatuses, tasks]);

  const noStatusListTasks = React.useMemo(() => {
    const knownIds = new Set(effectiveStatuses.map((s) => s.id));
    return filteredTasks.filter((t) => !t.statusId || !knownIds.has(t.statusId));
  }, [effectiveStatuses, filteredTasks]);

  // ── Board grouping ────────────────────────────────────────────────────────
  const boardTasksByStatus = React.useMemo(() => {
    const map = new Map<string, SprintTask[]>();
    for (const s of effectiveStatuses) map.set(s.id, []);
    for (const t of boardTasks) {
      if (!matchesFilters(t)) continue;
      if (t.statusId && map.has(t.statusId)) map.get(t.statusId)!.push(t);
    }
    return map;
  }, [boardTasks, effectiveStatuses, matchesFilters]);

  const noStatusBoardTasks = React.useMemo(
    () => boardTasks.filter((t) => !t.statusId && matchesFilters(t)),
    [boardTasks, matchesFilters],
  );

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
      <CreateTaskModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        spaceId={spaceId}
        listId={createListId || listId || ""}
        statuses={effectiveStatuses}
        canManage={canEdit || isAdmin}
        onCreated={async (taskId) => {
          if (sprintInfo?.id) {
            await addTaskToSprint(workspaceId, spaceId, sprintInfo.id, taskId);
          }
          void fetchData();
        }}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden">
            {(["list", "board"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer select-none",
                  view === v ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-accent/50",
                )}
              >
                {v === "list" ? <RowsIcon className="size-3.5" /> : <SquaresFourIcon className="size-3.5" />}
                {v === "list" ? "List" : "Board"}
              </button>
            ))}
          </div>

          {/* Search */}
          <SearchInput
            placeholder="Search tasks…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery("")}
            className="w-44 focus:w-56"
          />

          {/* Filter Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 h-8 rounded-lg border border-border px-3 text-xs font-semibold text-foreground/70 hover:bg-accent/50 transition-colors cursor-pointer select-none">
                <FunnelIcon className="size-3.5 text-muted-foreground" />
                Filters
                {hasActiveFilters && (
                  <span className="ml-1 size-2 rounded-full bg-primary" />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3 space-y-4">
              {/* Status filter */}
              <div>
                <p className="mb-1.5 text-2xs font-bold text-muted-foreground uppercase tracking-wide">Status</p>
                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                  {effectiveStatuses.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-xs text-foreground/80 cursor-pointer py-0.5 hover:bg-accent/50 rounded">
                      <input
                        type="checkbox"
                        checked={statusFilter.includes(s.id)}
                        onChange={(e) => {
                          setStatusFilter((prev) => e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id));
                        }}
                        className="rounded border-input text-primary focus:ring-primary size-3.5"
                      />
                      <span className="truncate">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Priority filter */}
              <div>
                <p className="mb-1.5 text-2xs font-bold text-muted-foreground uppercase tracking-wide">Priority</p>
                <div className="flex flex-col gap-1">
                  {["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"].map((p) => (
                    <label key={p} className="flex items-center gap-2 text-xs text-foreground/80 cursor-pointer py-0.5 hover:bg-accent/50 rounded">
                      <input
                        type="checkbox"
                        checked={priorityFilter.includes(p)}
                        onChange={(e) => {
                          setPriorityFilter((prev) => e.target.checked ? [...prev, p] : prev.filter((v) => v !== p));
                        }}
                        className="rounded border-input text-primary focus:ring-primary size-3.5"
                      />
                      <span>{p === "NONE" ? "No Priority" : p.charAt(0) + p.slice(1).toLowerCase()}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Assignee filter */}
              {members.length > 0 && (
                <div>
                  <p className="mb-1.5 text-2xs font-bold text-muted-foreground uppercase tracking-wide">Assignee</p>
                  <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                    <label className="flex items-center gap-2 text-xs text-foreground/80 cursor-pointer py-0.5 hover:bg-accent/50 rounded">
                      <input
                        type="checkbox"
                        checked={assigneeFilter.includes("unassigned")}
                        onChange={(e) => {
                          setAssigneeFilter((prev) => e.target.checked ? [...prev, "unassigned"] : prev.filter((v) => v !== "unassigned"));
                        }}
                        className="rounded border-input text-primary focus:ring-primary size-3.5"
                      />
                      <span>Unassigned</span>
                    </label>
                    {members.map((m) => (
                      <label key={m.userId} className="flex items-center gap-2 text-xs text-foreground/80 cursor-pointer py-0.5 hover:bg-accent/50 rounded">
                        <input
                          type="checkbox"
                          checked={assigneeFilter.includes(m.userId)}
                          onChange={(e) => {
                            setAssigneeFilter((prev) => e.target.checked ? [...prev, m.userId] : prev.filter((id) => id !== m.userId));
                          }}
                          className="rounded border-input text-primary focus:ring-primary size-3.5"
                        />
                        <span className="truncate">{m.name || m.email}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Archived tasks */}
              <div className="border-t border-border pt-3">
                <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer py-0.5 hover:bg-accent/30 rounded">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={() => void handleToggleArchived()}
                    className="rounded border-input text-primary focus:ring-primary size-3.5"
                  />
                  <span>Show archived tasks</span>
                </label>
              </div>

              {/* Clear all */}
              <button
                onClick={() => { setPriorityFilter([]); setAssigneeFilter([]); setStatusFilter([]); }}
                className="w-full py-1 text-center text-red-500 hover:bg-red-50 rounded text-xs font-semibold transition-colors cursor-pointer"
              >
                Clear Filters
              </button>
            </PopoverContent>
          </Popover>
        </div>

        {/* Create Task button */}
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/95 transition-all shadow-sm shrink-0 cursor-pointer select-none"
        >
          <PlusIcon className="size-3.5" weight="bold" />
          Create Task
        </button>
      </div>

      {view === "list" ? (
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
              <DndContext
                id="sprint-list-dnd"
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onDragCancel={onDragCancel}
              >
                {effectiveStatuses.map((status, i) => (
                  <React.Fragment key={status.id}>
                    {i > 0 && <div className="h-2" />}
                    <StatusGroup
                      status={status}
                      tasks={boardTasksByStatus.get(status.id) ?? []}
                      workspaceId={workspaceId}
                      spaceId={spaceId}
                      listId={listId}
                      sprintId={sprintInfo.id}
                      statuses={effectiveStatuses}
                      isAdmin={isAdmin}
                      canEdit={canEdit}
                      selectedIds={selectedIds}
                      onSelect={handleSelect}
                      onRefresh={fetchData}
                    />
                  </React.Fragment>
                ))}
              </DndContext>
              {noStatusListTasks.length > 0 && (
                <div>
                  {effectiveStatuses.length > 0 && <div className="h-2" />}
                  <div className="border-b border-border px-3 py-1.5 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider border bg-muted text-muted-foreground border-border">
                      <span className="size-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                      No Status
                    </span>
                    <span className="text-xs text-muted-foreground font-semibold tabular-nums">
                      {noStatusListTasks.length} {noStatusListTasks.length === 1 ? "task" : "tasks"}
                    </span>
                  </div>
                  {noStatusListTasks.map((t) => (
                    <TaskListRow
                      key={t.id}
                      task={t}
                      statusColor="#94a3b8"
                      workspaceId={workspaceId}
                      spaceId={spaceId}
                      excludeSprintId={sprintInfo.id}
                      statuses={effectiveStatuses}
                      isAdmin={isAdmin}
                      canEdit={canEdit}
                      selected={selectedIds.has(t.id)}
                      onSelect={handleSelect}
                      onOpen={() => router.push(`/${workspaceId}/task/${t.id}?from=sprint&sid=${sprintInfo.id}`)}
                      onRefresh={fetchData}
                      onAfterDuplicate={async (newTaskId) => {
                        await addTaskToSprint(workspaceId, spaceId, sprintInfo.id, newTaskId);
                      }}
                      onMoveToBacklog={async () => {
                        const res = await bulkRemoveTasksFromSprint(workspaceId, spaceId, sprintInfo.id, [t.id]);
                        if ("error" in res) { toast.error(res.error); return; }
                        fetchData();
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Archived tasks section */}
              {showArchived && (
                <div className="mt-6 border border-border rounded-xl overflow-hidden bg-muted/20">
                  <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 text-xs font-bold text-muted-foreground uppercase tracking-wide border-b border-border select-none">
                    <ArchiveIcon className="size-4" />
                    Archived ({archivedTasks.length})
                  </div>
                  {archivedTasks.length === 0 && (
                    <div className="px-4 py-6 text-center text-xs text-muted-foreground italic">
                      {archivedLoading ? "Loading archived tasks…" : "No archived tasks"}
                    </div>
                  )}
                  <div className="divide-y divide-border">
                    {archivedTasks.map((t) => (
                      <div
                        key={t.id}
                        className="group flex items-center gap-3 px-4 py-2 hover:bg-accent/30 transition-colors"
                      >
                        <span className="text-2xs text-muted-foreground font-mono shrink-0 select-none">#{t.seqNumber}</span>
                        <span className="flex-1 text-[13px] text-muted-foreground font-medium line-through truncate">{t.title}</span>
                        {canEdit && (
                          <button
                            onClick={async () => {
                              await unarchiveTask(workspaceId, spaceId, t.listId, t.id);
                              await Promise.all([refreshArchived(), fetchData()]);
                              toastWithUndo("Task unarchived", async () => {
                                await archiveTask(workspaceId, spaceId, t.listId, t.id);
                                await Promise.all([refreshArchived(), fetchData()]);
                              });
                            }}
                            className="hidden group-hover:flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-2xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
                          >
                            <ArchiveIcon className="size-3.5 text-muted-foreground" />
                            Unarchive
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <DndContext
          id="sprint-board-dnd"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          {/* Sprint header row */}
          <div className="flex items-center gap-2 mb-3 px-1">
            <LightningIcon className="size-3.5 text-primary" weight="fill" />
            <span className="text-sm font-semibold">{sprintInfo.name}</span>
            <span className="text-xs text-muted-foreground">({formatDateRange(sprintInfo.startDate, sprintInfo.endDate)})</span>
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 text-xs px-2 py-1 rounded uppercase tracking-wide",
                sprintInfo.status === "ACTIVE" && "border-primary/30 text-primary bg-primary/10",
              )}
            >
              {sprintInfo.status}
            </Badge>
          </div>

          {/* Columns */}
          <div className="flex gap-3 overflow-x-auto pb-4 items-start">
            {effectiveStatuses.map((status) => (
              <SprintBoardColumn
                key={status.id}
                status={status}
                tasks={boardTasksByStatus.get(status.id) ?? []}
                workspaceId={workspaceId}
                sprintId={sprintInfo.id}
              />
            ))}
            {noStatusBoardTasks.length > 0 && (
              <NoStatusColumn tasks={noStatusBoardTasks} workspaceId={workspaceId} sprintId={sprintInfo.id} />
            )}
          </div>

          <DragOverlay>
            {activeDragTask && (
              <SprintBoardCardContent task={activeDragTask} workspaceId={workspaceId} sprintId={sprintInfo.id} overlay />
            )}
          </DragOverlay>
        </DndContext>
      )}

      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          selectedIds={selectedIds}
          statuses={effectiveStatuses}
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
