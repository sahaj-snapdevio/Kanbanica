"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  DotsThreeIcon,
  LightningIcon,
  PencilSimpleIcon,
  PlusIcon,
  PushPinIcon,
  TrashIcon,
  XIcon,
  ArrowsDownUpIcon,
  GearIcon,
  FunnelIcon,
} from "@phosphor-icons/react";
import { SearchInput } from "@/components/ui/search-input";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import {
  bulkArchiveTasks,
  bulkDeleteTasks,
  bulkMoveTasks,
  bulkUpdateStatus,
  createTask,
  reorderTasksInStatus,
  unarchiveTask,
  updateTask,
  updateTaskStatus,
} from "@/app/actions/task";
import { addAssignee, removeAssignee } from "@/app/actions/task-assignee";
import { getSprints, bulkMoveTasksToSprint } from "@/app/actions/sprint";
import { createListStatus, getWorkspaceLists, updateListStatus } from "@/app/actions/list";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CreateTaskModal } from "@/components/task/create-task-modal";
import { cn } from "@/lib/utils";

// drag and drop
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragOverEvent,
  type DragEndEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TaskListRow, type TaskListRowProps } from "@/components/task/task-list-row";

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
  statusId: string | null;
  seqNumber: number;
  orderIndex: number;
  dueDateStart: Date | null;
  dueDateEnd: Date | null;
  isPinnedToList: boolean;
  pinnedToListOrder: number | null;
  tags: { id: string; name: string; color: string }[];
  assignees: { userId: string; name: string; image: string | null }[];
}

interface ListViewProps {
  workspaceId: string;
  spaceId: string;
  listId: string;
  statuses: Status[];
  tasks: Task[];
  pinnedTasks?: Task[];
  isAdmin?: boolean;
  canEdit?: boolean;
  canPinToList?: boolean;
  currentUserId?: string;
  personallyPinnedIds?: Set<string>;
  members?: { userId: string; name: string | null; email: string | null; image?: string | null }[];
  tags?: { id: string; name: string; color: string }[];
  archivedTasks?: { id: string; title: string; seqNumber: number }[];
  onArchivedChanged?: () => Promise<void>;
}

type SprintOption = { id: string; name: string; status: "PLANNED" | "ACTIVE" | "CLOSED" };

// --- Sortable wrapper (DnD) -------------------------------------------------

function SortableTaskRow(props: Omit<TaskListRowProps, "dragRef" | "dragStyle" | "dragProps" | "isDragging">) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: { type: "task", statusId: props.task.statusId },
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

// ─── Pinned section ───────────────────────────────────────────────────────────

