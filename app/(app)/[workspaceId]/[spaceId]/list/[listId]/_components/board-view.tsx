"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  MagnifyingGlassIcon,
  ArrowsDownUpIcon,
  FunnelIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { updateTaskStatus } from "@/app/actions/task";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CreateTaskModal } from "@/components/task/create-task-modal";
import { cn } from "@/lib/utils";
import { QuickCreateTask } from "./quick-create-task";

function userInitials(name: string) {
  if (!name) return "?";
  const clean = name.includes("@") ? name.split("@")[0] : name;
  return clean.split(/[\s._-]+/).map((n) => n[0]).filter(Boolean).join("").toUpperCase().slice(0, 2) || "?";
}

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
  tags: { id: string; name: string; color: string }[];
  assignees: { userId: string; name: string; image: string | null }[];
}

interface BoardViewProps {
  workspaceId: string;
  space: { id: string; name: string; color: string | null };
  list: { id: string; name: string; color?: string | null; description?: string | null };
  statuses: Status[];
  tasks: Task[];
  headerless?: boolean;
  canEdit?: boolean;
  isAdmin?: boolean;
  members?: { userId: string; name: string | null; email: string | null }[];
  tags?: { id: string; name: string; color: string }[];
}

const PRIORITY_ORDER: Record<Task["priority"], number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
};

const PRIORITY_CONFIG: Record<Task["priority"], { label: string; color: string; icon: string }> = {
  NONE:   { label: "No Priority", color: "text-gray-400",    icon: "😴" },
  LOW:    { label: "Low",         color: "text-gray-500",    icon: "🐢" },
  MEDIUM: { label: "Medium",      color: "text-yellow-600",  icon: "🚶" },
  HIGH:   { label: "High",        color: "text-orange-500",  icon: "🏃" },
  URGENT: { label: "Urgent",      color: "text-red-500",     icon: "⚡" },
};

// ─── Card visual (no dnd hooks) ──────────────────────────────────────────────

function CardContent({
  task,
  overlay = false,
  isDragging = false,
  dragListeners,
}: {
  task: Task;
  overlay?: boolean;
  isDragging?: boolean;
  dragListeners?: React.HTMLAttributes<HTMLDivElement>;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 shadow-sm",
        isDragging && "opacity-40 shadow-none border-dashed",
        overlay && "shadow-xl rotate-1 cursor-grabbing",
        !isDragging && !overlay && "hover:shadow-md transition-shadow",
      )}
    >
      <div {...dragListeners} className={cn(!overlay && "cursor-grab active:cursor-grabbing")}>
        <p className="text-[13px] font-medium text-gray-800 leading-snug select-none line-clamp-2">{task.title}</p>
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
          <span className="font-mono text-2xs text-gray-400 shrink-0">#{task.seqNumber}</span>
          <div className="flex items-center gap-2 min-w-0">
            {task.priority !== "NONE" && (() => {
              const cfg = PRIORITY_CONFIG[task.priority];
              return cfg ? (
                <span className={cn("flex items-center gap-1 text-xs font-bold shrink-0", cfg.color)}>
                  <span>{cfg.icon}</span>
                  {cfg.label}
                </span>
              ) : null;
            })()}
            {task.assignees.length > 0 && (
              <div className="flex -space-x-1.5 ml-auto">
                {task.assignees.slice(0, 3).map((a) => (
                  <Avatar key={a.userId} className="size-7 border-2 border-background" title={a.name}>
                    {a.image && <AvatarImage src={a.image} alt={a.name} />}
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

// ─── Sortable task card ───────────────────────────────────────────────────────

function TaskCard({ task, workspaceId }: { task: Task; workspaceId: string }) {
  const router = useRouter();
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

  // Wrap listeners to allow click-through when not dragging
  const clickableListeners = {
    ...listeners,
    onClick: (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDragging) {
        e.stopPropagation();
        router.push(`/${workspaceId}/task/${task.id}?from=board`);
      }
    },
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <CardContent
        task={task}
        isDragging={isDragging}
        dragListeners={clickableListeners}
      />
    </div>
  );
}

// ─── Column (droppable) ───────────────────────────────────────────────────────

function Column({
  status,
  tasks,
  workspaceId,
  space,
  list,
}: {
  status: Status;
  tasks: Task[];
  workspaceId: string;
  space: BoardViewProps["space"];
  list: BoardViewProps["list"];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });

  return (
    <div
      className="flex w-64 shrink-0 flex-col rounded-xl p-2 gap-2 max-h-[calc(100vh-11rem)]"
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

      {/* Droppable task list — flex-1 + overflow-y-auto gives each column its own scroll */}
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
            <TaskCard key={t.id} task={t} workspaceId={workspaceId} />
          ))}
        </div>
      </SortableContext>

      <QuickCreateTask
        workspaceId={workspaceId}
        spaceId={space.id}
        listId={list.id}
        statusId={status.id}
        placeholder="Add task"
      />
    </div>
  );
}

