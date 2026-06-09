"use client";

import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface LogEntry {
  createdAt: string;
  id: string;
  message: string;
}

interface LifecycleLogProps {
  logs: LogEntry[];
}

export function LifecycleLog({ logs }: LifecycleLogProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return logs;
    }
    return logs.filter((l) => l.message.toLowerCase().includes(needle));
  }, [logs, search]);

  if (logs.length === 0) {
    return (
      <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
        No activity recorded.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="relative w-full sm:max-w-xs">
          <MagnifyingGlassIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="pl-8"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity…"
            value={search}
          />
          {search && (
            <Button
              aria-label="Clear search"
              className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
              onClick={() => setSearch("")}
              size="icon"
              type="button"
              variant="ghost"
            >
              <XIcon className="size-3.5" />
            </Button>
          )}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {filtered.length} of {logs.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
          No entries match the search.
        </p>
      ) : (
        <div className="relative space-y-0">
          <div className="absolute top-2 bottom-2 left-1.75 w-px bg-border" />

          {filtered.map((log) => (
            <div className="relative flex items-start gap-4 py-2" key={log.id}>
              <div className="relative z-10 mt-1.5 size-3.75 shrink-0 rounded-full border-2 border-border bg-background" />

              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{log.message}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(log.createdAt), {
                    addSuffix: true,
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
