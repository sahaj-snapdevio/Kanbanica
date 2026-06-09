"use client";

import { WarningIcon } from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { CubeDetailHeader } from "@/components/cube-detail-header";
import { CubeDetailSidebar } from "@/components/cube-detail-sidebar";
import { CubeDetailTabs } from "@/components/cube-detail-tabs";
import { CubeKernelVersion } from "@/components/cube-kernel-version";
import { CubeLiveStatusCard } from "@/components/cube-live-status-card";
import type {
  CubeMetricsSnapshot,
  CubeReachabilitySnapshot,
} from "@/db/schema/cubes";
import type { CubeStatusValue } from "@/db/schema/types";
import { useCubeStatus } from "@/hooks/use-cube-status";
import type { PlanCubeLimits } from "@/lib/cube-options";

interface CubeDetailShellProps {
  backupStorageCostPerHour?: number;
  children: React.ReactNode;
  cube: {
    id: string;
    name: string;
    status: CubeStatusValue;
    vcpus: number;
    ramMb: number;
    diskLimitGb: number;
    hasVirtioMem: boolean;
    transferState: string;
    imageId: string;
    internalIp: string | null;
    internalIpv6: string | null;
    serverId: string;
    createdAt: string;
    updatedAt: string;
    bootedKernelVersion: number | null;
    provisionedRootfsVersion: number | null;
    reachabilityJsonb: CubeReachabilitySnapshot | null;
    lastMetricsJsonb: CubeMetricsSnapshot | null;
    lastReachabilityAt: string | null;
  };
  orbit?: { spaceName: string };
  permissions: string[];
  /** Whether the space's plan allows backups (`maxBackups > 0`). Threaded
   *  into CubeDetailHeader to hide the "Preserve backup" checkbox on Trial
   *  and default it CHECKED on paid plans. Optional — Orbit (admin) callers
   *  pass nothing and the checkbox defaults to its prior behavior. */
  planAllowsBackups?: boolean;
  /** Space's plan ceilings (plan defaults merged with per-space overrides).
   *  Threaded into the resize sheet so its inputs are capped at what
   *  `assertCubeWithinSizeV2` will accept. Optional — admin-side callers
   *  (Orbit) pass nothing and the sheet falls back to the global config
   *  range. */
  planLimits?: PlanCubeLimits;
  region: { name: string } | null;
  /** Compute hourly cost for this cube when running (vCPU + RAM + Disk
   *  above free tier × tier multiplier). Shown in the sidebar when
   *  status='running' (and for pending/booting cubes as the rate they
   *  WILL pay once up). */
  runningHourlyCost: number;
  server: {
    hostname: string;
    serverDomain: string;
    publicIp: string;
    currentKernelVersion: number;
  } | null;
  /** Sleep-storage hourly cost (full disk × DISK_RATE × tier multiplier,
   *  same per-GB rate as running disk — Rule 53). Shown in the sidebar
   *  when status='sleeping'. */
  sleepHourlyCost: number;
  spaceId: string;
  /** Whether snapshot/backup features are available based on configured
   *  storage backends. Hides the Snapshots tab + delete-cube "preserve
   *  backup" option when no backend is active. Optional: Orbit (admin)
   *  callers pass nothing and tabs render as if available. */
  storageCapabilities?: {
    hasActiveBackend: boolean;
    canCreateSnapshot: boolean;
    canCreateBackup: boolean;
  };
}

/**
 * Outer chrome of the cube detail page: deleted banner, header, sidebar,
 * route-based tab nav. The actual tab content lives in per-tab page files
 * and is injected via `children`.
 */
