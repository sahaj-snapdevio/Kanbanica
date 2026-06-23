"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import useSWR, { mutate as globalMutate } from "swr";
import { CheckIcon, EnvelopeIcon, EnvelopeOpenIcon, XIcon } from "@phosphor-icons/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { TaskDetailPanel } from "@/components/task/task-detail-panel";
import { getTaskLocation } from "@/app/actions/task";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  workspaceId: string;
  actorId: string | null;
  triggerType: string;
  entityType: string;
  entityId: string;
  title: string;
  body: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  actorName: string | null;
  actorImage: string | null;
}

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
}

interface TaskLocation {
  taskId: string;
  spaceId: string;
  listId: string | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Tab = "all" | "unread" | "mentions";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "mentions", label: "Mentions" },
];

function getInitials(name: string | null) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
}

export default function InboxPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [activeTab, setActiveTab] = React.useState<Tab>("all");
  const [selectedTask, setSelectedTask] = React.useState<TaskLocation | null>(null);

  const { data, isLoading, mutate: revalidate } = useSWR<NotificationsResponse>(
    `/api/me/notifications?filter=${activeTab}`,
    fetcher,
    { refreshInterval: 15000 },
  );

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  async function sync() {
    await revalidate();
    await globalMutate("/api/me/notifications?filter=unread");
  }

  async function markRead(id: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    await fetch(`/api/me/notifications/${id}/read`, { method: "PATCH" });
    await sync();
  }

  async function markUnread(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/me/notifications/${id}/unread`, { method: "PATCH" });
    await sync();
  }

  async function dismiss(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/me/notifications/${id}`, { method: "DELETE" });
    await sync();
    // Close panel if the dismissed notification's task is open
    setSelectedTask(null);
  }

  async function markAllRead() {
    await fetch("/api/me/notifications/read-all", { method: "PATCH" });
    await sync();
  }

  async function clearAll() {
    await fetch("/api/me/notifications", { method: "DELETE" });
    await sync();
    setSelectedTask(null);
  }

  async function handleRowClick(n: Notification) {
    if (!n.isRead) void markRead(n.id);
    if (n.entityType !== "TASK") return;

    // Already showing this task — toggle close
    if (selectedTask?.taskId === n.entityId) {
      setSelectedTask(null);
      return;
    }

    const result = await getTaskLocation(workspaceId, n.entityId);
    if ("error" in result) return;
    setSelectedTask({ taskId: n.entityId, spaceId: result.spaceId, listId: result.listId });
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Notification list */}
      <div className={cn(
        "flex flex-col h-full transition-all duration-200",
        selectedTask ? "w-105 shrink-0 border-r" : "flex-1",
      )}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Inbox</h1>
            {unreadCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-xs font-semibold text-white leading-none">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={markAllRead}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              Mark all as read
            </button>
            <span className="text-muted-foreground/30 select-none">|</span>
            <button
              onClick={clearAll}
              className="text-sm text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
            >
              Clear all
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b px-4 py-2 shrink-0">
          {TABS.map((t) => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {t.label}
                {t.key === "unread" && unreadCount > 0 && (
                  <span className={cn(
                    "flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-2xs font-semibold leading-none",
                    active ? "bg-foreground text-background" : "bg-blue-500 text-white",
                  )}>
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              Loading…
            </div>
          )}
          {!isLoading && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 gap-2">
              <p className="text-sm font-medium text-muted-foreground">You&apos;re all caught up</p>
              <p className="text-xs text-muted-foreground">No notifications here</p>
            </div>
          )}
          {notifications.map((n) => {
            const isSelected = selectedTask?.taskId === n.entityId;
            return (
              <div
                key={n.id}
                onClick={() => void handleRowClick(n)}
                className={cn(
                  "group relative flex cursor-pointer items-center gap-3 border-b px-4 py-3.5 transition-colors hover:bg-accent/40",
                  !n.isRead && "bg-blue-50/60 dark:bg-blue-950/20",
                  isSelected && "bg-accent",
                )}
              >
                {/* Unread dot */}
                <div className="w-2 shrink-0 flex justify-center">
                  {!n.isRead && <span className="h-2 w-2 rounded-full bg-blue-500 block" />}
                </div>

                {/* Avatar */}
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="text-xs bg-muted">
                    {getInitials(n.actorName)}
                  </AvatarFallback>
                </Avatar>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className={cn("text-sm leading-snug", !n.isRead ? "font-medium" : "text-muted-foreground")}>
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="mt-0.5 text-xs text-muted-foreground truncate italic">
                      {n.body}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground/70">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </p>
                </div>

                {/* Time → actions on hover */}
                <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                  {n.isRead ? (
                    <ActionBtn onClick={(e) => void markUnread(n.id, e)} title="Mark as unread">
                      <EnvelopeIcon className="size-3.5" />
                    </ActionBtn>
                  ) : (
                    <ActionBtn onClick={(e) => void markRead(n.id, e)} title="Mark as read">
                      <EnvelopeOpenIcon className="size-3.5" />
                    </ActionBtn>
                  )}
                  <ActionBtn onClick={(e) => void dismiss(n.id, e)} title="Clear" label="Clear">
                    <CheckIcon className="size-3.5" />
                  </ActionBtn>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Task detail panel — inline, not a Sheet */}
      {selectedTask && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-end border-b px-3 py-2 shrink-0">
            <button
              onClick={() => setSelectedTask(null)}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              title="Close"
            >
              <XIcon className="size-4" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <TaskDetailPanel
              inline
              open
              onOpenChange={(open) => { if (!open) setSelectedTask(null); }}
              taskId={selectedTask.taskId}
              workspaceId={workspaceId}
              spaceId={selectedTask.spaceId}
              listId={selectedTask.listId ?? ""}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ActionBtn({
  onClick, title, label, children,
}: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
    >
      {children}
      {label && <span className="font-medium">{label}</span>}
    </button>
  );
}
