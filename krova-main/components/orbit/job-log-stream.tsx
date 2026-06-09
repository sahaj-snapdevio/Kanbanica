"use client";

/**
 * Live job-log stream for a server's setup activity. Fetches recent entries
 * via SWR and appends new ones in real time as `job.log` events arrive on the
 * server's private Pusher channel. Entries are grouped by job (one group per
 * pg-boss job execution) and sorted within a group by sequence.
 *
 * Used inside <ServerSetupCard /> on the orbit server detail page.
 */

import {
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  CopyIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { usePusherChannel, usePusherEvent } from "@/hooks/use-pusher";
import { copyToClipboard } from "@/lib/clipboard";
import { fetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

type LogLevel = "info" | "warn" | "error";

interface JobLogRow {
  createdAt: string;
  durationMs: number | null;
  entityId: string;
  entityType: "server" | "cube" | "snapshot" | "backup";
  finishedAt: string | null;
  id: string;
  jobId: string;
  jobName: string;
  level: LogLevel;
  message: string;
  sequence: number;
  startedAt: string | null;
  stderr: string | null;
  stdout: string | null;
}

interface LiveEvent {
  durationMs: number | null;
  hasStderr: boolean;
  hasStdout: boolean;
  jobId: string;
  jobName: string;
  level: LogLevel;
  message: string;
  sequence: number;
}

interface JobGroup {
  endedAt: string;
  entries: NormalizedEntry[];
  hasError: boolean;
  isLive: boolean;
  jobId: string;
  jobName: string;
  startedAt: string;
}

interface NormalizedEntry {
  createdAt: string;
  durationMs: number | null;
  jobId: string;
  jobName: string;
  level: LogLevel;
  message: string;
  sequence: number;
  stderr: string | null;
  stdout: string | null;
}

const MAX_LIVE_ENTRIES = 1000;

const PHASE_NAME_LABELS: Record<string, string> = {
  "server.bootstrap": "Bootstrap",
  "server.install": "Install",
  "server.pull_images": "Pull Images",
  "server.network": "Network",
  "server.verify": "Verify",
};

function parseLiveEvent(payload: unknown): LiveEvent | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.jobId !== "string") {
    return null;
  }
  if (typeof p.jobName !== "string") {
    return null;
  }
  if (typeof p.sequence !== "number") {
    return null;
  }
  if (p.level !== "info" && p.level !== "warn" && p.level !== "error") {
    return null;
  }
  if (typeof p.message !== "string") {
    return null;
  }
  return {
    jobId: p.jobId,
    jobName: p.jobName,
    sequence: p.sequence,
    level: p.level,
    message: p.message,
    durationMs: typeof p.durationMs === "number" ? p.durationMs : null,
    hasStdout: p.hasStdout === true,
    hasStderr: p.hasStderr === true,
  };
}

