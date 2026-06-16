"use client";

import { useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { ListView } from "./list-view";
import { BoardView } from "./board-view";

type View = "list" | "board";

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

interface ListContainerProps {
  workspaceId: string;
  space: { id: string; name: string; color: string | null };
  list: { id: string; name: string };
  statuses: Status[];
  tasks: Task[];
}

const VIEWS: { key: View; label: string }[] = [
  { key: "list", label: "List" },
  { key: "board", label: "Board" },
];

export function ListContainer({ workspaceId, space, list, statuses, tasks }: ListContainerProps) {
  const [view, setView] = useState<View>("list");

  return (
    <div className="space-y-5 p-6">
      {/* Breadcrumb + view tabs */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            {space.color && (
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: space.color }}
              />
            )}
            {space.name}
          </span>
          <CaretRightIcon className="size-3.5 text-muted-foreground" />
          <h1 className="font-semibold">{list.name}</h1>
        </div>

        <div className="flex items-center gap-1 border-b">
          {VIEWS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                view === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Active view */}
      {view === "list" ? (
        <ListView statuses={statuses} tasks={tasks} />
      ) : (
        <BoardView
          workspaceId={workspaceId}
          space={space}
          list={list}
          statuses={statuses}
          tasks={tasks}
          headerless
        />
      )}
    </div>
  );
}
