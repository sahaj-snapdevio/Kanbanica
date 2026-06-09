"use client";

import {
  CheckCircleIcon,
  CircleNotchIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  CubeMetricsSnapshot,
  CubeReachabilitySnapshot,
} from "@/db/schema/cubes";
import type { CubeStatusValue } from "@/db/schema/types";
import { useCubeReachability } from "@/hooks/use-cube-reachability";
import { formatBytes } from "@/lib/format";

interface CubeLiveStatusCardProps {
  cubeId: string;
  currentStatus: CubeStatusValue;
  initialLastReachabilityAt: string | null;
  initialMetrics: CubeMetricsSnapshot | null;
  initialReachability: CubeReachabilitySnapshot | null;
  spaceId: string;
}

type BadgeState = {
  label: string;
  hint: string | null;
  Icon: typeof CheckCircleIcon;
  tone: "healthy" | "warn" | "down" | "idle";
};

function deriveBadge(
  reachability: CubeReachabilitySnapshot | null
): BadgeState {
  if (!reachability) {
    return {
      label: "Waiting for first check…",
      hint: null,
      Icon: CircleNotchIcon,
      tone: "idle",
    };
  }
  if (reachability.agentOk && reachability.sshOk) {
    return {
      label: "Healthy",
      hint: null,
      Icon: CheckCircleIcon,
      tone: "healthy",
    };
  }
  if (reachability.agentOk && !reachability.sshOk) {
    return {
      label: "SSH unreachable",
      hint: reachability.lastSshSeenAt
        ? `Last SSH ok ${formatDistanceToNow(new Date(reachability.lastSshSeenAt), { addSuffix: true })}`
        : "SSH has never been observed reachable",
      Icon: WarningIcon,
      tone: "warn",
    };
  }
  // !agentOk — guest kernel/userspace not responding
  return {
    label: "Agent unresponsive",
    hint: reachability.lastAgentSeenAt
      ? `Last seen ${formatDistanceToNow(new Date(reachability.lastAgentSeenAt), { addSuffix: true })}`
      : "Agent has never been observed reachable",
    Icon: XCircleIcon,
    tone: "down",
  };
}

const TONE_CLASSES: Record<BadgeState["tone"], string> = {
  healthy: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  down: "text-destructive",
  idle: "text-muted-foreground",
};

function formatUptime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function MetricRow({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/60 py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-baseline gap-2 text-right tabular-nums">
        <span className="font-medium">{value}</span>
        {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
      </div>
    </div>
  );
}

/**
 * Sidebar card on the cube detail page. Shows the L1+L2 reachability
 * badge, the most recent guest-agent metrics (load / CPU / RAM / disk),
 * and the freshness of the data. Live-updates via the `cube.reachability`
 * Pusher event, falls back to a 60s SWR poll. Only rendered when the
 * cube is in `running` — sleeping / deleted cubes have no agent.
 */
export function CubeLiveStatusCard({
  cubeId,
  spaceId,
  currentStatus,
  initialReachability,
  initialMetrics,
  initialLastReachabilityAt,
}: CubeLiveStatusCardProps) {
  const live = useCubeReachability(cubeId, spaceId, {
    reachability: initialReachability,
    metrics: initialMetrics,
    lastReachabilityAt: initialLastReachabilityAt,
  });

  if (currentStatus !== "running") {
    return null;
  }

  const badge = deriveBadge(live.reachability);
  const m = live.metrics;

  const memPct = m
    ? Math.round(((m.mem_total_kb - m.mem_available_kb) / m.mem_total_kb) * 100)
    : null;
  const diskPct = m
    ? Math.round((m.disk_used_bytes / m.disk_total_bytes) * 100)
    : null;
  const cpuBusyPct = m ? Math.round(m.cpu_user_pct + m.cpu_system_pct) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Live status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2">
          <badge.Icon
            className={`mt-0.5 size-5 shrink-0 ${TONE_CLASSES[badge.tone]}`}
          />
          <div className="space-y-0.5">
            <p className={`text-sm font-medium ${TONE_CLASSES[badge.tone]}`}>
              {badge.label}
            </p>
            {badge.hint && (
              <p className="text-xs text-muted-foreground">{badge.hint}</p>
            )}
          </div>
        </div>

        {m ? (
          <div>
            <MetricRow label="Uptime" value={formatUptime(m.uptime_sec)} />
            <MetricRow
              label="Load (1m)"
              meta={`${m.load_avg_5m.toFixed(2)} · ${m.load_avg_15m.toFixed(2)}`}
              value={m.load_avg_1m.toFixed(2)}
            />
            <MetricRow
              label="CPU"
              meta={
                m.cpu_user_pct === undefined
                  ? undefined
                  : `u${m.cpu_user_pct.toFixed(0)} · s${m.cpu_system_pct.toFixed(0)}`
              }
              value={cpuBusyPct === null ? "—" : `${cpuBusyPct}%`}
            />
            <MetricRow
              label="Memory"
              meta={memPct === null ? undefined : `${memPct}%`}
              value={`${formatBytes((m.mem_total_kb - m.mem_available_kb) * 1024)} / ${formatBytes(m.mem_total_kb * 1024)}`}
            />
            <MetricRow
              label="Disk (/)"
              meta={diskPct === null ? undefined : `${diskPct}%`}
              value={`${formatBytes(m.disk_used_bytes)} / ${formatBytes(m.disk_total_bytes)}`}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No metrics yet — waiting for the next reachability poll.
          </p>
        )}

        {live.lastReachabilityAt && (
          <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
            Updated{" "}
            {formatDistanceToNow(new Date(live.lastReachabilityAt), {
              addSuffix: true,
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
