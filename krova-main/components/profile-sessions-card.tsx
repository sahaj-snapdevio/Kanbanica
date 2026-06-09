"use client";

import {
  DesktopIcon,
  DeviceMobileIcon,
  GlobeIcon,
  SignOutIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import {
  listUserSessions,
  revokeUserSession,
  signOutAllOtherSessions,
  type UserSessionRow,
} from "@/app/actions/profile";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

function parseUserAgent(ua: string | null): {
  label: string;
  isMobile: boolean;
} {
  if (!ua) {
    return { label: "Unknown device", isMobile: false };
  }
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  let browser = "Browser";
  if (/Chrome/i.test(ua) && !/Edg|OPR/i.test(ua)) {
    browser = "Chrome";
  } else if (/Firefox/i.test(ua)) {
    browser = "Firefox";
  } else if (/Safari/i.test(ua) && !/Chrome|Edg/i.test(ua)) {
    browser = "Safari";
  } else if (/Edg/i.test(ua)) {
    browser = "Edge";
  } else if (/OPR/i.test(ua)) {
    browser = "Opera";
  }
  let os = "";
  if (/Windows/i.test(ua)) {
    os = "Windows";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = "macOS";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  } else if (/iPhone|iPad/i.test(ua)) {
    os = "iOS";
  } else if (/Android/i.test(ua)) {
    os = "Android";
  }
  return {
    label: os ? `${browser} on ${os}` : browser,
    isMobile,
  };
}

export function ProfileSessionsCard() {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // SWR drives the initial fetch and any re-fetches after a mutation —
  // calling setState inside a useEffect would trip
  // `react-hooks/set-state-in-effect`. The fetcher returns the raw server-
  // action result; we unwrap the error/sessions shape at the render layer.
  const {
    data,
    error: swrError,
    mutate,
  } = useSWR("profile-sessions", async () => await listUserSessions());

  const sessions =
    data && !("error" in data)
      ? data.sessions
      : (null as UserSessionRow[] | null);
  const error =
    swrError instanceof Error
      ? swrError.message
      : data && "error" in data
        ? data.error
        : null;

  function handleRevoke(sessionId: string) {
    setPendingId(sessionId);
    startTransition(async () => {
      const res = await revokeUserSession(sessionId);
      setPendingId(null);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Session revoked");
      void mutate();
      router.refresh();
    });
  }

  function handleRevokeAll() {
    setRevokeAllOpen(false);
    startTransition(async () => {
      const res = await signOutAllOtherSessions();
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      const count = res.data?.revokedCount ?? 0;
      toast.success(
        count === 0
          ? "No other sessions were active"
          : `Signed out ${count} other ${count === 1 ? "session" : "sessions"}`
      );
      void mutate();
      router.refresh();
    });
  }

  const otherSessionCount = sessions?.filter((s) => !s.isCurrent).length ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Active Sessions</CardTitle>
          <CardDescription>
            Devices currently signed in to your account. Revoke any session you
            don&apos;t recognize.
          </CardDescription>
        </div>
        {otherSessionCount > 0 && (
          <Button
            disabled={isPending}
            onClick={() => setRevokeAllOpen(true)}
            size="sm"
            variant="outline"
          >
            <SignOutIcon className="size-4" />
            Sign out everywhere else
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {sessions ? (
          sessions.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No active sessions found.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {sessions.map((s) => {
                const ua = parseUserAgent(s.userAgent);
                const isBusy = isPending && pendingId === s.id;
                return (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    key={s.id}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        {ua.isMobile ? (
                          <DeviceMobileIcon className="size-4" />
                        ) : (
                          <DesktopIcon className="size-4" />
                        )}
                      </div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {ua.label}
                          </span>
                          {s.isCurrent && (
                            <Badge
                              className="border-emerald-500/20 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-400"
                              variant="outline"
                            >
                              This session
                            </Badge>
                          )}
                          {s.impersonatedBy && (
                            <Badge
                              className="border-amber-500/20 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-400"
                              variant="outline"
                            >
                              Impersonated
                            </Badge>
                          )}
                        </div>
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <GlobeIcon className="size-3.5" />
                          <span className="font-mono">
                            {s.ipAddress ?? "unknown IP"}
                          </span>
                          <span>·</span>
                          <span>
                            started{" "}
                            {formatDistanceToNow(new Date(s.createdAt), {
                              addSuffix: true,
                            })}
                          </span>
                        </p>
                      </div>
                    </div>
                    {!s.isCurrent && (
                      <Button
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={isPending}
                        onClick={() => handleRevoke(s.id)}
                        size="sm"
                        variant="ghost"
                      >
                        {isBusy ? (
                          <Spinner className="size-4" />
                        ) : (
                          <TrashIcon className="size-4" />
                        )}
                        Revoke
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Spinner className="size-4" />
            Loading sessions…
          </div>
        )}
      </CardContent>

      <ConfirmActionDialog
        busy={isPending}
        confirmLabel="Sign out everywhere else"
        description={
          <p>
            This will sign you out of every other browser and device you&apos;ve
            used. Your current session here stays signed in.
          </p>
        }
        onConfirm={handleRevokeAll}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeAllOpen(false);
          }
        }}
        open={revokeAllOpen}
        title="Sign out everywhere else?"
      />
    </Card>
  );
}