// ─── Board ────────────────────────────────────────────────────────────────────

export function BoardView({ workspaceId, space, list, statuses, tasks, members = [] }: BoardViewProps) {
  // Local task state for optimistic drag updates
  const [localTasks, setLocalTasks] = React.useState<Task[]>(tasks);
  const [activeTask, setActiveTask] = React.useState<Task | null>(null);

  // Sync when server data changes
  React.useEffect(() => { setLocalTasks(tasks); }, [tasks]);

  // ── Toolbar state ─────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [sortBy, setSortBy] = React.useState<"name" | "priority" | null>(null);
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("asc");

  // Local filter state (mirrors list-view pattern)
  const [statusFilter, setStatusFilter] = React.useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = React.useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = React.useState<string[]>([]);

  const hasActiveFilters = statusFilter.length > 0 || priorityFilter.length > 0 || assigneeFilter.length > 0;

  // ── Filtered + sorted tasks (for display) ────────────────────────────────
  const processedTasks = React.useMemo(() => {
    let result = localTasks.filter((t) => {
      if (searchQuery.trim() && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (statusFilter.length && !statusFilter.includes(t.statusId)) return false;
      if (priorityFilter.length && !priorityFilter.includes(t.priority)) return false;
      if (assigneeFilter.length) {
        const hasUnassigned = assigneeFilter.includes("unassigned");
        const userIds = assigneeFilter.filter((a) => a !== "unassigned");
        const assigneeIds = t.assignees.map((a) => a.userId);
        const matchUnassigned = hasUnassigned && assigneeIds.length === 0;
        const matchUser = userIds.length > 0 && assigneeIds.some((id) => userIds.includes(id));
        if (!matchUnassigned && !matchUser) return false;
      }
      return true;
    });

    if (sortBy === "name") {
      result = [...result].sort((a, b) =>
        sortOrder === "asc" ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title),
      );
    } else if (sortBy === "priority") {
      result = [...result].sort((a, b) => {
        const diff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        return sortOrder === "asc" ? diff : -diff;
      });
    }

    return result;
  }, [localTasks, searchQuery, statusFilter, priorityFilter, assigneeFilter, sortBy, sortOrder]);

  // tasksByStatus uses processed tasks for display; DnD handlers still use localTasks
  const tasksByStatus = React.useMemo(() => {
    const map: Record<string, Task[]> = Object.fromEntries(statuses.map((s) => [s.id, []]));
    for (const t of processedTasks) {
      if (map[t.statusId]) map[t.statusId].push(t);
    }
    return map;
  }, [processedTasks, statuses]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function findStatusForTask(taskId: string) {
    return localTasks.find((t) => t.id === taskId)?.statusId ?? null;
  }

  function onDragStart({ active }: DragStartEvent) {
    setActiveTask(localTasks.find((t) => t.id === active.id) ?? null);
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeStatus = findStatusForTask(activeId);
    // over could be a column (statusId) or another task
    const overStatus = statuses.find((s) => s.id === overId)?.id
      ?? findStatusForTask(overId);

    if (!activeStatus || !overStatus || activeStatus === overStatus) return;

    // Optimistically move to new column
    setLocalTasks((prev) =>
      prev.map((t) => t.id === activeId ? { ...t, statusId: overStatus } : t),
    );
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    setActiveTask(null);
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const newStatus = statuses.find((s) => s.id === overId)?.id
      ?? findStatusForTask(overId);

    const originalStatus = tasks.find((t) => t.id === activeId)?.statusId;

    if (!newStatus || newStatus === originalStatus) return;

    // Persist to server
    const res = await updateTaskStatus(workspaceId, space.id, list.id, activeId, newStatus);
    if ("error" in res) {
      // Revert on failure
      setLocalTasks(tasks);
    }
  }

  return (
    <>
      <CreateTaskModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        spaceId={space.id}
        listId={list.id}
        statuses={statuses}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-gray-400 pointer-events-none" />
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
                {hasActiveFilters && (
                  <span className="ml-1 size-2 rounded-full bg-primary" />
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-3 space-y-4">
              {/* Status filter */}
              <div>
                <p className="mb-1.5 text-2xs font-bold text-gray-400 uppercase tracking-wide">Status</p>
                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                  {statuses.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer py-0.5 hover:bg-gray-50 rounded">
                      <input
                        type="checkbox"
                        checked={statusFilter.includes(s.id)}
                        onChange={(e) => {
                          setStatusFilter((prev) => e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id));
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
                  {["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"].map((p) => (
                    <label key={p} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer py-0.5 hover:bg-gray-50 rounded">
                      <input
                        type="checkbox"
                        checked={priorityFilter.includes(p)}
                        onChange={(e) => {
                          setPriorityFilter((prev) => e.target.checked ? [...prev, p] : prev.filter((v) => v !== p));
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
                    <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer py-0.5 hover:bg-gray-50 rounded">
                      <input
                        type="checkbox"
                        checked={assigneeFilter.includes("unassigned")}
                        onChange={(e) => {
                          setAssigneeFilter((prev) => e.target.checked ? [...prev, "unassigned"] : prev.filter((v) => v !== "unassigned"));
                        }}
                        className="rounded border-gray-300 text-primary focus:ring-primary size-3.5"
                      />
                      <span>Unassigned</span>
                    </label>
                    {members.map((m) => (
                      <label key={m.userId} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer py-0.5 hover:bg-gray-50 rounded">
                        <input
                          type="checkbox"
                          checked={assigneeFilter.includes(m.userId)}
                          onChange={(e) => {
                            setAssigneeFilter((prev) => e.target.checked ? [...prev, m.userId] : prev.filter((id) => id !== m.userId));
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
              <button onClick={() => { setSortBy("name"); setSortOrder((o) => o === "asc" ? "desc" : "asc"); }} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-gray-50 cursor-pointer", sortBy === "name" && "bg-gray-100 text-gray-900")}>Task Name</button>
              <button onClick={() => { setSortBy("priority"); setSortOrder((o) => o === "asc" ? "desc" : "asc"); }} className={cn("px-2 py-1.5 text-xs font-semibold text-left rounded hover:bg-gray-50 cursor-pointer", sortBy === "priority" && "bg-gray-100 text-gray-900")}>Priority</button>
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

      <DndContext
        id="board-dnd"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4 items-start">
          {statuses.map((status) => (
            <Column
              key={status.id}
              status={status}
              tasks={tasksByStatus[status.id] ?? []}
              workspaceId={workspaceId}
              space={space}
              list={list}
            />
          ))}
        </div>

        {/* Drag overlay — shown while dragging */}
        <DragOverlay>
          {activeTask && <CardContent task={activeTask} overlay />}
        </DragOverlay>
      </DndContext>
    </>
  );
}
