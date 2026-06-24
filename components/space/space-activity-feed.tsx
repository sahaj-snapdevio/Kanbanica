"use client";

import {
  ActivityIcon,
  CaretLeftIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import { format, formatDistanceToNow } from "date-fns";
import Link from "next/link";
import * as React from "react";
import {
  getSpaceActivity,
  type SpaceActivityEntry,
} from "@/app/actions/space-activity";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface SpaceActivityFeedProps {
  spaceId: string;
  workspaceId: string;
}

function initials(name: string | null, email: string | null) {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return (email ?? "?").slice(0, 2).toUpperCase();
}

function describeEvent(
  eventType: string,
  meta: Record<string, unknown>
): string {
  switch (eventType) {
    case "task_created":
      return "created this task";
    case "title_changed":
      return `renamed to "${meta.to}"`;
    case "status_changed":
      return `changed status → ${meta.to_status_name ?? meta.to}`;
    case "priority_changed":
      return `changed priority to ${meta.to}`;
    case "description_updated":
      return "updated the description";
    case "assignee_added":
      return `assigned ${meta.user_name ?? "someone"}`;
    case "assignee_removed":
      return `unassigned ${meta.user_name ?? "someone"}`;
    case "due_date_set":
      return `set due date to ${meta.date}`;
    case "due_date_changed":
      return "changed due date";
    case "due_date_removed":
      return "removed due date";
    case "tag_added":
      return `added tag "${meta.tagName}"`;
    case "tag_removed":
      return `removed tag "${meta.tagName}"`;
    case "task_archived":
      return "archived this task";
    case "task_unarchived":
      return "unarchived this task";
    case "task_moved":
      return "moved this task";
    case "comment_added":
      return "commented";
    case "attachment_uploaded":
      return `uploaded "${meta.file_name}"`;
    case "subtask_created":
      return `added subtask "${meta.subtask_title}"`;
    case "sprint_assigned":
      return `added to ${meta.sprint_name}`;
    default:
      return eventType.replace(/_/g, " ");
  }
}

export function SpaceActivityFeed({
  workspaceId,
  spaceId,
}: SpaceActivityFeedProps) {
  const [entries, setEntries] = React.useState<SpaceActivityEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(false);

  const load = React.useCallback(
    async (p: number) => {
      setLoading(true);
      const res = await getSpaceActivity(workspaceId, spaceId, p);
      if (!("error" in res)) {
        setEntries(res.entries);
        setHasMore(res.entries.length === 50);
      }
      setLoading(false);
    },
    [workspaceId, spaceId]
  );

  React.useEffect(() => {
    void load(page);
  }, [load, page]);

  return (
    <div className="p-6 max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ActivityIcon className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">Space Activity</h1>
        <span className="text-sm text-muted-foreground">· last 30 days</span>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3, 4, 5].map((i) => (
            <div className="flex gap-3 p-3 rounded-lg border" key={i}>
              <div className="size-8 rounded-full bg-muted shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-muted rounded w-1/3" />
                <div className="h-3 bg-muted rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border bg-card flex flex-col items-center gap-3 py-16 text-center">
          <ActivityIcon className="size-10 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">
            No activity in the last 30 days
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border bg-card divide-y overflow-hidden">
            {entries.map((entry) => (
              <div
                className="flex items-start gap-3 px-4 py-3 hover:bg-accent/20 transition-colors"
                key={entry.id}
              >
                <Avatar className="size-7 shrink-0 mt-0.5">
                  {entry.actorImage && <AvatarImage src={entry.actorImage} />}
                  <AvatarFallback className="text-2xs bg-primary/10 text-primary">
                    {initials(entry.actorName, entry.actorEmail)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">
                      {entry.actorName ?? entry.actorEmail ?? "System"}
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {describeEvent(
                        entry.eventType,
                        entry.meta as Record<string, unknown>
                      )}
                    </span>
                    {" · "}
                    <Link
                      className="font-medium hover:underline text-foreground"
                      href={`/${workspaceId}/task/${entry.taskId}`}
                    >
                      #{entry.taskSeq} {entry.taskTitle}
                    </Link>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <span className="text-muted-foreground/60">
                      {entry.listName} ·{" "}
                    </span>
                    <span title={format(new Date(entry.createdAt), "PPpp")}>
                      {formatDistanceToNow(new Date(entry.createdAt), {
                        addSuffix: true,
                      })}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <CaretLeftIcon className="size-4" /> Previous
            </button>
            <span className="text-sm text-muted-foreground">Page {page}</span>
            <button
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              disabled={!hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next <CaretRightIcon className="size-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