function PinnedSection({
  tasks,
  workspaceId,
  spaceId,
  listId,
  statuses,
  canPinToList,
  isAdmin,
  canEdit,
  personallyPinnedIds,
}: {
  tasks: Task[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  statuses: Status[];
  canPinToList?: boolean;
  isAdmin?: boolean;
  canEdit?: boolean;
  personallyPinnedIds?: Set<string>;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);

  if (tasks.length === 0) return null;

  return (
    <div className="flex flex-col border border-primary/20 rounded-xl overflow-hidden bg-primary/2 mb-2">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-primary/5 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        <div className="flex size-5 items-center justify-center rounded text-primary/70">
          {collapsed ? (
            <CaretRightIcon weight="fill" className="size-3" />
          ) : (
            <CaretDownIcon weight="fill" className="size-3" />
          )}
        </div>
        <PushPinIcon className="size-3.5 text-primary" weight="fill" />
        <span className="text-2xs font-bold uppercase tracking-wider text-primary">
          Pinned
        </span>
        <span className="text-xs text-primary/60 font-semibold tabular-nums">
          {tasks.length}
        </span>
      </div>

      {!collapsed && (
        <div className="flex flex-col border-t border-primary/15">
          {tasks.map((t) => {
            const statusColor = statuses.find((s) => s.id === t.statusId)?.color ?? "#6B7280";
            return (
              <TaskListRow
                key={t.id}
                task={t}
                statusColor={statusColor}
                workspaceId={workspaceId}
                spaceId={spaceId}
                listId={listId}
                isAdmin={isAdmin}
                canEdit={canEdit}
                canPinToList={canPinToList}
                isPersonallyPinned={personallyPinnedIds?.has(t.id)}
                selected={false}
                onSelect={() => {}}
                onOpen={() => router.push(`/${workspaceId}/task/${t.id}`)}
                onRefresh={() => router.refresh()}
                statuses={statuses}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Status group ─────────────────────────────────────────────────────────────

const STATUS_PRESET_COLORS = [
  "#6B7280", "#3B82F6", "#10B981", "#F59E0B",
  "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4",
  "#F97316", "#84CC16",
];

function QuickCreateRow({
  open,
  onOpenChange,
  workspaceId,
  spaceId,
  listId,
  statusId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  spaceId: string;
  listId: string;
  statusId: string;
}) {
  const router = useRouter();
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
      setTitle("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => onOpenChange(true)}
        className="flex w-full items-center gap-1.5 pl-16 pr-4 py-2 text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-accent/30 transition-colors border-b border-border bg-card cursor-pointer select-none text-left"
      >
        <PlusIcon className="size-3.5 shrink-0" />
        Add Task
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 pl-16 pr-4 py-2 border-b border-border bg-card">
      <input
        ref={inputRef}
        type="text"
        placeholder="Task name"
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
        className="text-xs font-semibold text-primary hover:text-primary/80 disabled:opacity-40 shrink-0"
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
  );
}

function StatusGroup({
  status,
  tasks,
  workspaceId,
  spaceId,
  listId,
  isAdmin,
  canEdit,
  canPinToList,
  personallyPinnedIds,
  selectedIds,
  onSelect,
  statuses,
}: {
  status: Status;
  tasks: Task[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
  canEdit?: boolean;
  canPinToList?: boolean;
  personallyPinnedIds?: Set<string>;
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  statuses: Status[];
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [newStatusOpen, setNewStatusOpen] = React.useState(false);
  const [renameName, setRenameName] = React.useState(status.name);
  const [newStatusName, setNewStatusName] = React.useState("");
  const [newStatusColor, setNewStatusColor] = React.useState("#6B7280");
  const [saving, setSaving] = React.useState(false);

  const { setNodeRef, isOver } = useDroppable({ id: status.id });

  async function handleRename() {
    const trimmed = renameName.trim();
    if (!trimmed || trimmed === status.name) { setRenameOpen(false); return; }
    setSaving(true);
    const res = await updateListStatus(workspaceId, spaceId, listId, status.id, { name: trimmed });
    setSaving(false);
    if ("error" in res) { toast.error(res.error); return; }
    setRenameOpen(false);
    router.refresh();
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
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-col">
        {/* Status Group Header */}
        <div
          onClick={() => setCollapsed(!collapsed)}
          className="group/header flex items-center gap-2.5 py-1.5 px-3 hover:bg-accent/30 transition-colors cursor-pointer select-none border-b border-border"
        >
          {/* Arrow */}
          <div className="flex size-5 items-center justify-center rounded hover:bg-accent transition-colors shrink-0 text-muted-foreground group-hover/header:text-foreground">
            {collapsed ? (
              <CaretRightIcon weight="fill" className="size-3" />
            ) : (
              <CaretDownIcon weight="fill" className="size-3" />
            )}
          </div>

          {/* Pill Badge */}
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-2xs font-bold uppercase tracking-wider border transition-all"
            style={{
              backgroundColor: `${status.color}12`,
              color: status.color,
              borderColor: `${status.color}25`
            }}
          >
            <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: status.color }} />
            {status.name}
          </span>

          {/* Task count */}
          <span className="text-xs text-gray-400 font-semibold tabular-nums">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </span>

          {/* Settings Menu Icon */}
          <div className="ml-2 flex items-center gap-1 opacity-0 group-hover/header:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <button className="flex size-6 items-center justify-center rounded hover:bg-accent transition-colors cursor-pointer">
                  <DotsThreeIcon className="size-4.5 text-muted-foreground" weight="bold" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" side="bottom" className="w-48 p-1 mt-1">
                <p className="px-2 py-1 text-2xs font-bold text-muted-foreground uppercase tracking-wide">Group Options</p>
                <button
                  onClick={() => { setMenuOpen(false); setRenameName(status.name); setRenameOpen(true); }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent cursor-pointer text-left"
                >
                  <PencilSimpleIcon className="size-3.5 text-muted-foreground shrink-0" />
                  Rename Status
                </button>
                <button
                  onClick={() => { setMenuOpen(false); setNewStatusOpen(true); }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent cursor-pointer text-left"
                >
                  <PlusIcon className="size-3.5 text-muted-foreground shrink-0" />
                  New Status
                </button>
                <div className="h-px bg-border my-1" />
                <button
                  onClick={() => { setCollapsed((v) => !v); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent cursor-pointer text-left"
                >
                  {collapsed ? (
                    <CaretRightIcon className="size-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <CaretDownIcon className="size-3.5 text-muted-foreground shrink-0" />
                  )}
                  {collapsed ? "Expand group" : "Collapse group"}
                </button>
              </PopoverContent>
            </Popover>

            <button
              className="flex size-6 items-center justify-center rounded hover:bg-accent transition-colors cursor-pointer"
              onClick={() => setQuickCreateOpen(true)}
            >
              <PlusIcon className="size-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Tasks Container */}
        {!collapsed && (
          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {/* Column Header (Desktop Only) */}
            <div className="hidden md:flex items-center border-b border-border text-2xs font-bold text-gray-400 select-none uppercase tracking-wider bg-card">
              <div className="w-0.75 self-stretch shrink-0 bg-transparent" />
              <div className="flex items-center pl-2 shrink-0 w-14" />
              <div className="flex-1 py-2 pr-4 pl-1">Name</div>
              <div className="w-36 shrink-0 py-2 px-4">Assignee</div>
              <div className="w-28 shrink-0 py-2 px-4">Due Date</div>
              <div className="w-32 shrink-0 py-2 px-4">Priority</div>
              <div className="w-48 shrink-0 text-right pr-4">Actions</div>
            </div>
            <div
              ref={setNodeRef}
              className={cn(
                "flex flex-col transition-all min-h-1",
                isOver && "bg-accent/20 border-y border-dashed border-border"
              )}
            >
              {tasks.length === 0 ? (
                <div className="py-3 pl-16 text-xs text-muted-foreground italic bg-card border-b border-border/50 select-none">
                  No tasks in status
                </div>
              ) : (
                tasks.map((task) => (
                  <SortableTaskRow
                    key={task.id}
                    task={task}
                    statusColor={status.color}
                    workspaceId={workspaceId}
                    spaceId={spaceId}
                    listId={listId}
                    isAdmin={isAdmin}
                    canEdit={canEdit}
                    canPinToList={canPinToList}
                    isPersonallyPinned={personallyPinnedIds?.has(task.id)}
                    selected={selectedIds.has(task.id)}
                    onSelect={onSelect}
                    onOpen={() => router.push(`/${workspaceId}/task/${task.id}`)}
                    onRefresh={() => router.refresh()}
                    statuses={statuses}
                  />
                ))
              )}

              <QuickCreateRow
                open={quickCreateOpen}
                onOpenChange={setQuickCreateOpen}
                workspaceId={workspaceId}
                spaceId={spaceId}
                listId={listId}
                statusId={status.id}
              />
            </div>
          </SortableContext>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-foreground">Rename Status</DialogTitle>
          </DialogHeader>
          <Input
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleRename(); }}
            autoFocus
            className="h-9 text-xs"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setRenameOpen(false)} className="h-8 text-xs font-semibold">Cancel</Button>
            <Button onClick={() => void handleRename()} disabled={saving || !renameName.trim()} className="h-8 text-xs font-bold">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New status dialog */}
      <Dialog open={newStatusOpen} onOpenChange={setNewStatusOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-foreground">New Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Status name"
              value={newStatusName}
              onChange={(e) => setNewStatusName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreateStatus(); }}
              autoFocus
              className="h-9 text-xs"
            />
            <div className="flex flex-wrap gap-2">
              {STATUS_PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setNewStatusColor(color)}
                  className={cn(
                    "size-6 rounded-full border-2 transition-transform cursor-pointer",
                    newStatusColor === color ? "border-gray-800 scale-110" : "border-transparent",
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setNewStatusOpen(false)} className="h-8 text-xs font-semibold">Cancel</Button>
            <Button onClick={() => void handleCreateStatus()} disabled={saving || !newStatusName.trim()} className="h-8 text-xs font-bold">
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
  isAdmin,
  canEdit,
  onClear,
}: {
  count: number;
  selectedIds: Set<string>;
  statuses: Status[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
  canEdit?: boolean;
  onClear: () => void;
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
    setSprints(res.sprints.filter((s) => s.status !== "CLOSED"));
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
  }

  async function handleBulkArchive() {
    setBusy(true);
    const res = await bulkArchiveTasks(workspaceId, spaceId, listId, [...selectedIds]);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Archived ${count} task${count > 1 ? "s" : ""}`);
    onClear();
  }

  async function confirmBulkDelete() {
    setDeleteOpen(false);
    setBusy(true);
    const res = await bulkDeleteTasks(workspaceId, spaceId, listId, [...selectedIds]);
    setBusy(false);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Deleted ${count} task${count > 1 ? "s" : ""}`);
    onClear();
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
      {/* Count + clear */}
      <span className="font-semibold text-white pr-2 border-r border-white/20 mr-2 select-none">
        {count} task{count > 1 ? "s" : ""} selected
      </span>
      <button
        onClick={onClear}
        className="flex size-6 items-center justify-center rounded hover:bg-white/10 transition-colors mr-2 cursor-pointer"
      >
        <XIcon className="size-3.5 text-white/70" />
      </button>

      {/* Status */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
          >
            <span className="size-2 rounded-full bg-white/60" />
            Status
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" side="top" className="w-48 p-1 mb-1 bg-neutral-800 border border-neutral-700 text-white">
          {statuses.map((s) => (
            <button
              key={s.id}
              onClick={() => handleBulkStatus(s.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-white/10 text-white text-left cursor-pointer"
            >
              <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="truncate">{s.name}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {/* Move (Sprint + List) */}
      <Popover onOpenChange={(open) => { if (open) { void loadSprints(); void loadLists(); } }}>
        <PopoverTrigger asChild>
          <button
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
          >
            <CaretDownIcon className="size-3.5" />
            Move
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" side="top" className="w-56 p-1 mb-1 max-h-72 overflow-y-auto bg-neutral-800 border border-neutral-700 text-white">
          {/* Sprint section */}
          <p className="px-2 py-1 text-2xs font-bold text-gray-400 uppercase tracking-wide">Sprint</p>
          {loadingSprints && <p className="px-2 py-1.5 text-xs text-gray-400">Loading…</p>}
          {!loadingSprints && sprints?.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-gray-400">No active sprints</p>
          )}
          {!loadingSprints && sprints?.map((s) => (
            <button
              key={s.id}
              onClick={() => handleMoveToSprint(s.id, s.name)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-white/10 text-white text-left cursor-pointer"
            >
              <LightningIcon
                className={cn("size-3.5 shrink-0", s.status === "ACTIVE" ? "text-primary" : "text-gray-400")}
                weight="fill"
              />
              <span className="flex-1 text-left truncate">{s.name}</span>
              <span className={cn(
                "text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0",
                s.status === "ACTIVE" ? "bg-primary/20 text-primary-foreground" : "bg-neutral-700 text-gray-300",
              )}>
                {s.status === "ACTIVE" ? "Active" : "Planned"}
              </span>
            </button>
          ))}

          {/* Divider */}
          <div className="h-px bg-neutral-700 my-1" />

          {/* List section */}
          <p className="px-2 py-1 text-2xs font-bold text-gray-400 uppercase tracking-wide">List</p>
          {loadingLists && <p className="px-2 py-1.5 text-xs text-gray-400">Loading…</p>}
          {!loadingLists && listSpaces?.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-gray-400">No other lists available</p>
          )}
          {!loadingLists && listSpaces?.map((sp) => (
            <div key={sp.id}>
              <p className="flex items-center gap-1.5 px-2 py-1 text-2xs font-bold text-gray-400 uppercase">
                <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: sp.color ?? "#6B7280" }} />
                {sp.name}
              </p>
              {sp.lists.map((l) => (
                <button
                  key={l.id}
                  onClick={() => handleMoveToList(l.id, l.name)}
                  className="flex w-full items-center gap-2 rounded pl-5 pr-2 py-1.5 text-xs font-semibold hover:bg-white/10 text-white text-left cursor-pointer"
                >
                  <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: l.color ?? "#6B7280" }} />
                  <span className="flex-1 text-left truncate">{l.name}</span>
                </button>
              ))}
            </div>
          ))}
        </PopoverContent>
      </Popover>

      <div className="h-4 w-px bg-white/20 mx-1" />

      {/* Archive — requires edit permission */}
      {canEdit && (
        <button
          disabled={busy}
          onClick={handleBulkArchive}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50"
        >
          <ArchiveIcon className="size-3.5" />
          Archive
        </button>
      )}

      {/* Delete — admin only */}
      {isAdmin && (
        <button
          disabled={busy}
          onClick={() => setDeleteOpen(true)}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <TrashIcon className="size-3.5" />
          Delete
        </button>
      )}
    </div>
    </>
  );
}

// ─── Main ListView Component ──────────────────────────────────────────────────

export function ListView({
  workspaceId,
  spaceId,
  listId,
  statuses,
  tasks,
  pinnedTasks = [],
  isAdmin,
  canEdit,
  canPinToList,
  currentUserId,
  personallyPinnedIds,
  members = [],
  tags = [],
  archivedTasks,
  onArchivedChanged,
}: ListViewProps) {
  const router = useRouter();
  const [createForStatusId, setCreateForStatusId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  // Local state for Search, Sort, Filter, and Group By inside the Workspace Container
  const [searchQuery, setSearchQuery] = React.useState("");
  const [sortBy, setSortBy] = React.useState<"name" | "due" | "priority" | null>(null);
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("asc");
  const [groupBy, setGroupBy] = React.useState<"status" | "priority" | "assignee">("status");
  
  const [priorityFilter, setPriorityFilter] = React.useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = React.useState<string[]>([]);
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);

  // Optimistic DND tasks
  const [localTasks, setLocalTasks] = React.useState<Task[]>(tasks);

  React.useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function handleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  // ─── Local Filtering & Sorting ─────────────────────────────────────────────
  const processedTasks = React.useMemo(() => {
    let list = [...localTasks];

    // Search query
    if (searchQuery.trim()) {
      list = list.filter((t) => t.title.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    // Priority filter
    if (priorityFilter.length > 0) {
      list = list.filter((t) => priorityFilter.includes(t.priority));
    }

    // Assignee filter
    if (assigneeFilter.length > 0) {
      list = list.filter((t) => {
        const hasUnassigned = assigneeFilter.includes("unassigned");
        const userIds = assigneeFilter.filter((id) => id !== "unassigned");
        const hasNoAssignees = t.assignees.length === 0;
        if (hasUnassigned && hasNoAssignees) return true;
        return t.assignees.some((a) => userIds.includes(a.userId));
      });
    }

    // Status filter
    if (statusFilter.length > 0) {
      list = list.filter((t) => statusFilter.includes(t.statusId ?? ""));
    }

    // Sort
    if (sortBy) {
      list.sort((a, b) => {
        let cmp = 0;
        if (sortBy === "name") {
          cmp = a.title.localeCompare(b.title);
        } else if (sortBy === "due") {
          const tA = a.dueDateStart ? new Date(a.dueDateStart).getTime() : 0;
          const tB = b.dueDateStart ? new Date(b.dueDateStart).getTime() : 0;
          cmp = tA - tB;
        } else if (sortBy === "priority") {
          const weight = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 };
          cmp = weight[a.priority] - weight[b.priority];
        }
        return sortOrder === "asc" ? cmp : -cmp;
      });
    }

    return list;
  }, [localTasks, searchQuery, priorityFilter, assigneeFilter, statusFilter, sortBy, sortOrder]);

  // ─── Group By logic ────────────────────────────────────────────────────────
  const groupedGroups = React.useMemo(() => {
    if (groupBy === "status") {
      return statuses.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        tasks: processedTasks.filter((t) => t.statusId === s.id),
      }));
    } else if (groupBy === "priority") {
      const priorities: Task["priority"][] = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];
      const priorityColors = { URGENT: "#EF4444", HIGH: "#F97316", MEDIUM: "#F59E0B", LOW: "#9CA3AF", NONE: "#6B7280" };
      return priorities.map((p) => ({
        id: p,
        name: p === "NONE" ? "NO PRIORITY" : p,
        color: priorityColors[p],
        tasks: processedTasks.filter((t) => t.priority === p),
      }));
    } else if (groupBy === "assignee") {
      const resolvedMembers = members.length > 0 ? members : (() => {
        const unique = new Map<string, { userId: string; name: string; image: string | null }>();
        for (const t of tasks) {
          for (const a of t.assignees) {
            unique.set(a.userId, a);
          }
        }
        return Array.from(unique.values()).map(a => ({ userId: a.userId, name: a.name, email: null }));
      })();

      const groups = resolvedMembers.map((m) => ({
        id: m.userId,
        name: m.name || m.email || "Unknown Member",
        color: "#8B5CF6",
        tasks: processedTasks.filter((t) => t.assignees.some((a) => a.userId === m.userId)),
      }));

      // Add unassigned group
      groups.push({
        id: "unassigned",
        name: "UNASSIGNED",
        color: "#6B7280",
        tasks: processedTasks.filter((t) => t.assignees.length === 0),
      });

      return groups;
    }
    return [];
  }, [processedTasks, groupBy, statuses, members, tasks]);

  // Global Checkbox toggles
  const allSelected = processedTasks.length > 0 && processedTasks.every((t) => selectedIds.has(t.id));
  const someSelected = processedTasks.some((t) => selectedIds.has(t.id));

  function toggleAll() {
    if (allSelected) {
      processedTasks.forEach((t) => handleSelect(t.id, false));
    } else {
      processedTasks.forEach((t) => handleSelect(t.id, true));
    }
  }

  // ─── Drag & Drop Event Handlers ────────────────────────────────────────────
  function findGroupForTask(taskId: string) {
    const t = localTasks.find((tk) => tk.id === taskId);
    if (!t) return null;
    if (groupBy === "status") return t.statusId;
    if (groupBy === "priority") return t.priority;
    if (groupBy === "assignee") return t.assignees[0]?.userId || "unassigned";
    return null;
  }


  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeGroup = findGroupForTask(activeId);

    // over could be a status/group ID or a task ID
    let overGroup = overId;
    const isGroup = statuses.some(s => s.id === overId) ||
                    ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE", "NO PRIORITY"].includes(overId) ||
                    members.some(m => m.userId === overId) ||
                    overId === "unassigned";

    if (!isGroup) {
      overGroup = findGroupForTask(overId) || "";
    }

    if (!activeGroup || !overGroup || activeGroup === overGroup) return;

    // Optimistically update
    setLocalTasks((prev) =>
      prev.map((t) => {
        if (t.id === activeId) {
          if (groupBy === "status") {
            return { ...t, statusId: overGroup };
          }
          if (groupBy === "priority") {
            const cleanPriority = overGroup === "NO PRIORITY" ? "NONE" : overGroup as Task["priority"];
            return { ...t, priority: cleanPriority };
          }
          if (groupBy === "assignee") {
            if (overGroup === "unassigned") {
              return { ...t, assignees: [] };
            }
            const matchingMember = members.find(m => m.userId === overGroup);
            if (matchingMember) {
              return { ...t, assignees: [{ userId: matchingMember.userId, name: matchingMember.name || "Member", image: null }] };
            }
          }
        }
        return t;
      })
    );
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    let newGroup = overId;
    const isGroup = statuses.some(s => s.id === overId) ||
                    ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE", "NO PRIORITY"].includes(overId) ||
                    members.some(m => m.userId === overId) ||
                    overId === "unassigned";

    if (!isGroup) {
      newGroup = findGroupForTask(overId) || "";
    }

    const origTask = tasks.find(t => t.id === activeId);
    if (!origTask) return;

    if (groupBy === "status") {
      if (newGroup === origTask.statusId) {
        // Within-group reorder
        const groupTasks = localTasks.filter((t) => t.statusId === origTask.statusId);
        const oldIndex = groupTasks.findIndex((t) => t.id === activeId);
        const newIndex = groupTasks.findIndex((t) => t.id === overId);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
        const reordered = arrayMove(groupTasks, oldIndex, newIndex);
        setLocalTasks((prev) => [
          ...prev.filter((t) => t.statusId !== origTask.statusId),
          ...reordered,
        ]);
        const res = await reorderTasksInStatus(workspaceId, spaceId, listId, reordered.map((t) => t.id));
        if ("error" in res) { setLocalTasks(tasks); toast.error(res.error); }
        return;
      }
      const res = await updateTaskStatus(workspaceId, spaceId, listId, activeId, newGroup);
      if ("error" in res) setLocalTasks(tasks);
    } else if (groupBy === "priority") {
      const cleanPriority = newGroup === "NO PRIORITY" ? "NONE" : newGroup as Task["priority"];
      if (cleanPriority === origTask.priority) return;
      const res = await updateTask(workspaceId, spaceId, listId, activeId, { priority: cleanPriority });
      if ("error" in res) setLocalTasks(tasks);
    } else if (groupBy === "assignee") {
      const prevAssigneeIds = origTask.assignees.map(a => a.userId);
      const isUnassigned = newGroup === "unassigned";
      
      if (!isUnassigned && prevAssigneeIds.length === 1 && prevAssigneeIds[0] === newGroup) return;

      for (const oldId of prevAssigneeIds) {
        await removeAssignee(workspaceId, spaceId, listId, activeId, oldId);
      }
      if (!isUnassigned) {
        await addAssignee(workspaceId, spaceId, listId, activeId, newGroup);
      }
      router.refresh();
    }
  }

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
        canManage={canEdit || isAdmin}
      />

      <DndContext
        id="list-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        {/* ClickUp-style unified workspace container */}
        <div className="w-full bg-card border border-border rounded-2xl p-5 shadow-[0_1px_3px_0_rgba(0,0,0,0.05)] overflow-hidden flex flex-col gap-4">

          {/* Sticky Toolbar + Table Header Section */}
          <div className="sticky top-0 z-30 bg-card pb-2 border-b border-border flex flex-col gap-3">
            {/* Action Bar / Toolbar */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
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
                    <button className="flex items-center gap-1.5 h-8 rounded-lg border border-border px-3 text-xs font-semibold text-foreground/70 hover:bg-accent/30 transition-colors cursor-pointer select-none">
                      <FunnelIcon className="size-3.5 text-gray-500" />
                      Filters
                      {(priorityFilter.length > 0 || assigneeFilter.length > 0 || statusFilter.length > 0) && (
                        <span className="ml-1 size-2 rounded-full bg-primary" />
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 p-3 space-y-4">
                    {/* Status filter */}
                    <div>
                      <p className="mb-1.5 text-2xs font-bold text-gray-400 uppercase tracking-wide">Status</p>
                      <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                        {statuses.map(s => (
                          <label key={s.id} className="flex items-center gap-2 text-xs text-foreground cursor-pointer py-0.5 hover:bg-accent/30 rounded">
                            <input
                              type="checkbox"
                              checked={statusFilter.includes(s.id)}
                              onChange={(e) => {
                                setStatusFilter(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id));
                              }}
                              className="rounded border-gray-300 text-primary focus:ring-primary size-3.5"
                            />
                            <span className="truncate">{s.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Priority filter */}
                    <div>
                      <p className="mb-1.5 text-2xs font-bold text-gray-400 uppercase tracking-wide">Priority</p>
                      <div className="flex flex-col gap-1">
                        {["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"].map(p => (
                          <label key={p} className="flex items-center gap-2 text-xs text-foreground cursor-pointer py-0.5 hover:bg-accent/30 rounded">
                            <input
                              type="checkbox"
                              checked={priorityFilter.includes(p)}
                              onChange={(e) => {
                                setPriorityFilter(prev => e.target.checked ? [...prev, p] : prev.filter(v => v !== p));
                              }}
                              className="rounded border-gray-300 text-primary focus:ring-primary size-3.5"
                            />
                            <span>{p === "NONE" ? "No Priority" : p.charAt(0) + p.slice(1).toLowerCase()}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Assignee filter */}
                    {members.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-2xs font-bold text-gray-400 uppercase tracking-wide">Assignee</p>
                        <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                          <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer py-0.5 hover:bg-accent/30 rounded">
                            <input
                              type="checkbox"
                              checked={assigneeFilter.includes("unassigned")}
                              onChange={(e) => {
                                setAssigneeFilter(prev => e.target.checked ? [...prev, "unassigned"] : prev.filter(v => v !== "unassigned"));
                              }}
                              className="rounded border-gray-300 text-primary focus:ring-primary size-3.5"
                            />
                            <span>Unassigned</span>
                          </label>
                          {members.map(m => (
                            <label key={m.userId} className="flex items-center gap-2 text-xs text-foreground cursor-pointer py-0.5 hover:bg-accent/30 rounded">
                              <input
                                type="checkbox"
                                checked={assigneeFilter.includes(m.userId)}
                                onChange={(e) => {
                                  setAssigneeFilter(prev => e.target.checked ? [...prev, m.userId] : prev.filter(id => id !== m.userId));
                                }}
                                className="rounded border-gray-300 text-primary focus:ring-primary size-3.5"
                              />
                              <span className="truncate">{m.name || m.email}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Clear all */}
                    <button
                      onClick={() => { setPriorityFilter([]); setAssigneeFilter([]); setStatusFilter([]); }}
                      className="w-full py-1 text-center text-red-500 hover:bg-red-50 rounded text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Clear Filters
                    </button>
                  </PopoverContent>
                </Popover>

                {/* Sort */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-1.5 h-8 rounded-lg border border-border px-3 text-xs font-semibold text-foreground/70 hover:bg-accent/30 transition-colors cursor-pointer select-none">
                      <ArrowsDownUpIcon className="size-3.5 text-gray-500" />
                      Sort: {sortBy ? (sortBy.charAt(0).toUpperCase() + sortBy.slice(1)) : "None"}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-44 p-1 flex flex-col gap-0.5">
                    <button onClick={() => setSortBy(null)} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-accent/30 cursor-pointer", !sortBy && "bg-accent text-foreground")}>None</button>
                    <button onClick={() => { setSortBy("name"); setSortOrder(o => o === "asc" ? "desc" : "asc"); }} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-accent/30 cursor-pointer", sortBy === "name" && "bg-accent text-foreground")}>Task Name</button>
                    <button onClick={() => { setSortBy("due"); setSortOrder(o => o === "asc" ? "desc" : "asc"); }} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-accent/30 cursor-pointer", sortBy === "due" && "bg-accent text-foreground")}>Due Date</button>
                    <button onClick={() => { setSortBy("priority"); setSortOrder(o => o === "asc" ? "desc" : "asc"); }} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-accent/30 cursor-pointer", sortBy === "priority" && "bg-accent text-foreground")}>Priority</button>
                  </PopoverContent>
                </Popover>

                {/* Group By */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-1.5 h-8 rounded-lg border border-border px-3 text-xs font-semibold text-foreground/70 hover:bg-accent/30 transition-colors cursor-pointer select-none">
                      <GearIcon className="size-3.5 text-gray-500" />
                      Group By: {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-44 p-1 flex flex-col gap-0.5">
                    <button onClick={() => setGroupBy("status")} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-accent/30 cursor-pointer", groupBy === "status" && "bg-accent text-foreground")}>Status</button>
                    <button onClick={() => setGroupBy("priority")} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-accent/30 cursor-pointer", groupBy === "priority" && "bg-accent text-foreground")}>Priority</button>
                    <button onClick={() => setGroupBy("assignee")} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-accent/30 cursor-pointer", groupBy === "assignee" && "bg-accent text-foreground")}>Assignee</button>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Right actions: Create Task button */}
              <button
                onClick={() => setCreateForStatusId(statuses[0]?.id || "")}
                className="flex items-center gap-1.5 h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/95 transition-all shadow-sm shrink-0 cursor-pointer select-none"
              >
                <PlusIcon className="size-3.5" weight="bold" />
                Create Task
              </button>
            </div>

          </div>

          {/* Pinned tasks sticky section */}
          {pinnedTasks.length > 0 && (
            <PinnedSection
              tasks={pinnedTasks}
              workspaceId={workspaceId}
              spaceId={spaceId}
              listId={listId}
              statuses={statuses}
              canPinToList={canPinToList}
              isAdmin={isAdmin}
              canEdit={canEdit}
              personallyPinnedIds={personallyPinnedIds}
            />
          )}

          {/* Group Content Container */}
          <div className="flex flex-col gap-6">
            {groupedGroups.map((group) => (
              <StatusGroup
                key={group.id}
                status={{
                  id: group.id,
                  name: group.name,
                  color: group.color,
                  type: "OPEN",
                  orderIndex: 0
                }}
                tasks={group.tasks}
                workspaceId={workspaceId}
                spaceId={spaceId}
                listId={listId}
                isAdmin={isAdmin}
                canEdit={canEdit}
                canPinToList={canPinToList}
                personallyPinnedIds={personallyPinnedIds}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                statuses={statuses}
              />
            ))}
          </div>

          {/* Archived tasks section */}
          {archivedTasks && archivedTasks.length > 0 && (
            <div className="mt-6 border border-border rounded-xl overflow-hidden bg-muted/20">
              <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 text-xs font-bold text-muted-foreground uppercase tracking-wide border-b border-border select-none">
                <ArchiveIcon className="size-4" />
                Archived ({archivedTasks.length})
              </div>
              <div className="divide-y divide-border">
                {archivedTasks.map((t) => (
                  <div
                    key={t.id}
                    className="group flex items-center gap-3 px-4 py-2 hover:bg-accent/30 transition-colors"
                  >
                    <span className="text-2xs text-muted-foreground font-mono shrink-0 select-none">#{t.seqNumber}</span>
                    <span className="flex-1 text-[13px] text-muted-foreground font-medium line-through truncate">{t.title}</span>
                    <button
                      onClick={async () => {
                        await unarchiveTask(workspaceId, spaceId, listId, t.id);
                        await onArchivedChanged?.();
                      }}
                      className="hidden group-hover:flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-2xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
                    >
                      <ArchiveIcon className="size-3.5 text-muted-foreground" />
                      Unarchive
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </DndContext>

      {/* Floating Action Button (FAB) for mobile task creation */}
      <button
        onClick={() => setCreateForStatusId(statuses[0]?.id || "")}
        className="md:hidden fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-white shadow-2xl hover:scale-105 active:scale-95 transition-all cursor-pointer"
        title="Create Task"
      >
        <PlusIcon className="size-6 font-bold" />
      </button>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          selectedIds={selectedIds}
          statuses={statuses}
          workspaceId={workspaceId}
          spaceId={spaceId}
          listId={listId}
          isAdmin={isAdmin}
          canEdit={canEdit}
          onClear={() => setSelectedIds(new Set())}
        />
      )}
    </>
  );
}
