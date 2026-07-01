"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  ArrowsOutCardinalIcon,
  CalendarBlankIcon,
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  DotsSixVerticalIcon,
  LightningIcon,
  PencilSimpleIcon,
  PushPinIcon,
  TrayIcon,
  TrashIcon,
  UserIcon,
  UserPlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Calendar } from "@/components/ui/calendar";
import {
  archiveTask,
  deleteTask,
  duplicateTask,
  getWorkspaceMembers,
  moveTask,
  unarchiveTask,
  updateTask,
  updateTaskStatus,
} from "@/app/actions/task";
import { toastWithUndo } from "@/lib/undo-toast";
import { addAssignee, removeAssignee } from "@/app/actions/task-assignee";
import { InviteMemberModal } from "@/components/workspace/invite-member-modal";
import { getSprints, bulkMoveTasksToSprint } from "@/app/actions/sprint";
import { getWorkspaceLists } from "@/app/actions/list";
import { cn } from "@/lib/utils";
import { PRIORITY_CONFIG, userInitials, avatarSrc, formatDueDate } from "@/lib/priority-config";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaskListRowData {
  id: string;
  title: string;
  seqNumber: number;
  priority: string | null;
  statusId: string | null;
  listId?: string | null;
  dueDateStart: Date | null;
  dueDateEnd?: Date | null;
  isPinnedToList?: boolean;
  tags: { id: string; name: string; color: string }[];
  assignees: { userId: string; name: string; image: string | null }[];
}

type WorkspaceMember = { userId: string | null; name: string | null; email: string | null; image: string | null };
type SprintOption = { id: string; name: string; status: "PLANNED" | "ACTIVE" | "CLOSED" };
type ListSpaceOption = { id: string; name: string; color: string | null; lists: { id: string; name: string; color: string | null }[] };

