"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

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
}

interface BoardViewProps {
  workspaceId: string;
  space: { id: string; name: string; color: string | null };
  list: { id: string; name: string };
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

export function BoardView({ workspaceId, space, list, statuses, tasks, headerless }: BoardViewProps) {
  const tasksByStatus = Object.fromEntries(statuses.map((s) => [s.id, [] as Task[]]));
  for (const t of tasks) {
    if (tasksByStatus[t.statusId]) tasksByStatus[t.statusId].push(t);
  }

  return (
    <div className="flex flex-col">
      {/* Board columns */}
      <div className="flex gap-3 overflow-x-auto">
        {statuses.map((status) => {
          const columnTasks = tasksByStatus[status.id] ?? [];
          return (
            <div key={status.id} className="flex w-72 shrink-0 flex-col gap-2">
              {/* Column header */}
              <div className="flex items-center gap-2 px-1">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: status.color }}
                />
                <span className="flex-1 font-medium text-sm">{status.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs">
                  {columnTasks.length}
                </span>
              </div>

              {/* Task cards */}
              <div className="flex flex-col gap-2">
                {columnTasks.map((t) => (
                  <div
                    key={t.id}
                    className="cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <p className="text-sm leading-snug">{t.title}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-mono text-muted-foreground text-xs">
                        #{t.seqNumber}
                      </span>
                      {t.priority !== "NONE" && (
                        <span className={cn("text-xs font-medium", PRIORITY_COLORS[t.priority])}>
                          {t.priority}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Add task button */}
              <button className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-muted-foreground text-sm transition-colors hover:border-border hover:bg-accent hover:text-foreground">
                <PlusIcon className="size-4" />
                Add task
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
