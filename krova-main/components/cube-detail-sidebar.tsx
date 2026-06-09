import type { ReactNode } from "react";

import { LocalDate } from "@/components/local-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IMAGE_OPTIONS } from "@/config/platform";
import type { CubeStatusValue } from "@/db/schema/types";
import { fmtUsd } from "@/lib/format";

interface CubeDetailSidebarProps {
  cube: {
    vcpus: number;
    ramMb: number;
    diskLimitGb: number;
    imageId: string;
    internalIp: string | null;
    internalIpv6: string | null;
    id: string;
    createdAt: string;
    updatedAt: string;
  };
  /** Live cube status from `useCubeStatus`. Drives which hourly rate is
   *  shown — running cubes pay compute, sleeping cubes pay sleep storage
   *  (full disk × DISK_RATE × tier, no free tier carry-through). */
  currentStatus: CubeStatusValue;
  isDeleted: boolean;
  orbit?: { spaceName: string };
  region: { name: string } | null;
  /** Compute hourly cost (vCPU + RAM + disk above free tier × tier). */
  runningHourlyCost: number;
  server: { hostname: string } | null;
  /** Sleep-storage hourly cost (full disk × DISK_RATE × tier). */
  sleepHourlyCost: number;
}

function DetailRow({
  label,
  value,
  subtitle,
  mono,
  tabular,
  last,
}: {
  label: string;
  value: ReactNode;
  subtitle?: ReactNode;
  mono?: boolean;
  tabular?: boolean;
  last?: boolean;
}) {
  if (last && !label && !value) {
    return null;
  }
  return (
    <div
      className={`flex items-baseline justify-between py-2.5 ${last ? "" : "border-b"}`}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-right">
        <span
          className={`text-sm ${mono ? "font-mono" : ""} ${tabular ? "tabular-nums" : ""}`}
        >
          {value}
        </span>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

export function CubeDetailSidebar({
  cube,
  server,
  region,
  currentStatus,
  runningHourlyCost,
  sleepHourlyCost,
  isDeleted,
  orbit,
}: CubeDetailSidebarProps) {
  const ramLabel =
    cube.ramMb >= 1024
      ? `${(cube.ramMb / 1024).toFixed(cube.ramMb % 1024 === 0 ? 0 : 1)} GB`
      : `${cube.ramMb} MB`;

  // Display the rate that actually applies to the CURRENT cube state.
  // - running          → compute formula (vCPU + RAM + disk above free tier)
  // - sleeping         → sleep storage   (full disk × DISK_RATE × tier)
  // - error            → $0 (Rule 38 — unexpected shutdowns are not billed)
  // - pending/booting  → compute rate, labelled "Cost (when running)" so
  //                      the customer sees what they'll pay once the cube
  //                      finishes provisioning
  // - stopping         → same as pending (cube is mid-transition)
  // - deleted          → row is hidden via `isDeleted`
  const costLabel = (() => {
    if (currentStatus === "sleeping") {
      return "Sleep storage";
    }
    if (currentStatus === "error") {
      return "Cost";
    }
    if (currentStatus === "running") {
      return "Cost";
    }
    return "Cost (when running)";
  })();
  const displayedHourlyCost =
    currentStatus === "sleeping"
      ? sleepHourlyCost
      : currentStatus === "error"
        ? 0
        : runningHourlyCost;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-0">
        {orbit && <DetailRow label="Space" value={orbit.spaceName} />}
        <DetailRow label="Region" value={region ? region.name : "—"} />
        <DetailRow label="Server" mono value={server?.hostname ?? "Unknown"} />
        <DetailRow label="vCPUs" value={String(cube.vcpus)} />
        <DetailRow label="RAM" value={ramLabel} />
        <DetailRow label="Disk" value={`${cube.diskLimitGb} GB`} />
        {/* Show the human-readable label (e.g. "Ubuntu 24.04") if the
            cube's imageId is in the current catalog. Otherwise — common
            for cubes provisioned against a since-removed distro — fall
            back to the raw imageId so the operator/customer can still
            see what was originally chosen. */}
        <DetailRow
          label="Image"
          value={
            IMAGE_OPTIONS.find((opt) => opt.value === cube.imageId)?.label ??
            cube.imageId
          }
        />
        {orbit && cube.internalIp && (
          <DetailRow label="Internal IP" mono value={cube.internalIp} />
        )}
        {orbit && cube.internalIpv6 && (
          <DetailRow label="Internal IPv6" mono value={cube.internalIpv6} />
        )}
        {orbit && <DetailRow label="Cube ID" mono value={cube.id} />}
        {!isDeleted && (
          <DetailRow
            label={costLabel}
            tabular
            value={`$${fmtUsd(displayedHourlyCost, { precision: "rate" })}/hr (~$${fmtUsd(displayedHourlyCost * 730)}/mo)`}
          />
        )}
        <DetailRow
          label="Created"
          subtitle={<LocalDate iso={cube.createdAt} mode="relative" />}
          value={<LocalDate iso={cube.createdAt} />}
        />
        {isDeleted && (
          <DetailRow
            label="Deleted"
            last
            subtitle={<LocalDate iso={cube.updatedAt} mode="relative" />}
            value={<LocalDate iso={cube.updatedAt} />}
          />
        )}
        {!isDeleted && <DetailRow label="" last value="" />}
      </CardContent>
    </Card>
  );
}
