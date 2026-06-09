"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FilterDropdown } from "@/components/filter-dropdown";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { UsageBar } from "@/components/usage-bar";
import { serverCpuRamCapacity } from "@/lib/server/cpu-ram-capacity";
import { SERVER_STATUS_CLASSES, type ServerStatus } from "@/lib/status-display";
import { cn } from "@/lib/utils";

interface Server {
  allocatedCpus: number;
  allocatedDiskGb: number;
  allocatedRamMb: number;
  cubeCount: number;
  hostname: string;
  id: string;
  maxCpuOvercommit: number;
  maxRamOvercommit: number;
  overheadDiskGb: number;
  publicIp: string;
  regionName: string;
  serverDomain: string;
  status: ServerStatus;
  totalCpus: number;
  totalDiskGb: number;
  totalRamMb: number;
}

const STATUS_FILTER_OPTIONS: { value: "all" | ServerStatus; label: string }[] =
  [
    { value: "all", label: "All statuses" },
    { value: "active", label: "Active" },
    { value: "provisioning", label: "Provisioning" },
    { value: "inactive", label: "Inactive" },
    { value: "offline", label: "Offline" },
  ];

export function ServersTable({ servers }: { servers: Server[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialStatus = searchParams.get("status");
  const [statusFilter, setStatusFilter] = useState<string>(
    initialStatus &&
      STATUS_FILTER_OPTIONS.some((o) => o.value === initialStatus)
      ? initialStatus
      : "all"
  );
  const [regionFilter, setRegionFilter] = useState<string>("all");

  const uniqueRegions = Array.from(
    new Set(servers.map((s) => s.regionName).filter((n) => n && n !== "—"))
  );
  const regionOptions = [
    { value: "all", label: "All regions" },
    ...uniqueRegions.map((name) => ({ value: name, label: name })),
  ];

  const filtered = servers.filter((s) => {
    if (statusFilter !== "all" && s.status !== statusFilter) {
      return false;
    }
    if (regionFilter !== "all" && s.regionName !== regionFilter) {
      return false;
    }
    return true;
  });

  const hasActiveFilters = statusFilter !== "all" || regionFilter !== "all";

  return (
    <DataTable
      columns={[
        {
          id: "hostname",
          header: "Hostname",
          className: "font-medium",
          cell: (s) => s.hostname,
        },
        { id: "region", header: "Region", cell: (s) => s.regionName },
        {
          id: "status",
          header: "Status",
          cell: (s) => (
            <Badge
              className={cn(
                "border-0 capitalize",
                SERVER_STATUS_CLASSES[s.status]
              )}
              variant="secondary"
            >
              {s.status}
            </Badge>
          ),
        },
        {
          id: "cpu",
          header: "CPU",
          className: "min-w-45",
          cell: (s) => (
            <UsageBar
              label="vCPU"
              total={serverCpuRamCapacity(s).maxCpu}
              used={s.allocatedCpus}
              variant="compact"
            />
          ),
        },
        {
          id: "ram",
          header: "RAM",
          className: "min-w-45",
          cell: (s) => (
            <UsageBar
              label="RAM (MB)"
              total={serverCpuRamCapacity(s).maxRam}
              used={s.allocatedRamMb}
              variant="compact"
            />
          ),
        },
        {
          id: "disk",
          header: "Disk",
          className: "min-w-45",
          cell: (s) => (
            <UsageBar
              label="Disk (GB)"
              total={Math.max(0, s.totalDiskGb - s.overheadDiskGb)}
              used={s.allocatedDiskGb}
              variant="compact"
            />
          ),
        },
        {
          id: "cubes",
          header: "Cubes",
          numeric: true,
          cell: (s) => s.cubeCount,
        },
      ]}
      data={filtered}
      emptyDescription={
        hasActiveFilters
          ? "Try adjusting your filters."
          : "Create a server to get started with hosting Cubes."
      }
      emptyTitle="No servers"
      onRowClick={(s) => router.push(`/orbit/servers/${s.id}`)}
      rowKey={(s) => s.id}
      searchAccessor={(s) =>
        `${s.hostname} ${s.regionName} ${s.publicIp} ${s.status}`
      }
      searchPlaceholder="Search servers..."
      toolbarRight={
        <>
          <FilterDropdown
            label="Status"
            onChange={setStatusFilter}
            options={STATUS_FILTER_OPTIONS}
            value={statusFilter}
          />
          <FilterDropdown
            label="Region"
            onChange={setRegionFilter}
            options={regionOptions}
            value={regionFilter}
          />
        </>
      }
    />
  );
}
