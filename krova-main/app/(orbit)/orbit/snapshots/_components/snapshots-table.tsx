"use client";

import { format, formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FilterDropdown } from "@/components/filter-dropdown";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { formatBytes } from "@/lib/format";
import {
  SNAPSHOT_STATUS_OPTIONS,
  type SnapshotStatus,
  snapshotStatusVariant,
} from "@/lib/status-display";

interface SnapshotRow {
  backendLabel: string;
  createdAt: Date;
  cubeId: string;
  cubeName: string;
  id: string;
  kind: "auto" | "manual";
  name: string;
  sizeBytes: number | null;
  spaceId: string;
  spaceName: string;
  status: SnapshotStatus;
}

export function SnapshotsTable({ snapshots }: { snapshots: SnapshotRow[] }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = snapshots.filter(
    (s) => statusFilter === "all" || s.status === statusFilter
  );

  return (
    <DataTable
      columns={[
        {
          id: "name",
          header: "Name",
          className: "font-medium",
          cell: (s) => s.name,
        },
        {
          id: "cube",
          header: "Cube",
          cell: (s) => (
            <Link
              className="text-primary hover:underline"
              href={`/orbit/cubes/${s.cubeId}`}
            >
              {s.cubeName}
            </Link>
          ),
        },
        {
          id: "space",
          header: "Space",
          cell: (s) => (
            <Link
              className="text-primary hover:underline"
              href={`/orbit/spaces/${s.spaceId}`}
            >
              {s.spaceName}
            </Link>
          ),
        },
        {
          id: "status",
          header: "Status",
          cell: (s) => (
            <Badge variant={snapshotStatusVariant(s.status)}>{s.status}</Badge>
          ),
        },
        {
          // "Added" = restic `data_added_packed` — the dedup'd, compressed
          // bytes THIS snapshot added (incremental), NOT its restore size.
          // Matches the customer-facing label in components/cube-snapshots.tsx;
          // never relabel back to a flat "Size" (CLAUDE.md rule).
          id: "added",
          header: "Added",
          className: "font-mono tabular-nums",
          cell: (s) => formatBytes(s.sizeBytes),
        },
        {
          id: "backend",
          header: "Backend",
          className: "text-muted-foreground",
          cell: (s) => s.backendLabel,
        },
        {
          id: "type",
          header: "Type",
          className: "text-muted-foreground",
          cell: (s) => (s.kind === "auto" ? "Auto" : "Manual"),
        },
        {
          id: "created",
          header: "Created",
          className: "text-muted-foreground",
          cell: (s) => (
            <span title={format(s.createdAt, "PPpp")}>
              {formatDistanceToNow(s.createdAt, { addSuffix: true })}
            </span>
          ),
        },
      ]}
      data={filtered}
      emptyDescription={
        statusFilter === "all"
          ? "No snapshots have been taken yet."
          : "Try adjusting your filter."
      }
      emptyTitle="No snapshots found"
      onRowClick={(s) => router.push(`/orbit/snapshots/${s.id}`)}
      rowKey={(s) => s.id}
      searchAccessor={(s) => `${s.name} ${s.cubeName} ${s.spaceName}`}
      searchPlaceholder="Search snapshots..."
      toolbarRight={
        <FilterDropdown
          label="Status"
          onChange={setStatusFilter}
          options={SNAPSHOT_STATUS_OPTIONS}
          value={statusFilter}
        />
      }
    />
  );
}
