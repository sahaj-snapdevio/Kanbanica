"use client";

import { ClipboardIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Status {
  id: string;
  name: string;
  color: string;
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

interface ListViewProps {
  statuses: Status[];
  tasks: Task[];
}

const PRIORITY_DOT: Record<Task["priority"], string> = {
  NONE: "bg-muted-foreground/30",
  LOW: "bg-blue-500",
  MEDIUM: "bg-yellow-500",
  HIGH: "bg-orange-500",
  URGENT: "bg-red-500",
};

export function ListView({ statuses, tasks }: ListViewProps) {
  const statusById = Object.fromEntries(statuses.map((s) => [s.id, s]));

  if (tasks.length === 0) {
    return (
      <Card>
        <CardContent className="py-14 flex flex-col items-center text-center gap-3">
          <ClipboardIcon className="size-10 text-muted-foreground/40" weight="duotone" />
          <div className="space-y-1">
            <h2 className="font-medium">This list has no tasks yet</h2>
            <p className="text-sm text-muted-foreground">
              Add your first task to start tracking work
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0 divide-y">
        {tasks.map((t) => {
          const status = statusById[t.statusId];
          return (
            <div key={t.id} className="flex items-center gap-3 px-4 py-3">
              {/* Priority dot */}
              <span
                className={cn("shrink-0 h-2 w-2 rounded-full", PRIORITY_DOT[t.priority])}
                title={t.priority !== "NONE" ? t.priority : undefined}
              />

              {/* Status badge */}
              {status && (
                <span
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: `${status.color}1A`, color: status.color }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: status.color }}
                  />
                  {status.name}
                </span>
              )}

              {/* Title */}
              <p className="flex-1 min-w-0 truncate text-sm font-medium">{t.title}</p>

              {/* Tags */}
              {t.tags.map((tag) => (
                <Badge key={tag.id} variant="secondary" className="shrink-0 hidden sm:inline-flex">
                  {tag.name}
                </Badge>
              ))}

              {/* Seq number */}
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                #{t.seqNumber}
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
