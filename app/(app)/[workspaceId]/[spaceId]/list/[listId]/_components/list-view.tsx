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
  TrashIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import {
  archiveTask,
  bulkArchiveTasks,
  bulkDeleteTasks,
  bulkMoveTasks,
  bulkUpdateStatus,
  deleteTask,
  duplicateTask,
  getWorkspaceMembers,
  updateTask,
} from "@/app/actions/task";
import { addAssignee, removeAssignee } from "@/app/actions/task-assignee";
import { getSprints, bulkMoveTasksToSprint } from "@/app/actions/sprint";
import { createListStatus, getWorkspaceLists, updateListStatus } from "@/app/actions/list";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CreateTaskModal } from "@/components/task/create-task-modal";
import { cn } from "@/lib/utils";
import { addDays, format, isToday, isPast } from "date-fns";

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

type WorkspaceMember = { userId: string | null; name: string | null; email: string | null; image: string | null };

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
  const router = useRouter();
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

  async function handleSetPriority(p: Task["priority"]) {
    await updateTask(workspaceId, spaceId, listId, task.id, { priority: p });
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
      <div className="w-36 shrink-0 px-2 flex items-stretch" onClick={(e) => e.stopPropagation()}>
        <Popover open={assigneeOpen} onOpenChange={(o) => { setAssigneeOpen(o); if (o) void loadMembers(); }}>
          <PopoverTrigger asChild>
            <button className="flex flex-1 items-center gap-2 rounded px-2 py-2.5 hover:bg-accent transition-colors text-left">
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
              {task.priority !== "NONE" ? (
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

const STATUS_PRESET_COLORS = [
  "#6B7280", "#3B82F6", "#10B981", "#F59E0B",
  "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4",
  "#F97316", "#84CC16",
];

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
          {/* Group options menu */}
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
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No active sprints</p>
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
