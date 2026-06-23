"use client";

import * as React from "react";
import { BellIcon } from "@phosphor-icons/react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { NotificationPanel } from "./notification-panel";

interface NotificationsResponse {
  notifications: unknown[];
  unreadCount: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function NotificationBell() {
  const [open, setOpen] = React.useState(false);
  const { data } = useSWR<NotificationsResponse>(
    "/api/me/notifications?filter=unread",
    fetcher,
    { refreshInterval: 30000 },
  );

  const unreadCount = data?.unreadCount ?? 0;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative size-8 shrink-0"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
      >
        <BellIcon className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-2xs font-medium text-white leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>
      <NotificationPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