function formatDuration(ms: number | null): string | null {
  if (ms == null) {
    return null;
  }
  if (ms < 1000) {
    return `${ms} ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export interface JobLogStreamProps {
  /** Pusher channel to subscribe to for live `job.log` events. Channel auth
   *  must gate the right audience (`private-server-*` for admin,
   *  `private-cube-*` for space members, etc.). */
  channelName: string;
  /** REST endpoint that returns `{ logs: JobLogRow[] }`. Customer- or
   *  admin-scoped depending on which wrapper instantiates this. */
  logsUrl: string;
}

export function JobLogStream({ logsUrl, channelName }: JobLogStreamProps) {
  const channel = usePusherChannel(channelName);
  // Pusher returns null when client config isn't initialized OR when subscription
  // hasn't completed yet. Either way, fall back to short-interval SWR polling so
  // the operator still sees progress even without realtime.
  const pusherLive = channel !== null;

  // Default SWR revalidation (focus + reconnect) catches anything Pusher missed
  // on transient disconnects. We ALSO poll unconditionally — fast (3s) when
  // Pusher is unavailable, slow (8s) as a safety net even when it's live.
  // The slow poll is deliberate: in practice we've seen `job.log` events
  // occasionally not reach the client (channel re-subscribe race during a
  // page route refresh), and without polling the activity panel goes stale
  // until the operator manually reloads.
  const { data } = useSWR<{ logs: JobLogRow[] }>(logsUrl, fetcher, {
    refreshInterval: pusherLive ? 8000 : 3000,
  });

  const [liveEntries, setLiveEntries] = useState<LiveEvent[]>([]);

  usePusherEvent(channel, "job.log", (payload: unknown) => {
    const evt = parseLiveEvent(payload);
    if (!evt) {
      return;
    }
    // Cap unbounded growth — keep the most recent N entries to bound memory
    // for long-running jobs without losing recent context.
    setLiveEntries((prev) => {
      const next = [...prev, evt];
      return next.length > MAX_LIVE_ENTRIES
        ? next.slice(-MAX_LIVE_ENTRIES)
        : next;
    });
  });

  // Merge persisted rows + live events. Dedupe by (jobId, sequence) so reloads
  // don't double-render entries that appeared via Pusher first then via SWR
  // refetch.
  const merged: NormalizedEntry[] = useMemo(() => {
    const map = new Map<string, NormalizedEntry>();
    const persisted = data?.logs ?? [];
    for (const r of persisted) {
      const key = `${r.jobId}:${r.sequence}`;
      map.set(key, {
        jobId: r.jobId,
        jobName: r.jobName,
        sequence: r.sequence,
        level: r.level,
        message: r.message,
        stdout: r.stdout,
        stderr: r.stderr,
        durationMs: r.durationMs,
        createdAt: r.createdAt,
      });
    }
    for (const e of liveEntries) {
      const key = `${e.jobId}:${e.sequence}`;
      if (map.has(key)) {
        continue;
      }
      map.set(key, {
        jobId: e.jobId,
        jobName: e.jobName,
        sequence: e.sequence,
        level: e.level,
        message: e.message,
        stdout: null,
        stderr: null,
        durationMs: e.durationMs ?? null,
        createdAt: new Date().toISOString(),
      });
    }
    return Array.from(map.values());
  }, [data?.logs, liveEntries]);

  // Group by jobId, ordered newest-job-first.
  const groups: JobGroup[] = useMemo(() => {
    const byJob = new Map<string, NormalizedEntry[]>();
    for (const entry of merged) {
      const list = byJob.get(entry.jobId) ?? [];
      list.push(entry);
      byJob.set(entry.jobId, list);
    }
    const result: JobGroup[] = [];
    for (const [jobId, entries] of byJob) {
      entries.sort((a, b) => a.sequence - b.sequence);
      const startedAt = entries[0].createdAt;
      const endedAt = entries[entries.length - 1].createdAt;
      result.push({
        jobId,
        jobName: entries[0].jobName,
        startedAt,
        endedAt,
        entries,
        hasError: entries.some((e) => e.level === "error"),
        isLive: false,
      });
    }
    result.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
    return result;
  }, [merged]);

  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        <TerminalIcon className="mx-auto mb-2 size-5 opacity-60" />
        No activity yet. Run a phase to see live logs.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <TerminalIcon className="size-4" />
          Activity
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {pusherLive ? (
            <>
              <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
              Live
            </>
          ) : (
            <>
              <span className="size-1.5 rounded-full bg-amber-500" />
              Polling (Pusher unavailable)
            </>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {groups.map((group, idx) => (
          <JobGroupCard
            defaultOpen={idx === 0}
            group={group}
            key={group.jobId}
          />
        ))}
      </div>
    </div>
  );
}

function JobGroupCard({
  group,
  defaultOpen,
}: {
  group: JobGroup;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const tailRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: group.entries.length is the intended trigger for auto-scroll on new entries
  useEffect(() => {
    if (open && tailRef.current) {
      tailRef.current.scrollTop = tailRef.current.scrollHeight;
    }
  }, [open, group.entries.length]);

  const label = PHASE_NAME_LABELS[group.jobName] ?? group.jobName;
  const totalDuration = group.entries.reduce(
    (acc, e) => acc + (e.durationMs ?? 0),
    0
  );
  const totalDurationLabel = formatDuration(totalDuration);
  const startedAt = format(new Date(group.startedAt), "MMM d HH:mm:ss");

  return (
    <div
      className={cn("rounded-md border", group.hasError && "border-red-500/30")}
    >
      <div className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/40">
        <button
          className="flex flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          {open ? (
            <CaretDownIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <CaretRightIcon className="size-3.5 text-muted-foreground" />
          )}
          <span className="font-medium">{label}</span>
          {group.hasError && (
            <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] tracking-wide text-red-600 uppercase dark:text-red-400">
              error
            </span>
          )}
        </button>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <CopyButton label="Copy all" text={serializeGroup(group)} />
          <span className="px-1">{startedAt}</span>
          {totalDurationLabel && totalDuration > 0 && (
            <span>· {totalDurationLabel}</span>
          )}
          <span>
            · {group.entries.length}{" "}
            {group.entries.length === 1 ? "entry" : "entries"}
          </span>
        </span>
      </div>

      {open && (
        <div
          className="h-80 overflow-y-auto border-t bg-muted/20 px-3 py-2 font-mono text-[11px] leading-relaxed"
          ref={tailRef}
        >
          {group.entries.map((entry) => (
            <Fragment key={`${entry.jobId}:${entry.sequence}`}>
              <LogLine entry={entry} />
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Inline copy-to-clipboard button. Shows a check mark for ~1.5s after a
 * successful copy. Stops the click from bubbling so it doesn't toggle a
 * surrounding `<details>` open/close state.
 */
function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        copyToClipboard(text).then((ok) => {
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        });
      }}
      type="button"
    >
      {copied ? (
        <CheckIcon className="size-3 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <CopyIcon className="size-3" />
      )}
      {label}
    </button>
  );
}

/**
 * Serialize an entire job group into a paste-friendly text block — used
 * by the group header's Copy button so the customer can grab the entire
 * job log in one click.
 */
function serializeGroup(group: JobGroup): string {
  const lines: string[] = [];
  for (const entry of group.entries) {
    const seq = String(entry.sequence).padStart(2, "0");
    lines.push(`${seq} [${entry.level}] ${entry.message}`);
    if (entry.stderr) {
      lines.push("--- stderr ---");
      lines.push(entry.stderr);
    }
    if (entry.stdout) {
      lines.push("--- stdout ---");
      lines.push(entry.stdout);
    }
  }
  return lines.join("\n");
}

function LogLine({ entry }: { entry: NormalizedEntry }) {
  const dur = formatDuration(entry.durationMs);
  return (
    <div
      className={cn(
        "flex flex-col py-0.5",
        entry.level === "warn" && "text-amber-600 dark:text-amber-400",
        entry.level === "error" && "text-red-600 dark:text-red-400"
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-muted-foreground">
          {String(entry.sequence).padStart(2, "0")}
        </span>
        <span className="wrap-break-word whitespace-pre-wrap">
          {entry.message}
        </span>
        {dur && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {dur}
          </span>
        )}
      </div>
      {(entry.stdout || entry.stderr) && (
        <details className="mt-0.5 ml-7">
          <summary className="flex cursor-pointer items-center gap-2 text-[10px] text-muted-foreground hover:text-foreground">
            <span>output</span>
            <CopyButton
              label="Copy"
              text={[
                entry.stderr ? `--- stderr ---\n${entry.stderr}` : "",
                entry.stdout ? `--- stdout ---\n${entry.stdout}` : "",
              ]
                .filter(Boolean)
                .join("\n")}
            />
          </summary>
          {entry.stderr && (
            <pre className="mt-1 rounded border-l-2 border-red-500/40 bg-background/60 p-1.5 text-[10px] break-all whitespace-pre-wrap text-red-700 dark:text-red-300">
              {entry.stderr}
            </pre>
          )}
          {entry.stdout && (
            <pre className="mt-1 rounded border-l-2 border-muted-foreground/30 bg-background/60 p-1.5 text-[10px] break-all whitespace-pre-wrap">
              {entry.stdout}
            </pre>
          )}
        </details>
      )}
    </div>
  );
}