export interface TaskListRowProps {
  task: TaskListRowData;
  statusColor: string;
  workspaceId: string;
  spaceId: string;
  /** Explicit list context — overrides task.listId for all server actions */
  listId?: string;
  statuses: { id: string; name: string; color: string }[];
  canEdit?: boolean;
  isAdmin?: boolean;
  /** Show "Pin to top / Unpin from top" in the ⋯ menu (list view) */
  canPinToList?: boolean;
  /** Exclude this sprint from the "Move to Sprint" list (sprint view passes its own id) */
  excludeSprintId?: string;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onOpen: () => void;
  onRefresh: () => void;
  isPersonallyPinned?: boolean;
  /** Show a "Backlog" button inside the "Move to Sprint" section (sprint view) */
  onMoveToBacklog?: () => void;
  /** Called with the new task id after a successful duplicate (sprint view uses this to add the copy to the sprint) */
  onAfterDuplicate?: (newTaskId: string) => Promise<void>;
  // Optional DnD props — provided by a SortableTaskRow wrapper in list view
  dragRef?: (node: HTMLElement | null) => void;
  dragStyle?: React.CSSProperties;
  dragProps?: Record<string, unknown>;
  isDragging?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskListRow({
  task,
  statusColor,
  workspaceId,
  spaceId,
  listId: listIdProp,
  statuses,
  canEdit,
  isAdmin,
  canPinToList,
  excludeSprintId,
  selected,
  onSelect,
  onOpen,
  onRefresh,
  isPersonallyPinned: isPersonallyPinnedProp,
  onMoveToBacklog,
  onAfterDuplicate,
  dragRef,
  dragStyle,
  dragProps,
  isDragging,
}: TaskListRowProps) {
  const router = useRouter();
  const { mutate } = useSWRConfig();

  const effectiveListId = listIdProp || task.listId || null;

  // ── Optimistic state ──────────────────────────────────────────────────────
  const [localPriority, setLocalPriority] = React.useState<string>(task.priority ?? "NONE");
  // The "Due Date" column represents the deadline — the end date (falling back
  // to the start date for single-date tasks).
  const [localDueDate, setLocalDueDate] = React.useState<Date | null>(task.dueDateEnd ?? task.dueDateStart ?? null);
  const [localPersonalPin, setLocalPersonalPin] = React.useState(isPersonallyPinnedProp ?? false);

  React.useEffect(() => { setLocalPriority(task.priority ?? "NONE"); }, [task.priority]);
  React.useEffect(() => { setLocalDueDate(task.dueDateEnd ?? task.dueDateStart ?? null); }, [task.dueDateEnd, task.dueDateStart]);
  React.useEffect(() => {
    if (isPersonallyPinnedProp !== undefined) setLocalPersonalPin(isPersonallyPinnedProp);
  }, [isPersonallyPinnedProp]);

  // Fetch pin state when parent doesn't supply it
  React.useEffect(() => {
    if (isPersonallyPinnedProp !== undefined) return;
    fetch(`/api/tasks/${task.id}/pin`)
      .then((r) => r.json())
      .then((d) => { if (typeof d?.pinned === "boolean") setLocalPersonalPin(d.pinned); })
      .catch(() => {});
  }, [task.id, isPersonallyPinnedProp]);

  React.useEffect(() => {
    function onUnpin(e: Event) {
      if ((e as CustomEvent<{ taskId: string }>).detail.taskId === task.id) setLocalPersonalPin(false);
    }
    window.addEventListener("task-personal-unpin", onUnpin);
    return () => window.removeEventListener("task-personal-unpin", onUnpin);
  }, [task.id]);

  const priority = PRIORITY_CONFIG[localPriority as keyof typeof PRIORITY_CONFIG] ?? PRIORITY_CONFIG.NONE;
  const dueDate = formatDueDate(localDueDate);

  // ── Popover open state ────────────────────────────────────────────────────
  const [assigneeOpen, setAssigneeOpen] = React.useState(false);
  const [members, setMembers] = React.useState<WorkspaceMember[] | null>(null);
  const [memberSearch, setMemberSearch] = React.useState("");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [dateOpen, setDateOpen] = React.useState(false);
  const [priorityOpen, setPriorityOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [moveSprints, setMoveSprints] = React.useState<SprintOption[] | null>(null);
  const [moveListSpaces, setMoveListSpaces] = React.useState<ListSpaceOption[] | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function loadMembers() {
    if (members !== null) return;
    const res = await getWorkspaceMembers(workspaceId);
    if ("error" in res) return;
    setMembers(res.members);
  }

  // Force a re-fetch (e.g. after inviting a member) regardless of cache.
  async function refreshMembers() {
    const res = await getWorkspaceMembers(workspaceId);
    if (!("error" in res)) setMembers(res.members);
  }

  async function loadMoveData() {
    if (moveSprints !== null) return;
    const [sprintsRes, listsRes] = await Promise.all([
      getSprints(workspaceId, spaceId),
      getWorkspaceLists(workspaceId, effectiveListId ?? ""),
    ]);
    setMoveSprints(
      "error" in sprintsRes ? [] :
      sprintsRes.sprints.filter((s) => s.status !== "CLOSED" && s.id !== excludeSprintId),
    );
    setMoveListSpaces("error" in listsRes ? [] : listsRes.spaces);
  }

  async function handleTogglePersonalPin(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !localPersonalPin;
    setLocalPersonalPin(next);
    try {
      const res = await fetch(`/api/tasks/${task.id}/pin`, { method: next ? "POST" : "DELETE" });
      if (!res.ok) {
        setLocalPersonalPin(!next);
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to update pin");
      } else {
        void mutate(`/api/workspaces/${workspaceId}/pinned-tasks`);
      }
    } catch {
      setLocalPersonalPin(!next);
      toast.error("Failed to update pin");
    }
  }

  async function handleToggleAssignee(userId: string | null) {
    if (!userId) return;
    const isAssigned = task.assignees.some((a) => a.userId === userId);
    if (isAssigned) await removeAssignee(workspaceId, spaceId, effectiveListId, task.id, userId);
    else await addAssignee(workspaceId, spaceId, effectiveListId, task.id, userId);
    onRefresh();
  }

  async function handleSetDueDate(date: Date | null) {
    const prev = localDueDate;
    setLocalDueDate(date);
    setDateOpen(false);
    // "Due Date" is the deadline (end date). Preserve an existing start date; for
    // tasks with no start, set both so single-date tasks stay consistent.
    const patch = task.dueDateStart
      ? { dueDateEnd: date }
      : { dueDateStart: date, dueDateEnd: date };
    const res = await updateTask(workspaceId, spaceId, effectiveListId, task.id, patch);
    if ("error" in res) { setLocalDueDate(prev); toast.error("Failed to update due date"); }
    else onRefresh();
  }

  async function handleSetPriority(p: string) {
    const prev = localPriority;
    setLocalPriority(p);
    setPriorityOpen(false);
    const res = await updateTask(workspaceId, spaceId, effectiveListId, task.id, { priority: p as "NONE" | "LOW" | "MEDIUM" | "HIGH" | "URGENT" });
    if ("error" in res) { setLocalPriority(prev); toast.error("Failed to update priority"); }
    else onRefresh();
  }

  async function handleMoveToSprint(targetSprintId: string, sprintName: string) {
    const res = await bulkMoveTasksToSprint(workspaceId, spaceId, effectiveListId || null, [task.id], targetSprintId);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Moved to ${sprintName}`);
    onRefresh();
  }

  async function handleMoveToList(targetListId: string, listName: string) {
    const res = await moveTask(workspaceId, spaceId, task.id, targetListId);
    if ("error" in res) { toast.error(res.error); return; }
    toast.success(`Moved to ${listName}`);
    onRefresh();
  }

  async function handleDuplicate(e: React.MouseEvent) {
    e.stopPropagation();
    const res = await duplicateTask(workspaceId, spaceId, effectiveListId || null, task.id);
    if ("error" in res) { toast.error(res.error); return; }
    if (onAfterDuplicate) await onAfterDuplicate(res.taskId);
    onRefresh();
  }

  async function handleArchive(e: React.MouseEvent) {
    e.stopPropagation();
    await archiveTask(workspaceId, spaceId, effectiveListId, task.id);
    onRefresh();
    toastWithUndo("Task archived", async () => {
      await unarchiveTask(workspaceId, spaceId, effectiveListId, task.id);
      onRefresh();
    });
  }

  async function handlePinToList(e: React.MouseEvent) {
    e.stopPropagation();
    const res = await fetch(`/api/tasks/${task.id}/pin-to-list`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Failed to pin task");
    } else {
      onRefresh();
    }
  }

  async function handleUnpinFromList(e: React.MouseEvent) {
    e.stopPropagation();
    const res = await fetch(`/api/tasks/${task.id}/pin-to-list`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Failed to unpin task");
    } else {
      onRefresh();
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    await deleteTask(workspaceId, spaceId, effectiveListId, task.id);
    setDeleting(false);
    setDeleteOpen(false);
    onRefresh();
  }

  const filteredMembers = (members ?? []).filter(
    (m) =>
      m.name?.toLowerCase().includes(memberSearch.toLowerCase()) ||
      m.email?.toLowerCase().includes(memberSearch.toLowerCase()),
  );

  // ── Shared column sections ─────────────────────────────────────────────────

  const assigneeCell = (
    <div className="w-36 shrink-0 self-stretch flex items-center justify-center px-2" onClick={(e) => e.stopPropagation()}>
      {canEdit ? (
        <Popover open={assigneeOpen} onOpenChange={(o) => { setAssigneeOpen(o); if (o) void loadMembers(); }}>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center gap-2 px-2 py-1 rounded-md border border-transparent hover:bg-accent/60 transition-colors cursor-pointer select-none">
              {task.assignees.length > 0 ? (
                <TooltipProvider>
                  <div className="flex -space-x-1.5">
                    {task.assignees.slice(0, 3).map((a) => (
                      <Tooltip key={a.userId}>
                        <TooltipTrigger asChild>
                          <Avatar className="size-6 shrink-0 border border-background shadow-sm">
                            {a.image && <AvatarImage src={avatarSrc(a.image)} alt={a.name} />}
                            <AvatarFallback className="text-2xs bg-primary text-primary-foreground font-semibold">{userInitials(a.name)}</AvatarFallback>
                          </Avatar>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="px-2 py-1 text-2xs"><p>{a.name}</p></TooltipContent>
                      </Tooltip>
                    ))}
                    {task.assignees.length > 3 && (
                      <div className="flex size-6 items-center justify-center rounded-full border border-background bg-muted text-2xs text-muted-foreground font-bold shadow-sm">+{task.assignees.length - 3}</div>
                    )}
                  </div>
                </TooltipProvider>
              ) : (
                <UserIcon className="size-4 text-gray-400 group-hover/row:text-gray-600" weight="bold" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="w-72 p-2">
            <Input placeholder="Search members…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} className="h-8 text-xs mb-2" />
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
                    <button key={m.userId} onClick={() => void handleToggleAssignee(m.userId)} className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors cursor-pointer", assigned ? "bg-primary/10" : "hover:bg-accent")}>
                      <Avatar className="size-6 shrink-0">
                        {m.image && <AvatarImage src={avatarSrc(m.image)} />}
                        <AvatarFallback className="text-2xs bg-primary/10 text-primary font-semibold">{userInitials(m.name ?? m.email ?? "?")}</AvatarFallback>
                      </Avatar>
                      <span className="flex-1 min-w-0 text-left truncate">{m.name ?? m.email}</span>
                      {assigned && <CheckIcon className="size-3.5 text-primary shrink-0" weight="bold" />}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-1 border-t border-border pt-1">
              <button
                onClick={() => { setAssigneeOpen(false); setInviteOpen(true); }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border">
                  <UserPlusIcon className="size-3.5" />
                </span>
                <span className="flex-1 truncate text-left">Invite member</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex items-center gap-2 px-2">
          {task.assignees.length > 0 ? (
            <div className="flex -space-x-1.5">
              {task.assignees.slice(0, 3).map((a) => (
                <Avatar key={a.userId} className="size-6 shrink-0 border border-background shadow-sm">
                  {a.image && <AvatarImage src={avatarSrc(a.image)} alt={a.name} />}
                  <AvatarFallback className="text-2xs bg-primary text-primary-foreground font-semibold">{userInitials(a.name)}</AvatarFallback>
                </Avatar>
              ))}
              {task.assignees.length > 3 && <div className="flex size-6 items-center justify-center rounded-full border border-background bg-muted text-2xs text-muted-foreground font-bold shadow-sm">+{task.assignees.length - 3}</div>}
            </div>
          ) : (
            <UserIcon className="size-4 text-gray-300" weight="bold" />
          )}
        </div>
      )}
    </div>
  );

  const dueDateCell = (
    <div className="w-28 shrink-0 self-stretch flex items-center px-2" onClick={(e) => e.stopPropagation()}>
      {canEdit ? (
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <button className={cn("inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-transparent hover:bg-accent/60 transition-colors text-xs font-semibold cursor-pointer select-none", dueDate?.overdue ? "text-red-500" : "text-gray-600")}>
              <CalendarBlankIcon className="size-3.5 shrink-0" />
              {dueDate ? <span>{dueDate.label}</span> : <span className="text-gray-400">Set date</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" side="bottom" className="w-auto p-0">
            <Calendar mode="single" selected={localDueDate ?? undefined} disabled={task.dueDateStart ? { before: new Date(task.dueDateStart) } : undefined} onSelect={(date) => { void handleSetDueDate(date ?? null); setDateOpen(false); }} />
          </PopoverContent>
        </Popover>
      ) : (
        <div className={cn("flex items-center gap-1.5 px-2 text-xs font-semibold", dueDate?.overdue ? "text-red-500" : "text-gray-400")}>
          <CalendarBlankIcon className="size-3.5 shrink-0" />
          {dueDate ? <span>{dueDate.label}</span> : null}
        </div>
      )}
    </div>
  );

  const priorityCell = (
    <div className="w-32 shrink-0 self-stretch flex items-center px-2" onClick={(e) => e.stopPropagation()}>
      {canEdit ? (
        <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
          <PopoverTrigger asChild>
            <button className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-transparent hover:bg-accent/60 transition-colors cursor-pointer select-none">
              <span className={cn("flex items-center gap-1.5 text-xs font-bold", priority.color)}>
                <span>{priority.icon}</span>{priority.label}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" className="w-44 p-1">
            <p className="px-2 py-1 text-2xs font-bold text-muted-foreground uppercase tracking-wide">Priority</p>
            {(["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map((value) => (
              <button key={value} onClick={() => void handleSetPriority(value)} className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent cursor-pointer", localPriority === value && "bg-accent")}>
                <span>{PRIORITY_CONFIG[value].icon}</span>
                <span className={PRIORITY_CONFIG[value].color}>{PRIORITY_CONFIG[value].label}</span>
              </button>
            ))}
            <div className="h-px bg-border my-1" />
            <button onClick={() => void handleSetPriority("NONE")} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent cursor-pointer">
              <XIcon className="size-3.5 shrink-0" /> Clear
            </button>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex items-center gap-1.5 px-2">
          <span className={cn("flex items-center gap-1.5 text-xs font-bold", priority.color)}>
            <span>{priority.icon}</span>{priority.label}
          </span>
        </div>
      )}
    </div>
  );

  const actionsCell = (
    <div className="w-48 shrink-0 py-1.5 pr-4 flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
      <div className="opacity-0 group-hover/row:opacity-100 transition-all duration-200 flex items-center gap-0.5">
        <button onClick={handleTogglePersonalPin} title={localPersonalPin ? "Unpin from sidebar" : "Pin to sidebar"} className="flex size-7 items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <PushPinIcon className="size-4" weight={localPersonalPin ? "fill" : "regular"} />
        </button>
        <button onClick={onOpen} title="Edit Task" className="flex size-7 items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
          <PencilSimpleIcon className="size-4" />
        </button>
        {canEdit && (
          <button onClick={handleDuplicate} title="Duplicate Task" className="flex size-7 items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
            <CopyIcon className="size-4" />
          </button>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button title="Move Status" className="flex size-7 items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <ArrowsOutCardinalIcon className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-1">
            <p className="px-2 py-1 text-2xs font-bold text-muted-foreground uppercase tracking-wide">Move Status</p>
            {statuses.map((s) => (
              <button key={s.id} onClick={async () => { await updateTaskStatus(workspaceId, spaceId, effectiveListId, task.id, s.id); onRefresh(); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent text-left cursor-pointer">
                <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
        {isAdmin && (
          <button onClick={(e) => { e.stopPropagation(); setDeleteOpen(true); }} title="Delete Task" className="flex size-7 items-center justify-center rounded-md hover:bg-red-50 text-red-500 hover:text-red-700 transition-colors cursor-pointer">
            <TrashIcon className="size-4" />
          </button>
        )}
        {canEdit && (
          <Popover onOpenChange={(open) => { if (open) void loadMoveData(); }}>
            <PopoverTrigger asChild>
              <button className="flex size-7 items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                <DotsThreeIcon className="size-4.5" weight="bold" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1 max-h-80 overflow-y-auto">
              <p className="px-2 py-1 text-2xs font-bold text-muted-foreground uppercase tracking-wide">Move to Sprint</p>
              {moveSprints === null ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>
              ) : moveSprints.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No active sprints</p>
              ) : moveSprints.map((s) => (
                <button key={s.id} onClick={() => void handleMoveToSprint(s.id, s.name)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent cursor-pointer">
                  <LightningIcon className={cn("size-3.5 shrink-0", s.status === "ACTIVE" ? "text-primary" : "text-muted-foreground")} weight="fill" />
                  <span className="flex-1 text-left truncate">{s.name}</span>
                  <span className={cn("text-2xs px-1.5 py-0.5 rounded-full shrink-0", s.status === "ACTIVE" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{s.status === "ACTIVE" ? "Active" : "Planned"}</span>
                </button>
              ))}
              {onMoveToBacklog && (
                <button onClick={() => void onMoveToBacklog()} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent cursor-pointer">
                  <TrayIcon className="size-3.5 shrink-0 text-muted-foreground" /> Backlog
                </button>
              )}
              <div className="h-px bg-border my-1" />
              <p className="px-2 py-1 text-2xs font-bold text-muted-foreground uppercase tracking-wide">Move to List</p>
              {moveListSpaces === null ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p>
              ) : moveListSpaces.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No other lists</p>
              ) : moveListSpaces.map((sp) => (
                <div key={sp.id}>
                  <p className="flex items-center gap-1.5 px-2 py-0.5 text-2xs font-bold text-muted-foreground uppercase">
                    <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: sp.color ?? "#6B7280" }} />
                    {sp.name}
                  </p>
                  {sp.lists.map((l) => (
                    <button key={l.id} onClick={() => void handleMoveToList(l.id, l.name)} className="flex w-full items-center gap-2 rounded pl-5 pr-2 py-1.5 text-xs hover:bg-accent cursor-pointer">
                      <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: l.color ?? "#6B7280" }} />
                      <span className="flex-1 text-left truncate">{l.name}</span>
                    </button>
                  ))}
                </div>
              ))}
              {canPinToList && (
                <>
                  <div className="h-px bg-border my-1" />
                  {task.isPinnedToList ? (
                    <button onClick={handleUnpinFromList} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent text-left cursor-pointer">
                      <PushPinIcon className="size-3.5 text-primary shrink-0" weight="fill" /> Unpin from top
                    </button>
                  ) : (
                    <button onClick={handlePinToList} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent text-left cursor-pointer">
                      <PushPinIcon className="size-3.5 text-muted-foreground shrink-0" /> Pin to top
                    </button>
                  )}
                </>
              )}
              <div className="h-px bg-border my-1" />
              <button onClick={handleArchive} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent text-left cursor-pointer">
                <ArchiveIcon className="size-3.5 text-muted-foreground" /> Archive
              </button>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Invite member (from assignee dropdown) */}
      <InviteMemberModal
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        workspaceId={workspaceId}
        onInvited={refreshMembers}
      />

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-red-100">
              <TrashIcon className="size-6 text-red-500" />
            </div>
          </div>
          <div className="space-y-1.5">
            <DialogTitle className="text-center text-base">Delete task?</DialogTitle>
            <p className="text-sm text-muted-foreground text-center leading-relaxed">
              <span className="font-medium text-foreground">&ldquo;{task.title}&rdquo;</span> will be permanently deleted and cannot be recovered.
            </p>
          </div>
          <div className="flex gap-3 mt-1">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" className="flex-1" onClick={confirmDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Desktop row */}
      <div
        ref={dragRef}
        style={dragStyle}
        {...dragProps}
        className={cn(
          "group/row hidden md:flex items-center border-b border-border cursor-pointer text-foreground bg-card min-h-10 text-sm",
          isDragging ? "opacity-40 shadow-none border-dashed" : "transition-colors duration-150",
          selected ? "bg-primary/5" : "hover:bg-accent/30",
        )}
        onClick={onOpen}
      >
        <div
          className={cn("w-0.75 self-stretch shrink-0 transition-opacity duration-200", selected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100")}
          style={{ backgroundColor: statusColor }}
        />
        <div className="flex items-center gap-1 pl-2 py-1.5 shrink-0 w-14">
          {dragProps && (
            <DotsSixVerticalIcon
              className={cn(
                "size-3.5 text-muted-foreground/50 shrink-0 transition-opacity duration-200 cursor-grab active:cursor-grabbing",
                selected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
              )}
            />
          )}
          <div
            className={cn("flex size-4 items-center justify-center rounded border transition-opacity duration-200 cursor-pointer", selected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100")}
            onClick={(e) => { e.stopPropagation(); onSelect(task.id, !selected); }}
          >
            <div className={cn("flex size-4 items-center justify-center rounded border transition-colors", selected ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40 bg-background")}>
              {selected && <CheckIcon className="size-2.5" weight="bold" />}
            </div>
          </div>
        </div>
        <div className="flex flex-1 items-center gap-2.5 min-w-0 py-1.5 pr-4 pl-1">
          <span className="text-2xs text-gray-400 font-mono shrink-0 select-none flex items-center gap-1.5">
            <PushPinIcon className={cn("size-2.5 shrink-0", localPersonalPin ? "text-primary" : "invisible")} weight="fill" />
            #{task.seqNumber}
          </span>
          <span className="text-[13px] font-medium text-foreground truncate group-hover/row:text-primary transition-colors">{task.title}</span>
          {task.tags.slice(0, 2).map((tag) => (
            <span key={tag.id} className="hidden lg:inline-flex shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold tracking-wide border" style={{ backgroundColor: `${tag.color}10`, color: tag.color, borderColor: `${tag.color}30` }}>
              {tag.name}
            </span>
          ))}
        </div>
        {assigneeCell}
        {dueDateCell}
        {priorityCell}
        {actionsCell}
      </div>

      {/* Mobile card */}
      <div
        className="md:hidden flex flex-col p-4 border-b border-border gap-3 hover:bg-accent/30 bg-card transition-all cursor-pointer relative"
        onClick={onOpen}
      >
        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: statusColor }} />
        <div className="flex items-start gap-2.5 pl-2">
          <div
            className="flex size-4.5 items-center justify-center rounded border transition-colors cursor-pointer shrink-0 mt-0.5"
            onClick={(e) => { e.stopPropagation(); onSelect(task.id, !selected); }}
          >
            <div className={cn("flex size-4 items-center justify-center rounded border transition-colors", selected ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary/40 bg-background")}>
              {selected && <CheckIcon className="size-2.5" weight="bold" />}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="text-2xs text-gray-400 font-mono font-bold">#{task.seqNumber}</span>
              {localPriority !== "NONE" && (
                <span className={cn("inline-flex items-center gap-1 text-2xs font-bold px-1.5 py-0.5 rounded border border-current/10 bg-current/5", PRIORITY_CONFIG[localPriority as keyof typeof PRIORITY_CONFIG]?.color ?? "text-gray-400")}>
                  <span>{PRIORITY_CONFIG[localPriority as keyof typeof PRIORITY_CONFIG]?.icon}</span>
                  {PRIORITY_CONFIG[localPriority as keyof typeof PRIORITY_CONFIG]?.label}
                </span>
              )}
            </div>
            <p className="text-[13px] font-medium text-foreground line-clamp-2">{task.title}</p>
          </div>
          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex size-7 items-center justify-center rounded hover:bg-accent text-muted-foreground cursor-pointer">
                  <DotsThreeIcon className="size-4.5" weight="bold" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1">
                <button onClick={onOpen} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent text-left cursor-pointer">
                  <PencilSimpleIcon className="size-3.5 text-muted-foreground" /> Edit
                </button>
                <button onClick={handleDuplicate} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent text-left cursor-pointer">
                  <CopyIcon className="size-3.5 text-muted-foreground" /> Duplicate
                </button>
                {isAdmin ? (
                  <button onClick={(e) => { e.stopPropagation(); setDeleteOpen(true); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 text-left cursor-pointer">
                    <TrashIcon className="size-3.5" /> Delete
                  </button>
                ) : (
                  <button onClick={handleArchive} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent text-left cursor-pointer">
                    <ArchiveIcon className="size-3.5 text-muted-foreground" /> Archive
                  </button>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="flex items-center justify-between pl-2 mt-1">
          <div onClick={(e) => e.stopPropagation()}>
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn("flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 text-2xs font-semibold transition-all cursor-pointer", dueDate?.overdue ? "text-red-500 bg-red-50" : "text-foreground/70")}>
                  <CalendarBlankIcon className="size-3.5" />
                  <span>{dueDate ? dueDate.label : "Set date"}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <Calendar mode="single" selected={localDueDate ?? undefined} onSelect={(date) => void handleSetDueDate(date ?? null)} />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {task.assignees.length > 0 && (
              <div className="flex -space-x-1.5">
                {task.assignees.slice(0, 3).map((a) => (
                  <Avatar key={a.userId} className="size-5.5 border border-background">
                    {a.image && <AvatarImage src={avatarSrc(a.image)} />}
                    <AvatarFallback className="text-[8px] bg-primary text-primary-foreground font-semibold">{userInitials(a.name)}</AvatarFallback>
                  </Avatar>
                ))}
                {task.assignees.length > 3 && (
                  <div className="flex size-5.5 items-center justify-center rounded-full border border-background bg-muted text-[8px] font-bold text-muted-foreground">+{task.assignees.length - 3}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