export function CubeDetailShell({
  cube,
  server,
  region,
  spaceId,
  permissions,
  runningHourlyCost,
  sleepHourlyCost,
  backupStorageCostPerHour,
  planLimits,
  planAllowsBackups,
  storageCapabilities,
  orbit,
  children,
}: CubeDetailShellProps) {
  // Admin (Orbit) callers don't pass capabilities and aren't gated.
  const canCreateSnapshot = storageCapabilities?.canCreateSnapshot ?? true;
  const canCreateBackup = storageCapabilities?.canCreateBackup ?? true;
  const router = useRouter();
  const { status: currentStatus } = useCubeStatus(
    cube.id,
    cube.status,
    cube.internalIp,
    spaceId
  );
  const isDeleted = currentStatus === "deleted";

  // Re-fetch when cube settles into a stable state — the per-tab page
  // queries (TCP mappings, snapshots) need to refresh.
  const prevStatus = useRef(currentStatus);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = currentStatus;
    if (prev === currentStatus) {
      return;
    }
    if (["running", "sleeping", "error", "deleted"].includes(currentStatus)) {
      router.refresh();
    }
  }, [currentStatus, router]);

  const canManage = permissions.includes("cube.manage");

  return (
    <div className="space-y-6">
      {isDeleted && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <WarningIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-destructive">
              This Cube has been deleted
            </p>
            <p className="text-sm text-muted-foreground">
              All resources have been released. Networking, SSH, and snapshots
              are no longer active.
              {cube.updatedAt && (
                <>
                  {" "}
                  Deleted{" "}
                  {formatDistanceToNow(new Date(cube.updatedAt), {
                    addSuffix: true,
                  })}
                  .
                </>
              )}
            </p>
          </div>
        </div>
      )}

      <CubeDetailHeader
        backupStorageCostPerHour={backupStorageCostPerHour}
        canCreateBackup={canCreateBackup}
        canManage={canManage}
        cubeId={cube.id}
        cubeName={cube.name}
        currentStatus={currentStatus}
        diskLimitGb={cube.diskLimitGb}
        hasVirtioMem={cube.hasVirtioMem}
        inlineBadge={
          !isDeleted && server ? (
            <CubeKernelVersion
              bootedKernelVersion={cube.bootedKernelVersion}
              canRestart={orbit ? true : canManage}
              coldRestartUrl={
                orbit
                  ? `/api/orbit/cubes/${cube.id}/cold-restart`
                  : `/api/spaces/${spaceId}/cubes/${cube.id}/cold-restart`
              }
              cubeName={cube.name}
              cubeStatus={currentStatus}
              serverCurrentKernelVersion={server.currentKernelVersion}
            />
          ) : null
        }
        isDeleted={isDeleted}
        planAllowsBackups={planAllowsBackups}
        planLimits={planLimits}
        ramMb={cube.ramMb}
        spaceId={spaceId}
        transferState={cube.transferState}
        vcpus={cube.vcpus}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* min-w-0 lets the tab strip's overflow-x-auto work inside the
            grid column instead of pushing the column wider than the
            viewport, which would clip the rightmost tab labels. */}
        <div className="min-w-0 lg:col-span-2">
          {/* Tab strip hidden when the cube is deleted — only Activity is
              meaningful, and the tab nav would dead-link to gone data. */}
          {!isDeleted && (
            <CubeDetailTabs
              canCreateSnapshot={canCreateSnapshot}
              cubeId={cube.id}
              spaceId={spaceId}
            />
          )}
          {children}
        </div>

        <div className="space-y-6 lg:col-span-1">
          {!isDeleted && (
            <CubeLiveStatusCard
              cubeId={cube.id}
              currentStatus={currentStatus}
              initialLastReachabilityAt={cube.lastReachabilityAt}
              initialMetrics={cube.lastMetricsJsonb}
              initialReachability={cube.reachabilityJsonb}
              spaceId={spaceId}
            />
          )}
          <CubeDetailSidebar
            cube={cube}
            currentStatus={currentStatus}
            isDeleted={isDeleted}
            orbit={orbit}
            region={region}
            runningHourlyCost={runningHourlyCost}
            server={server}
            sleepHourlyCost={sleepHourlyCost}
          />
        </div>
      </div>
    </div>
  );
}
