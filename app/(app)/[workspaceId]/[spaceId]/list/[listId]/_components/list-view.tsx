"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  CaretLeftIcon,
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
  DotsSixVerticalIcon,
  ArrowsOutCardinalIcon,
  ArrowsDownUpIcon,
  GearIcon,
  FunnelIcon,
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
  unarchiveTask,
  updateTask,
  updateTaskStatus,
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  addDays,
  format,
  isToday,
  isPast,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from "date-fns";

// drag and drop
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  canEdit?: boolean;
  members?: { userId: string; name: string | null; email: string | null; image?: string | null }[];
  tags?: { id: string; name: string; color: string }[];
  archivedTasks?: { id: string; title: string; seqNumber: number }[];
  onArchivedChanged?: () => Promise<void>;
}

type WorkspaceMember = { userId: string | null; name: string | null; email: string | null; image: string | null };

const PRIORITY_CONFIG = {
  NONE:   { label: "Clear Priority", color: "text-gray-400",  iconClass: "text-gray-300" },
  LOW:    { label: "Low",    color: "text-gray-500",  iconClass: "text-gray-400" },
  MEDIUM: { label: "Medium", color: "text-yellow-600", iconClass: "text-yellow-500" },
  HIGH:   { label: "High",   color: "text-orange-500", iconClass: "text-orange-500" },
  URGENT: { label: "Urgent", color: "text-red-500",    iconClass: "text-red-500" },
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

// ─── ClickUp Calendar component ───────────────────────────────────────────────

interface ClickUpCalendarProps {
  selectedDate: Date | null;
  onSelect: (date: Date | null) => void;
  onClose: () => void;
}

export function ClickUpCalendar({ selectedDate, onSelect, onClose }: ClickUpCalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState<Date>(() => selectedDate || new Date());

  const handlePrevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth((prev) => subMonths(prev, 1));
  };

  const handleNextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth((next) => addMonths(next, 1));
  };

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 }); // Monday
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  return (
    <div className="p-3 w-[260px] select-none bg-white rounded-2xl shadow-xl border border-gray-100 flex flex-col gap-3 text-sm animate-in fade-in-50 zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
      {/* Month Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={handlePrevMonth}
          className="p-1 rounded-lg hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
        >
          <CaretLeftIcon className="size-4" weight="bold" />
        </button>
        <span className="font-semibold text-gray-800">
          {format(currentMonth, "MMMM yyyy")}
        </span>
        <button
          onClick={handleNextMonth}
          className="p-1 rounded-lg hover:bg-gray-50 text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
        >
          <CaretRightIcon className="size-4" weight="bold" />
        </button>
      </div>

      {/* Weekdays Header */}
      <div className="grid grid-cols-7 text-center text-xs font-semibold text-gray-400">
        <span>M</span>
        <span>T</span>
        <span>W</span>
        <span>T</span>
        <span>F</span>
        <span>S</span>
        <span>S</span>
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {days.map((day) => {
          const isCurrentM = isSameMonth(day, currentMonth);
          const isSel = selectedDate ? isSameDay(day, selectedDate) : false;
          const isTod = isToday(day);

          return (
            <button
              key={day.toString()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(day);
                onClose();
              }}
              className={cn(
                "h-7 w-7 mx-auto rounded-full flex items-center justify-center text-xs transition-all relative font-medium cursor-pointer",
                !isCurrentM && "text-gray-300",
                isCurrentM && "text-gray-700 hover:bg-gray-50",
                isTod && "border border-primary text-primary font-bold",
                isSel && "bg-primary text-white hover:bg-primary/95"
              )}
            >
              {format(day, "d")}
              {isTod && !isSel && (
                <span className="absolute bottom-1 size-1 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {/* Footer / Shortcuts */}
      <div className="h-px bg-gray-100 my-1" />
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(new Date()); onClose(); }}
            className="px-2 py-1 bg-gray-50 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Today
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(addDays(new Date(), 1)); onClose(); }}
            className="px-2 py-1 bg-gray-50 text-gray-600 rounded-lg text-xs font-semibold hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Tomorrow
          </button>
        </div>
        {selectedDate && (
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(null); onClose(); }}
            className="w-full py-1 text-red-500 hover:bg-red-50 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Clear Date
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  statusColor,
  workspaceId,
  spaceId,
  listId,
  isAdmin,
  canEdit,
  selected,
  onSelect,
  onOpen,
  statuses,
}: {
  task: Task;
  statusColor: string;
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
  canEdit?: boolean;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onOpen: () => void;
  statuses: Status[];
}) {
  const router = useRouter();
  const priority = PRIORITY_CONFIG[task.priority];
  const dueDate = formatDueDate(task.dueDateStart);

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
    <>
      {/* Desktop/Tablet Row layout */}
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        className={cn(
          "group/row hidden md:flex items-center border-b border-gray-100 transition-all duration-200 cursor-pointer text-gray-700 bg-white min-h-[40px] text-sm",
          isDragging && "opacity-40 shadow-none border-dashed",
          selected ? "bg-blue-50/30" : "hover:bg-[#F8FAFC]",
        )}
        onClick={onOpen}
      >
        {/* Left ClickUp Status Indicator Line */}
        <div
          className={cn(
            "w-[3px] self-stretch shrink-0 transition-opacity duration-200",
            selected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
          )}
          style={{ backgroundColor: statusColor }}
        />

        {/* Drag handle & Checkbox */}
        <div className="flex items-center gap-1.5 pl-3 py-1.5 shrink-0 w-16">
          <div
            {...listeners}
            className="opacity-0 group-hover/row:opacity-100 flex size-5 items-center justify-center cursor-grab text-gray-400 hover:text-gray-600 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <DotsSixVerticalIcon className="size-4" />
          </div>

          <div
            className={cn(
              "flex size-4 items-center justify-center rounded border transition-opacity duration-200 cursor-pointer",
              selected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"
            )}
            onClick={(e) => { e.stopPropagation(); onSelect(task.id, !selected); }}
          >
            <div className={cn(
              "flex size-4 items-center justify-center rounded border transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-gray-300 hover:border-gray-400 bg-white",
            )}>
              {selected && <CheckIcon className="size-2.5" weight="bold" />}
            </div>
          </div>
        </div>

        {/* Task Name & ID */}
        <div className="flex flex-1 items-center gap-2.5 min-w-0 py-1.5 pr-4 pl-1">
          <span className="text-2xs text-gray-400 font-mono shrink-0 select-none">#{task.seqNumber}</span>
          <span className="text-[13px] font-medium text-gray-800 truncate group-hover/row:text-primary transition-colors">{task.title}</span>
          {task.tags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="hidden lg:inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide border"
              style={{ backgroundColor: `${tag.color}10`, color: tag.color, borderColor: `${tag.color}30` }}
            >
              {tag.name}
            </span>
          ))}
        </div>

        {/* Assignee */}
        <div className="w-36 shrink-0 px-4 flex items-center" onClick={(e) => e.stopPropagation()}>
          <Popover open={assigneeOpen} onOpenChange={(o) => { setAssigneeOpen(o); if (o) void loadMembers(); }}>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-2 rounded border border-transparent py-1 hover:bg-gray-50 hover:border-gray-200 transition-all text-left cursor-pointer select-none">
                {task.assignees.length > 0 ? (
                  <TooltipProvider>
                    <div className="flex -space-x-1.5">
                      {task.assignees.slice(0, 3).map((a) => (
                        <Tooltip key={a.userId}>
                          <TooltipTrigger asChild>
                            <div className="relative size-6 shrink-0">
                              <Avatar className="size-6 border border-white shadow-sm">
                                {a.image && <AvatarImage src={a.image} alt={a.name} />}
                                <AvatarFallback className="text-[10px] bg-primary text-primary-foreground font-semibold">
                                  {userInitials(a.name)}
                                </AvatarFallback>
                              </Avatar>
                              {/* Simulated presence indicator dot */}
                              <span className="absolute bottom-0 right-0 block size-1.5 rounded-full bg-emerald-500 ring-[1px] ring-white" />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="px-2 py-1 text-2xs">
                            <p>{a.name}</p>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                      {task.assignees.length > 3 && (
                        <div className="flex size-6 items-center justify-center rounded-full border border-white bg-gray-100 text-[10px] text-gray-500 font-bold shadow-sm">
                          +{task.assignees.length - 3}
                        </div>
                      )}
                    </div>
                  </TooltipProvider>
                ) : (
                  <div className="size-6 rounded-full border border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-all">
                    <UserIcon className="size-3.5" />
                  </div>
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
                  <p className="px-1 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">People</p>
                  {filteredMembers.map((m) => {
                    const assigned = task.assignees.some((a) => a.userId === m.userId);
                    return (
                      <button
                        key={m.userId}
                        onClick={() => void handleToggleAssignee(m.userId)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors cursor-pointer",
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
        <div className="w-28 shrink-0 px-4 flex items-center" onClick={(e) => e.stopPropagation()}>
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <button className={cn(
                "flex items-center gap-1.5 rounded border border-transparent px-2 py-1 hover:bg-gray-50 hover:border-gray-200 transition-all text-xs font-semibold text-left cursor-pointer select-none",
                dueDate?.overdue ? "text-red-500" : "text-gray-600 hover:text-gray-800",
              )}>
                {dueDate ? (
                  <>
                    <CalendarBlankIcon className="size-3.5" />
                    <span>{dueDate.label}</span>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors">
                    <CalendarBlankIcon className="size-3.5" />
                    <span>Set date</span>
                  </div>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="p-0 border-0 shadow-none bg-transparent">
              <ClickUpCalendar
                selectedDate={task.dueDateStart}
                onSelect={handleSetDueDate}
                onClose={() => setDateOpen(false)}
              />
            </PopoverContent>
          </Popover>
        </div>

        {/* Priority */}
        <div className="w-28 shrink-0 px-4 flex items-center" onClick={(e) => e.stopPropagation()}>
          <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 rounded border border-transparent px-2 py-1 hover:bg-gray-50 hover:border-gray-200 transition-all text-left cursor-pointer select-none">
                {task.priority !== "NONE" ? (
                  <span className={cn("flex items-center gap-1.5 text-xs font-bold", PRIORITY_CONFIG[task.priority].color)}>
                    <FlagIcon className="size-3.5 shrink-0" weight="fill" />
                    {PRIORITY_CONFIG[task.priority].label}
                  </span>
                ) : (
                  <div className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 transition-colors">
                    <FlagIcon className="size-3.5 text-gray-300" />
                    <span className="text-xs">No Priority</span>
                  </div>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-44 p-1">
              <p className="px-2 py-1 text-2xs font-bold text-muted-foreground uppercase tracking-wide">Priority</p>
              {([
                { value: "URGENT", label: "Urgent", color: "text-red-500"    },
                { value: "HIGH",   label: "High",   color: "text-orange-500" },
                { value: "MEDIUM", label: "Medium", color: "text-yellow-600" },
                { value: "LOW",    label: "Low",    color: "text-gray-500"   },
              ] as const).map(({ value, label, color }) => (
                <button
                  key={value}
                  onClick={() => void handleSetPriority(value)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent cursor-pointer",
                    task.priority === value && "bg-accent",
                  )}
                >
                  <FlagIcon className={cn("size-3.5 shrink-0", color)} weight="fill" />
                  <span className={color}>{label}</span>
                </button>
              ))}
              <div className="h-px bg-border my-1" />
              <button
                onClick={() => void handleSetPriority("NONE")}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent cursor-pointer"
              >
                <XIcon className="size-3.5 shrink-0" />
                Clear
              </button>
            </PopoverContent>
          </Popover>
        </div>

        {/* Row hover actions */}
        <div className="w-40 shrink-0 py-1.5 pr-4 flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <div className="opacity-0 group-hover/row:opacity-100 transition-all duration-200 flex items-center gap-0.5">
            {/* Edit */}
            <button
              onClick={onOpen}
              title="Edit Task"
              className="flex size-7 items-center justify-center rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
            >
              <PencilSimpleIcon className="size-4" />
            </button>

            {/* Duplicate */}
            <button
              onClick={handleDuplicate}
              title="Duplicate Task"
              className="flex size-7 items-center justify-center rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
            >
              <CopyIcon className="size-4" />
            </button>

            {/* Move status menu */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  title="Move Task Status"
                  className="flex size-7 items-center justify-center rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
                >
                  <ArrowsOutCardinalIcon className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-1">
                <p className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Move Status</p>
                {statuses.map((s) => (
                  <button
                    key={s.id}
                    onClick={async () => {
                      await updateTaskStatus(workspaceId, spaceId, listId, task.id, s.id);
                      router.refresh();
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent text-left cursor-pointer"
                  >
                    <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="truncate">{s.name}</span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Delete / Archive */}
            {isAdmin ? (
              <button
                onClick={handleDelete}
                title="Delete Task"
                className="flex size-7 items-center justify-center rounded-md hover:bg-red-50 text-red-500 hover:text-red-700 transition-colors cursor-pointer"
              >
                <TrashIcon className="size-4" />
              </button>
            ) : (
              <button
                onClick={handleArchive}
                title="Archive Task"
                className="flex size-7 items-center justify-center rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors cursor-pointer"
              >
                <ArchiveIcon className="size-4" />
              </button>
            )}

            {/* More menu dropdown */}
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex size-7 items-center justify-center rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors cursor-pointer">
                  <DotsThreeIcon className="size-4.5" weight="bold" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-40 p-1">
                <button onClick={handleArchive} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent text-left cursor-pointer">
                  <ArchiveIcon className="size-3.5 text-muted-foreground shrink-0" /> Archive
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      {/* Mobile Card Layout */}
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        className={cn(
          "md:hidden flex flex-col p-4 border-b border-gray-100 gap-3 hover:bg-slate-50/50 bg-white transition-all cursor-pointer relative",
          isDragging && "opacity-40 shadow-none border-dashed",
        )}
        onClick={onOpen}
      >
        {/* Status Line */}
        <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: statusColor }} />

        {/* Row 1: Checkbox, Seq ID, Title */}
        <div className="flex items-start gap-2.5 pl-2">
          <div
            className="flex size-4.5 items-center justify-center rounded border transition-colors cursor-pointer shrink-0 mt-0.5"
            onClick={(e) => { e.stopPropagation(); onSelect(task.id, !selected); }}
          >
            <div className={cn(
              "flex size-4 items-center justify-center rounded border transition-colors",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-gray-300 hover:border-gray-400 bg-white",
            )}>
              {selected && <CheckIcon className="size-2.5" weight="bold" />}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="text-[10px] text-gray-400 font-mono font-bold">#{task.seqNumber}</span>
              {task.priority !== "NONE" && (
                <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border border-current/10 bg-current/5", PRIORITY_CONFIG[task.priority].color)}>
                  <FlagIcon className="size-3" weight="fill" />
                  {PRIORITY_CONFIG[task.priority].label}
                </span>
              )}
            </div>
            <p className="text-[13px] font-medium text-gray-800 line-clamp-2">{task.title}</p>
          </div>

          {/* Quick options */}
          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex size-7 items-center justify-center rounded hover:bg-gray-100 text-gray-500 cursor-pointer">
                  <DotsThreeIcon className="size-4.5" weight="bold" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1">
                <button onClick={onOpen} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent text-left cursor-pointer">
                  <PencilSimpleIcon className="size-3.5 text-gray-500" /> Edit
                </button>
                <button onClick={handleDuplicate} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent text-left cursor-pointer">
                  <CopyIcon className="size-3.5 text-gray-500" /> Duplicate
                </button>
                {isAdmin ? (
                  <button onClick={handleDelete} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 text-left cursor-pointer">
                    <TrashIcon className="size-3.5" /> Delete
                  </button>
                ) : (
                  <button onClick={handleArchive} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs font-semibold hover:bg-accent text-left cursor-pointer">
                    <ArchiveIcon className="size-3.5 text-gray-500" /> Archive
                  </button>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Row 2: Assignees & Due Date */}
        <div className="flex items-center justify-between pl-2 mt-1">
          {/* Due date */}
          <div onClick={(e) => e.stopPropagation()}>
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded bg-gray-50 text-[10px] font-semibold transition-all cursor-pointer",
                  dueDate?.overdue ? "text-red-500 bg-red-50" : "text-gray-600",
                )}>
                  <CalendarBlankIcon className="size-3.5" />
                  <span>{dueDate ? dueDate.label : "Set date"}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="p-0 border-0 bg-transparent shadow-none">
                <ClickUpCalendar
                  selectedDate={task.dueDateStart}
                  onSelect={handleSetDueDate}
                  onClose={() => {}}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Assignees */}
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {task.assignees.length > 0 && (
              <div className="flex -space-x-1.5">
                {task.assignees.slice(0, 3).map((a) => (
                  <Avatar key={a.userId} className="size-5.5 border border-white">
                    {a.image && <AvatarImage src={a.image} />}
                    <AvatarFallback className="text-[8px] bg-primary text-primary-foreground font-semibold">
                      {userInitials(a.name)}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {task.assignees.length > 3 && (
                  <div className="flex size-5.5 items-center justify-center rounded-full border border-white bg-gray-100 text-[8px] font-bold text-gray-500">
                    +{task.assignees.length - 3}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
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
  canEdit,
  selectedIds,
  onSelect,
  onCreateTask,
  statuses,
}: {
  status: Status;
  tasks: Task[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
  canEdit?: boolean;
  selectedIds: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  onCreateTask: (statusId: string) => void;
  statuses: Status[];
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
          className="group/header flex items-center gap-2.5 py-1.5 px-3 hover:bg-slate-50/80 transition-colors cursor-pointer select-none border-b border-gray-100"
        >
          {/* Arrow */}
          <div className="flex size-5 items-center justify-center rounded hover:bg-gray-100 transition-colors shrink-0 text-gray-400 group-hover/header:text-gray-600">
            {collapsed ? (
              <CaretRightIcon weight="fill" className="size-3" />
            ) : (
              <CaretDownIcon weight="fill" className="size-3" />
            )}
          </div>

          {/* Pill Badge */}
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border transition-all"
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
          <span className="text-[11px] text-gray-400 font-semibold tabular-nums">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </span>

          {/* Settings Menu Icon */}
          <div className="ml-2 flex items-center gap-1 opacity-0 group-hover/header:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <button className="flex size-6 items-center justify-center rounded hover:bg-gray-100 transition-colors cursor-pointer">
                  <DotsThreeIcon className="size-4.5 text-gray-500" weight="bold" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" side="bottom" className="w-48 p-1 mt-1">
                <p className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Group Options</p>
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
              className="flex size-6 items-center justify-center rounded hover:bg-gray-100 transition-colors cursor-pointer"
              onClick={() => onCreateTask(status.id)}
            >
              <PlusIcon className="size-3.5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Tasks Container */}
        {!collapsed && (
          <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <div
              ref={setNodeRef}
              className={cn(
                "flex flex-col transition-all min-h-[4px]",
                isOver && "bg-slate-50/50 border-y border-dashed border-gray-200"
              )}
            >
              {tasks.length === 0 ? (
                <div className="py-3 pl-16 text-xs text-gray-400 italic bg-white border-b border-gray-50 select-none">
                  No tasks in status
                </div>
              ) : (
                tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    statusColor={status.color}
                    workspaceId={workspaceId}
                    spaceId={spaceId}
                    listId={listId}
                    isAdmin={isAdmin}
                    canEdit={canEdit}
                    selected={selectedIds.has(task.id)}
                    onSelect={onSelect}
                    onOpen={() => router.push(`/${workspaceId}/task/${task.id}`)}
                    statuses={statuses}
                  />
                ))
              )}

              {/* Add Task Button */}
              <button
                onClick={() => onCreateTask(status.id)}
                className="flex items-center gap-1.5 pl-16 pr-4 py-2 text-xs font-semibold text-gray-400 hover:text-primary hover:bg-[#F8FAFC]/50 transition-colors border-b border-gray-100 bg-white cursor-pointer select-none text-left"
              >
                <PlusIcon className="size-3.5 shrink-0" />
                Add Task
              </button>
            </div>
          </SortableContext>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-gray-800">Rename Status</DialogTitle>
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
            <DialogTitle className="text-sm font-bold text-gray-800">New Status</DialogTitle>
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

type SprintOption = { id: string; name: string; status: "PLANNED" | "ACTIVE" | "CLOSED" };

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
          <p className="px-2 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Sprint</p>
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
          <p className="px-2 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide">List</p>
          {loadingLists && <p className="px-2 py-1.5 text-xs text-gray-400">Loading…</p>}
          {!loadingLists && listSpaces?.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-gray-400">No other lists available</p>
          )}
          {!loadingLists && listSpaces?.map((sp) => (
            <div key={sp.id}>
              <p className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold text-gray-400 uppercase">
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
          onClick={handleBulkDelete}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <TrashIcon className="size-3.5" />
          Delete
        </button>
      )}
    </div>
  );
}

// ─── Main ListView Component ──────────────────────────────────────────────────

export function ListView({
  workspaceId,
  spaceId,
  listId,
  statuses,
  tasks,
  isAdmin,
  canEdit,
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
  const [activeTask, setActiveTask] = React.useState<Task | null>(null);

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
      list = list.filter((t) => statusFilter.includes(t.statusId));
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

  function onDragStart({ active }: DragStartEvent) {
    setActiveTask(localTasks.find((t) => t.id === active.id) ?? null);
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
    setActiveTask(null);
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
      if (newGroup === origTask.statusId) return;
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
      />

      <DndContext
        id="list-dnd"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        {/* ClickUp-style unified workspace container */}
        <div className="w-full bg-white border border-[#E5E7EB] rounded-2xl p-5 shadow-[0_1px_3px_0_rgba(0,0,0,0.05)] overflow-hidden flex flex-col gap-4">
          
          {/* Sticky Toolbar + Table Header Section */}
          <div className="sticky top-0 z-30 bg-white pb-2 border-b border-gray-100 flex flex-col gap-3">
            {/* Action Bar / Toolbar */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Search */}
                <div className="relative">
                  <PlusIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search tasks…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 w-44 rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all focus:w-56"
                  />
                </div>

                {/* Filter Popover */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-1.5 h-8 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer select-none">
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
                      <p className="mb-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Status</p>
                      <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                        {statuses.map(s => (
                          <label key={s.id} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer py-0.5 hover:bg-gray-50 rounded">
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
                      <p className="mb-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Priority</p>
                      <div className="flex flex-col gap-1">
                        {["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"].map(p => (
                          <label key={p} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer py-0.5 hover:bg-gray-50 rounded">
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
                        <p className="mb-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wide">Assignee</p>
                        <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
                          <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer py-0.5 hover:bg-gray-50 rounded">
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
                            <label key={m.userId} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer py-0.5 hover:bg-gray-50 rounded">
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
                    <button className="flex items-center gap-1.5 h-8 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer select-none">
                      <ArrowsDownUpIcon className="size-3.5 text-gray-500" />
                      Sort: {sortBy ? (sortBy.charAt(0).toUpperCase() + sortBy.slice(1)) : "None"}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-44 p-1 flex flex-col gap-0.5">
                    <button onClick={() => setSortBy(null)} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-gray-50 cursor-pointer", !sortBy && "bg-gray-100 text-gray-900")}>None</button>
                    <button onClick={() => { setSortBy("name"); setSortOrder(o => o === "asc" ? "desc" : "asc"); }} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-gray-50 cursor-pointer", sortBy === "name" && "bg-gray-100 text-gray-900")}>Task Name</button>
                    <button onClick={() => { setSortBy("due"); setSortOrder(o => o === "asc" ? "desc" : "asc"); }} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-gray-50 cursor-pointer", sortBy === "due" && "bg-gray-100 text-gray-900")}>Due Date</button>
                    <button onClick={() => { setSortBy("priority"); setSortOrder(o => o === "asc" ? "desc" : "asc"); }} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-gray-50 cursor-pointer", sortBy === "priority" && "bg-gray-100 text-gray-900")}>Priority</button>
                  </PopoverContent>
                </Popover>

                {/* Group By */}
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-1.5 h-8 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors cursor-pointer select-none">
                      <GearIcon className="size-3.5 text-gray-500" />
                      Group By: {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-44 p-1 flex flex-col gap-0.5">
                    <button onClick={() => setGroupBy("status")} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-gray-50 cursor-pointer", groupBy === "status" && "bg-gray-100 text-gray-900")}>Status</button>
                    <button onClick={() => setGroupBy("priority")} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-gray-50 cursor-pointer", groupBy === "priority" && "bg-gray-100 text-gray-900")}>Priority</button>
                    <button onClick={() => setGroupBy("assignee")} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-gray-50 cursor-pointer", groupBy === "assignee" && "bg-gray-100 text-gray-900")}>Assignee</button>
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

            {/* Global Sticky Table Header (Desktop Only) */}
            <div className="hidden md:flex items-center border-t border-gray-100 pt-3 text-[10px] font-bold text-gray-400 select-none uppercase tracking-wider">
              {/* Left indicator spacer */}
              <div className="w-[3px] self-stretch shrink-0 bg-transparent" />
              
              {/* Checkbox wrapper */}
              <div className="flex items-center pl-3 shrink-0 w-16">
                <div
                  className="flex size-4 items-center justify-center rounded border transition-colors cursor-pointer"
                  onClick={toggleAll}
                >
                  <div className={cn(
                    "flex size-4 items-center justify-center rounded border transition-colors",
                    allSelected
                      ? "border-primary bg-primary text-primary-foreground"
                      : someSelected
                        ? "border-primary bg-primary/20"
                        : "border-gray-300 hover:border-gray-400 bg-white",
                  )}>
                    {allSelected && <CheckIcon className="size-2.5" weight="bold" />}
                    {someSelected && !allSelected && <div className="size-1.5 rounded-sm bg-primary" />}
                  </div>
                </div>
              </div>

              <div className="flex-1 py-1 pr-4 pl-1">Name</div>
              <div className="w-36 shrink-0 py-1 px-4">Assignee</div>
              <div className="w-28 shrink-0 py-1 px-4">Due Date</div>
              <div className="w-28 shrink-0 py-1 px-4">Priority</div>
              <div className="w-40 shrink-0 text-right pr-4">Actions</div>
            </div>
          </div>

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
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onCreateTask={setCreateForStatusId}
                statuses={statuses}
              />
            ))}
          </div>

          {/* Archived tasks section */}
          {archivedTasks && archivedTasks.length > 0 && (
            <div className="mt-6 border border-gray-100 rounded-xl overflow-hidden bg-gray-50/50">
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-100/60 text-xs font-bold text-gray-500 uppercase tracking-wide border-b border-gray-100 select-none">
                <ArchiveIcon className="size-4" />
                Archived ({archivedTasks.length})
              </div>
              <div className="divide-y divide-gray-100">
                {archivedTasks.map((t) => (
                  <div
                    key={t.id}
                    className="group flex items-center gap-3 px-4 py-2 hover:bg-slate-50 transition-colors"
                  >
                    <span className="text-2xs text-gray-400 font-mono shrink-0 select-none">#{t.seqNumber}</span>
                    <span className="flex-1 text-[13px] text-gray-400 font-medium line-through truncate">{t.title}</span>
                    <button
                      onClick={async () => {
                        await unarchiveTask(workspaceId, spaceId, listId, t.id);
                        await onArchivedChanged?.();
                      }}
                      className="hidden group-hover:flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-2xs font-semibold text-gray-600 hover:text-gray-900 transition-colors cursor-pointer select-none"
                    >
                      <ArchiveIcon className="size-3.5 text-gray-400" />
                      Unarchive
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Drag Overlay visual preview */}
        <DragOverlay>
          {activeTask && (
            <div className="flex items-center bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-2 w-full max-w-lg cursor-grabbing text-sm border-l-[3px]" style={{ borderLeftColor: statuses.find(s => s.id === activeTask.statusId)?.color || "#6B7280" }}>
              <div className="flex size-4 items-center justify-center rounded border border-gray-300 mr-3">
                {selectedIds.has(activeTask.id) && <CheckIcon className="size-2.5 text-primary" weight="bold" />}
              </div>
              <span className="text-2xs text-gray-400 font-mono mr-2">#{activeTask.seqNumber}</span>
              <span className="font-semibold text-gray-800 truncate">{activeTask.title}</span>
            </div>
          )}
        </DragOverlay>
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
