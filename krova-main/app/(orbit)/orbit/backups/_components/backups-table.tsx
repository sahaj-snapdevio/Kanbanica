"use client";

import { format, formatDistanceToNow } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { FilterDropdown } from "@/components/filter-dropdown";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { formatBytes } from "@/lib/format";
import { type BackupStatus, backupStatusVariant } from "@/lib/status-display";

interface BackupRow {
  backendLabel: string;
  completedAt: Date | null;
  createdAt: Date;
  diskSizeGb: number;
  id: string;
  name: string;
  originalCubeId: string;
  originalCubeName: string;
  redeployedCubeId: string | null;
  sizeBytes: number | null;
  spaceId: string | null;
  spaceName: string;
  status: BackupStatus;
}

const STATUS_OPTIONS: { value: "all" | BackupStatus; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "complete", label: "Complete" },
  { value: "creating", label: "Creating" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
];

export function BackupsTable({ backups }: { backups: BackupRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status");
  const [statusFilter, setStatusFilter] = useState<string>(
    initialStatus && STATUS_OPTIONS.some((o) => o.value === initialStatus)
      ? initialStatus
      : "all"
  );

  const filtered = backups.filter(
    (b) => statusFilter === "all" || b.status === statusFilter
  );

  return (
    <DataTable
      columns={[
        {
          id: "name",
          header: "Name",
          className: "font-medium",
          cell: (b) => b.name,
        },
        {
          id: "original-cube",
          header: "Original cube",
          className: "text-muted-foreground",
          cell: (b) => b.originalCubeName,
        },
        {
          id: "space",
          header: "Space",
          className: "text-muted-foreground",
          cell: (b) => b.spaceName,
        },
        {
          id: "status",
          header: "Status",
          cell: (b) => (
            <Badge variant={backupStatusVariant(b.status)}>{b.status}</Badge>
          ),
        },
        {
          id: "size",
          header: "Size",
          className: "font-mono tabular-nums",
          cell: (b) => formatBytes(b.sizeBytes),
        },
        {
          id: "disk",
          header: "Disk (GB)",
          className: "font-mono tabular-nums text-muted-foreground",
          cell: (b) => b.diskSizeGb,
        },
        {
          id: "backend",
          header: "Backend",
          className: "text-muted-foreground",
          cell: (b) => b.backendLabel,
        },
        {
          id: "redeployed",
          header: "Redeployed",
          className: "text-muted-foreground",
          cell: (b) =>
            b.redeployedCubeId ? (
              <Badge variant="outline">Yes</Badge>
            ) : (
              <span className="text-xs">—</span>
            ),
        },
        {
          id: "created",
          header: "Created",
          className: "text-muted-foreground",
          cell: (b) => (
            <span title={format(b.createdAt, "PPpp")}>
              {formatDistanceToNow(b.createdAt, { addSuffix: true })}
            </span>
          ),
        },
      ]}
      data={filtered}
      emptyDescription={
        statusFilter === "all"
          ? "No backups exist on the platform yet."
          : "Try adjusting your filter."
      }
      emptyTitle="No backups found"
      onRowClick={(b) => router.push(`/orbit/backups/${b.id}`)}
      rowKey={(b) => b.id}
      searchAccessor={(b) =>
        `${b.name} ${b.originalCubeName} ${b.spaceName} ${b.backendLabel}`
      }
      searchPlaceholder="Search backups..."
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
