"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArchiveIcon,
  CalendarBlankIcon,
  CaretDownIcon,
  CaretRightIcon,
  CopyIcon,
  DotsThreeIcon,
  FlagIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
} from "@phosphor-icons/react";
import { archiveTask, deleteTask, duplicateTask } from "@/app/actions/task";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  NONE:   { label: "—",      color: "text-muted-foreground/40",  dot: "" },
  LOW:    { label: "Low",    color: "text-blue-500",              dot: "bg-blue-500" },
  MEDIUM: { label: "Medium", color: "text-yellow-500",            dot: "bg-yellow-500" },
  HIGH:   { label: "High",   color: "text-orange-500",            dot: "bg-orange-500" },
  URGENT: { label: "Urgent", color: "text-red-500",               dot: "bg-red-500" },
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
  onOpen,
}: {
  task: Task;
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
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
    <tr
      className="group/row border-b border-border/50 hover:bg-accent/30 cursor-pointer transition-colors"
      onClick={onOpen}
    >
      {/* Name */}
      <td className="py-2.5 pl-10 pr-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-muted-foreground/50 font-mono shrink-0 w-6">#{task.seqNumber}</span>
          <span className="text-sm font-semibold truncate">{task.title}</span>
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
      </td>

      {/* Assignee */}
      <td className="py-2.5 px-4 w-36">
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
      </td>

      {/* Due date */}
      <td className="py-2.5 px-4 w-28">
        {dueDate ? (
          <span className={cn("text-xs font-medium", dueDate.overdue ? "text-red-500" : "text-muted-foreground")}>
            {dueDate.label}
          </span>
        ) : (
          <CalendarBlankIcon className="size-4 text-muted-foreground/30" />
        )}
      </td>

      {/* Priority */}
      <td className="py-2.5 px-4 w-28">
        {task.priority !== "NONE" ? (
          <span className={cn("flex items-center gap-1.5 text-xs font-medium", priority.color)}>
            <span className={cn("size-2 rounded-full shrink-0", priority.dot)} />
            {priority.label}
          </span>
        ) : (
          <FlagIcon className="size-4 text-muted-foreground/30" />
        )}
      </td>

      {/* Actions */}
      <td className="py-2.5 pr-3 w-10" onClick={(e) => e.stopPropagation()}>
        <Popover>
          <PopoverTrigger asChild>
            <button className="opacity-0 group-hover/row:opacity-100 flex size-7 items-center justify-center rounded-md hover:bg-accent transition-opacity ml-auto">
              <DotsThreeIcon className="size-4 text-muted-foreground" />
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
      </td>
    </tr>
  );
}

// ─── Status group row ─────────────────────────────────────────────────────────

function StatusGroupRows({
  status,
  tasks,
  workspaceId,
  spaceId,
  listId,
  isAdmin,
  onCreateTask,
}: {
  status: Status;
  tasks: Task[];
  workspaceId: string;
  spaceId: string;
  listId: string;
  isAdmin?: boolean;
  onCreateTask: (statusId: string) => void;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <>
      {/* Status group header row */}
      <tr className="bg-muted/20">
        <td colSpan={5} className="py-2 pl-4 pr-3">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex items-center gap-2 select-none"
          >
            {collapsed
              ? <CaretRightIcon className="size-3.5 text-muted-foreground shrink-0" />
              : <CaretDownIcon className="size-3.5 text-muted-foreground shrink-0" />
            }
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: `${status.color}18`, color: status.color }}
            >
              <span className="size-1.5 rounded-full" style={{ backgroundColor: status.color }} />
              {status.name}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
          </button>
        </td>
      </tr>

      {/* Task rows */}
      {!collapsed && (
        <>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              workspaceId={workspaceId}
              spaceId={spaceId}
              listId={listId}
              isAdmin={isAdmin}
              onOpen={() => router.push(`/${workspaceId}/task/${task.id}`)}
            />
          ))}

          {/* Add task row */}
          <tr>
            <td colSpan={5} className="py-0">
              <button
                onClick={() => onCreateTask(status.id)}
                className="flex w-full items-center gap-2 pl-10 pr-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/20 transition-colors"
              >
                <PlusIcon className="size-3.5 shrink-0" />
                Add Task
              </button>
            </td>
          </tr>
        </>
      )}
    </>
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
        <table className="w-full border-collapse">
          {/* Sticky column headers */}
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="py-2.5 pl-10 pr-4 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">Name</th>
              <th className="py-2.5 px-4 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase w-36">Assignee</th>
              <th className="py-2.5 px-4 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase w-28">Due date</th>
              <th className="py-2.5 px-4 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase w-28">Priority</th>
              <th className="w-10" />
            </tr>
          </thead>

          <tbody>
            {statuses.map((status, i) => (
              <React.Fragment key={status.id}>
                {i > 0 && (
                  <tr aria-hidden>
                    <td colSpan={5} className="py-2 bg-transparent border-none" />
                  </tr>
                )}
                <StatusGroupRows
                  status={status}
                  tasks={tasksByStatus.get(status.id) ?? []}
                  workspaceId={workspaceId}
                  spaceId={spaceId}
                  listId={listId}
                  isAdmin={isAdmin}
                  onCreateTask={setCreateForStatusId}
                />
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
