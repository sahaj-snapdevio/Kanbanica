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
import { updateTaskStatus } from "@/app/actions/task";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
}

const PRIORITY_COLORS: Record<Task["priority"], string> = {
  NONE: "text-muted-foreground",
  LOW: "text-blue-500",
  MEDIUM: "text-yellow-500",
  HIGH: "text-orange-500",
  URGENT: "text-red-500",
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
        <p className="text-sm font-semibold leading-snug select-none line-clamp-2">{task.title}</p>
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
          <span className="font-mono text-muted-foreground text-xs shrink-0">#{task.seqNumber}</span>
          <div className="flex items-center gap-2 min-w-0">
            {task.priority !== "NONE" && (
              <span className={cn("text-xs font-medium shrink-0", PRIORITY_COLORS[task.priority])}>
                {task.priority}
              </span>
            )}
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
      className="flex w-72 shrink-0 flex-col rounded-xl p-2 gap-2 self-start"
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
            "flex flex-col gap-2 rounded-lg p-1 transition-all",
            tasks.length === 0 ? "min-h-2" : "min-h-0",
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

export function BoardView({ workspaceId, space, list, statuses, tasks }: BoardViewProps) {
  // Local task state for optimistic drag updates
  const [localTasks, setLocalTasks] = React.useState<Task[]>(tasks);
  const [activeTask, setActiveTask] = React.useState<Task | null>(null);

  // Sync when server data changes
  React.useEffect(() => { setLocalTasks(tasks); }, [tasks]);

  const tasksByStatus = React.useMemo(() => {
    const map: Record<string, Task[]> = Object.fromEntries(statuses.map((s) => [s.id, []]));
    for (const t of localTasks) {
      if (map[t.statusId]) map[t.statusId].push(t);
    }
    return map;
  }, [localTasks, statuses]);

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
    <DndContext
      id="board-dnd"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
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
  );
}
