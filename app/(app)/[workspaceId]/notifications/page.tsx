"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import useSWR, { mutate as globalMutate } from "swr";
import { CheckIcon, EnvelopeIcon, EnvelopeOpenIcon, TrashIcon } from "@phosphor-icons/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState<Tab>("all");

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
  }

  async function markAllRead() {
    await fetch("/api/me/notifications/read-all", { method: "PATCH" });
    await sync();
  }

  async function clearAll() {
    await fetch("/api/me/notifications", { method: "DELETE" });
    await sync();
  }

  function handleRowClick(n: Notification) {
    if (!n.isRead) void markRead(n.id);
    if (n.entityType === "TASK") {
      router.push(`/${n.workspaceId}/task/${n.entityId}`);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="flex items-center justify-between border-b px-6 py-4 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Inbox</h1>
          {unreadCount > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[11px] font-semibold text-white leading-none">
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
      <div className="flex items-center gap-1 border-b px-6 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "px-1 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer",
              activeTab === t.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
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

        {notifications.map((n) => (
          <div
            key={n.id}
            onClick={() => handleRowClick(n)}
            className={cn(
              "group relative flex cursor-pointer items-center gap-4 border-b px-6 py-3.5 transition-colors hover:bg-accent/40",
              !n.isRead && "bg-blue-50/60 dark:bg-blue-950/20",
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
              <p className={cn("text-sm leading-snug truncate", !n.isRead && "font-medium")}>
                {n.title}
              </p>
              {n.body && (
                <p className="mt-0.5 text-xs text-muted-foreground truncate italic">
                  {n.body}
                </p>
              )}
            </div>

            {/* Timestamp — hidden on hover, replaced by actions */}
            <span className="text-xs text-muted-foreground shrink-0 group-hover:hidden">
              {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
            </span>

            {/* Hover actions */}
            <div className="hidden group-hover:flex items-center gap-1 shrink-0">
              {n.isRead ? (
                <ActionButton
                  onClick={(e) => void markUnread(n.id, e)}
                  title="Mark as unread"
                  icon={<EnvelopeIcon className="size-3.5" />}
                />
              ) : (
                <ActionButton
                  onClick={(e) => void markRead(n.id, e)}
                  title="Mark as read"
                  icon={<EnvelopeOpenIcon className="size-3.5" />}
                />
              )}
              <ActionButton
                onClick={(e) => void dismiss(n.id, e)}
                title="Clear"
                icon={<CheckIcon className="size-3.5" />}
                label="Clear"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  title,
  icon,
  label,
}: {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  icon: React.ReactNode;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        label && "font-medium",
      )}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}
