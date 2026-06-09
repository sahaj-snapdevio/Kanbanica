"use client";

import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useState } from "react";
import { FilterDropdown } from "@/components/filter-dropdown";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";

interface WebhookRow {
  consecutiveFailures: number;
  createdAt: Date;
  description: string | null;
  disabledReason: string | null;
  enabled: boolean;
  events: string[];
  id: string;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  spaceId: string;
  spaceName: string;
  url: string;
}

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "enabled", label: "Enabled" },
  { value: "disabled", label: "Disabled" },
  { value: "auto_disabled", label: "Auto-disabled" },
];

export function WebhooksTable({ webhooks }: { webhooks: WebhookRow[] }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = webhooks.filter((w) => {
    if (statusFilter === "all") {
      return true;
    }
    if (statusFilter === "enabled") {
      return w.enabled;
    }
    if (statusFilter === "disabled") {
      return !w.enabled;
    }
    if (statusFilter === "auto_disabled") {
      return (
        !w.enabled &&
        (w.disabledReason === "consecutive_failures" ||
          w.disabledReason === "ssrf_blocked")
      );
    }
    return true;
  });

  return (
    <DataTable
      columns={[
        {
          id: "endpoint",
          header: "Endpoint",
          cell: (w) => (
            <div className="max-w-sm">
              {w.description && (
                <div className="text-sm font-medium">{w.description}</div>
              )}
              <div className="font-mono text-xs break-all text-muted-foreground">
                {w.url}
              </div>
            </div>
          ),
        },
        {
          id: "space",
          header: "Space",
          cell: (w) => (
            <Link
              className="text-sm text-primary hover:underline"
              href={`/orbit/spaces/${w.spaceId}`}
            >
              {w.spaceName}
            </Link>
          ),
        },
        {
          id: "events",
          header: "Events",
          cell: (w) => (
            <div className="flex flex-wrap gap-1">
              {w.events.slice(0, 2).map((e) => (
                <Badge
                  className="font-mono text-[10px]"
                  key={e}
                  variant="secondary"
                >
                  {e}
                </Badge>
              ))}
              {w.events.length > 2 && (
                <Badge className="font-mono text-[10px]" variant="outline">
                  +{w.events.length - 2}
                </Badge>
              )}
            </div>
          ),
        },
        {
          id: "status",
          header: "Status",
          cell: (w) => {
            if (w.enabled) {
              return <Badge variant="outline">Enabled</Badge>;
            }
            if (
              w.disabledReason === "consecutive_failures" ||
              w.disabledReason === "ssrf_blocked"
            ) {
              return (
                <Badge variant="destructive">
                  {w.disabledReason === "ssrf_blocked"
                    ? "SSRF blocked"
                    : "Auto-disabled"}
                </Badge>
              );
            }
            return <Badge variant="secondary">Disabled</Badge>;
          },
        },
        {
          id: "failures",
          header: "Failures",
          cell: (w) => (
            <span className="text-sm text-muted-foreground">
              {w.consecutiveFailures}
            </span>
          ),
        },
        {
          id: "lastActivity",
          header: "Last activity",
          cell: (w) =>
            w.lastSuccessAt
              ? `${formatDistanceToNow(new Date(w.lastSuccessAt), { addSuffix: true })} (ok)`
              : w.lastFailureAt
                ? `${formatDistanceToNow(new Date(w.lastFailureAt), { addSuffix: true })} (failed)`
                : "—",
        },
        {
          id: "created",
          header: "Created",
          cell: (w) =>
            formatDistanceToNow(new Date(w.createdAt), { addSuffix: true }),
        },
      ]}
      data={filtered}
      rowKey={(w) => w.id}
      toolbarRight={
        <FilterDropdown
          label="Status"
          onChange={setStatusFilter}
          options={STATUS_OPTIONS}
          value={statusFilter}
        />
      }
    />
  );
}
