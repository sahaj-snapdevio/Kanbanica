"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  HeartbeatIcon,
  QuestionIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";

interface HealthCheck {
  detail: string;
  name: string;
  status: "ok" | "warn" | "fail";
}

interface VersionRow {
  installed: string | null;
  name: string;
  pinned: string | null;
  pinnedAt: string | null;
  status: "match" | "behind" | "ahead" | "drift" | "missing" | "info";
}

export function ServerHealthCheck({ serverId }: { serverId: string }) {
  const [checks, setChecks] = useState<HealthCheck[] | null>(null);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runCheck() {
    setLoading(true);
    setError(null);
    setChecks(null);
    setVersions(null);
    try {
      const res = await fetch(`/api/orbit/servers/${serverId}/health`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setChecks(data.checks);
        setVersions(data.versions ?? []);
      }
    } catch {
      setError("Failed to run health check");
    } finally {
      setLoading(false);
    }
  }

  const okCount = checks?.filter((c) => c.status === "ok").length ?? 0;
  const warnCount = checks?.filter((c) => c.status === "warn").length ?? 0;
  const failCount = checks?.filter((c) => c.status === "fail").length ?? 0;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button onClick={runCheck} size="sm" variant="outline">
          <HeartbeatIcon className="mr-1.5 size-4" />
          Health Check
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Server Health Check</SheetTitle>
          <SheetDescription>
            Verify all components are installed and running correctly.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4 px-4 pb-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Connecting to server and running checks...
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {checks && (
            <>
              <div className="flex items-center gap-3 text-sm">
                {failCount === 0 && warnCount === 0 ? (
                  <Badge
                    className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                    variant="secondary"
                  >
                    All checks passed
                  </Badge>
                ) : failCount > 0 ? (
                  <Badge variant="destructive">{failCount} failed</Badge>
                ) : null}
                {warnCount > 0 && (
                  <Badge
                    className="border-yellow-500 text-yellow-600"
                    variant="outline"
                  >
                    {warnCount} warning(s)
                  </Badge>
                )}
                <span className="text-muted-foreground">
                  {okCount}/{checks.length} OK
                </span>
              </div>

              <div className="space-y-1">
                {checks.map((check) => (
                  <div
                    className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted/50"
                    key={check.name}
                  >
                    <div className="flex items-center gap-2">
                      {check.status === "ok" && (
                        <CheckCircleIcon
                          className="size-4 text-green-600"
                          weight="fill"
                        />
                      )}
                      {check.status === "warn" && (
                        <WarningIcon
                          className="size-4 text-yellow-500"
                          weight="fill"
                        />
                      )}
                      {check.status === "fail" && (
                        <XCircleIcon
                          className="size-4 text-destructive"
                          weight="fill"
                        />
                      )}
                      <span>{check.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {check.detail}
                    </span>
                  </div>
                ))}
              </div>

              {versions && versions.length > 0 ? (
                <PinnedVersionsSection versions={versions} />
              ) : null}

              <Button
                className="w-full"
                disabled={loading}
                onClick={runCheck}
                size="sm"
                variant="outline"
              >
                {loading ? <Spinner className="mr-2 size-4" /> : null}
                Re-run checks
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PinnedVersionsSection({ versions }: { versions: VersionRow[] }) {
  const drifted = versions.filter((v) => v.status !== "match");
  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Pinned versions</span>
        {drifted.length === 0 ? (
          <Badge
            className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            variant="secondary"
          >
            All match
          </Badge>
        ) : (
          <Badge
            className="border-yellow-500 text-yellow-600"
            variant="outline"
          >
            {drifted.length} drift
          </Badge>
        )}
      </div>
      <div className="space-y-1">
        {versions.map((row) => (
          <div
            className="flex items-start justify-between gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted/50"
            key={row.name}
          >
            <div className="flex items-center gap-2">
              <VersionStatusIcon status={row.status} />
              <span>{row.name}</span>
            </div>
            <div className="text-right">
              <div className="font-mono text-xs">
                {row.installed ?? "—"}
                {row.pinned &&
                row.status !== "match" &&
                row.status !== "info" ? (
                  <span className="text-muted-foreground"> / {row.pinned}</span>
                ) : null}
              </div>
              <div className="text-[10px] tracking-wide text-muted-foreground uppercase">
                {row.status === "match"
                  ? "installed = pinned"
                  : row.status === "behind"
                    ? "behind pin — rebuild + update images"
                    : row.status === "ahead"
                      ? "ahead of pin — bump constant in code"
                      : row.status === "drift"
                        ? "differ"
                        : row.status === "missing"
                          ? "not detected"
                          : "informational"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VersionStatusIcon({ status }: { status: VersionRow["status"] }) {
  if (status === "match") {
    return <CheckCircleIcon className="size-4 text-green-600" weight="fill" />;
  }
  if (status === "behind") {
    return <ArrowDownIcon className="size-4 text-yellow-500" weight="bold" />;
  }
  if (status === "ahead") {
    return <ArrowUpIcon className="size-4 text-blue-500" weight="bold" />;
  }
  if (status === "drift") {
    return <WarningIcon className="size-4 text-yellow-500" weight="fill" />;
  }
  if (status === "missing") {
    return <XCircleIcon className="size-4 text-destructive" weight="fill" />;
  }
  return (
    <QuestionIcon className="size-4 text-muted-foreground" weight="bold" />
  );
}
