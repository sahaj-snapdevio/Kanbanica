"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import useSWR, { mutate } from "swr";
import { CheckIcon, XIcon } from "@phosphor-icons/react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
}

export function NotificationPanel({ open, onClose }: NotificationPanelProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState<
    "all" | "unread" | "mentions"
  >("all");

  const {
    data,
    isLoading,
    mutate: revalidate,
  } = useSWR<NotificationsResponse>(
    open ? `/api/me/notifications?filter=${activeTab}` : null,
    fetcher,
    { refreshInterval: open ? 15000 : 0 },
  );

  const notifications = data?.notifications ?? [];

  async function markAllRead() {
    await fetch("/api/me/notifications/read-all", { method: "PATCH" });
    await revalidate();
    // Also revalidate the bell count
    await mutate("/api/me/notifications?filter=unread");
  }

  async function markRead(id: string) {
    await fetch(`/api/me/notifications/${id}/read`, { method: "PATCH" });
    await revalidate();
    await mutate("/api/me/notifications?filter=unread");
  }

  async function deleteNotification(id: string) {
    await fetch(`/api/me/notifications/${id}`, { method: "DELETE" });
    await revalidate();
    await mutate("/api/me/notifications?filter=unread");
  }

  function handleNotificationClick(n: Notification) {
    if (!n.isRead) {
      void markRead(n.id);
    }
    // Navigate to entity
    if (n.entityType === "TASK") {
      router.push(`/${n.workspaceId}/task/${n.entityId}`);
      onClose();
    }
  }

  function getActorInitials(name: string | null): string {
    if (!name) return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col p-0 sm:max-w-md rounded-l-[20px]"
      >
        <SheetHeader className="relative border-b px-4 pt-3 pb-2 flex flex-col gap-1">
          {/* Row 1: Title + Close button */}
          <div className="flex items-center justify-between pr-6">
            <SheetTitle>Notifications</SheetTitle>
          </div>

          {/* Row 2: Mark all as read */}
          <Button
            variant="ghost"
            size="sm"
            onClick={markAllRead}
            className="text-xs w-fit h-7 px-2 cursor-pointer -ml-1 text-muted-foreground hover:text-foreground"
          >
            <CheckIcon className="mr-1 size-3" />
            Mark all as read
          </Button>

          {/* Row 3: Tabs */}
          <div className="pt-1">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as typeof activeTab)}
            >
              <TabsList className="h-8 rounded-[20px] p-2">
                <TabsTrigger
                  value="all"
                  className="text-xs px-3 h-7 rounded-[20px] cursor-pointer"
                >
                  All
                </TabsTrigger>
                <TabsTrigger
                  value="unread"
                  className="text-xs px-3 h-7 rounded-[20px] cursor-pointer"
                >
                  Unread
                </TabsTrigger>
                <TabsTrigger
                  value="mentions"
                  className="text-xs px-3 h-7 rounded-[20px] cursor-pointer"
                >
                  Mentions
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              Loading…
            </div>
          )}
          {!isLoading && notifications.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm font-medium text-muted-foreground">
                No notifications
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                You&apos;re all caught up!
              </p>
            </div>
          )}
          {notifications.map((n) => (
            <div
              key={n.id}
              className={cn(
                "group relative flex cursor-pointer items-start gap-3 border-b px-4 py-3 transition-colors hover:bg-accent/50",
                !n.isRead && "bg-blue-50/50 dark:bg-blue-950/20",
              )}
              onClick={() => handleNotificationClick(n)}
            >
              {/* Unread dot */}
              {!n.isRead && (
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
              )}
              {n.isRead && <span className="mt-2 h-2 w-2 shrink-0" />}

              {/* Actor avatar */}
              <Avatar className="mt-0.5 size-7 shrink-0">
                <AvatarFallback className="text-xs">
                  {getActorInitials(n.actorName)}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                <p className="text-sm leading-snug">{n.title}</p>
                {n.body && (
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                    {n.body}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(n.createdAt), {
                    addSuffix: true,
                  })}
                </p>
              </div>

              {/* Delete button */}
              <button
                className="absolute right-2 top-2 hidden size-5 items-center justify-center rounded hover:bg-accent group-hover:flex"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteNotification(n.id);
                }}
                title="Dismiss"
              >
                <XIcon className="size-3 text-muted-foreground" />
              </button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
