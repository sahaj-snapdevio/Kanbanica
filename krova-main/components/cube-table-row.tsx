"use client";

import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { CubeStatusBadge } from "@/components/cube-status-badge";
import { TableCell, TableRow } from "@/components/ui/table";
import type { CubeStatusValue } from "@/db/schema/types";

interface CubeRowData {
  costPerHour: number;
  createdAt: string;
  /** The cube's primary custom domain (first `kind='custom'` mapping,
   *  preferring an `active` Cloudflare Custom Hostname). Null until a
   *  custom domain is added. */
  customDomain: { domain: string; cloudflareStatus: string | null } | null;
  id: string;
  name: string;
  ramMb: number;
  region: string;
  status: CubeStatusValue;
  transferState?: string | null;
  vcpus: number;
}

interface CubeTableRowProps {
  cube: CubeRowData;
  liveStatus?: CubeStatusValue;
  spaceId: string;
}

function formatRam(ramMb: number): string {
  if (ramMb >= 1024) {
    const gb = ramMb / 1024;
    return `${gb.toFixed(ramMb % 1024 === 0 ? 0 : 1)} GB`;
  }
  return `${ramMb} MB`;
}

export function CubeTableRow({ cube, spaceId, liveStatus }: CubeTableRowProps) {
  const router = useRouter();
  const detailHref = `/${spaceId}/cubes/${cube.id}`;

  return (
    <TableRow
      className="cursor-pointer"
      onClick={() => router.push(detailHref)}
    >
      <TableCell className="font-medium">{cube.name}</TableCell>
      <TableCell>
        <CubeStatusBadge
          status={liveStatus ?? cube.status}
          transferState={cube.transferState}
        />
      </TableCell>
      <TableCell className="max-w-65">
        <span className="text-sm">{cube.region}</span>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {cube.vcpus} vCPU / {formatRam(cube.ramMb)}
      </TableCell>
      <TableCell className="tabular-nums">
        ${cube.costPerHour.toFixed(4)}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatDistanceToNow(new Date(cube.createdAt), { addSuffix: true })}
      </TableCell>
    </TableRow>
  );
}
