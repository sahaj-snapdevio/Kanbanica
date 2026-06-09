"use client";

import { Badge } from "@/components/ui/badge";
import type { CubeStatusValue } from "@/db/schema/types";
import { useCubeStatus } from "@/hooks/use-cube-status";
import {
  CUBE_STATUS_CONFIG,
  isActiveTransferState,
  TRANSFERRING_BADGE,
} from "@/lib/status-display";
import { cn } from "@/lib/utils";

interface CubeStatusBadgeProps {
  cubeId?: string;
  realtime?: boolean;
  status: CubeStatusValue;
  /**
   * The cube's `transferState`. When it's an active (in-flight) transfer,
   * the badge shows "Transferring" instead of the underlying running/sleeping
   * status — a cross-server transfer keeps `status` running/sleeping, so
   * without this the UI misleadingly shows "Running" during a transfer.
   */
  transferState?: string | null;
}

export function CubeStatusBadge({
  cubeId,
  status,
  realtime = false,
  transferState,
}: CubeStatusBadgeProps) {
  if (realtime && cubeId) {
    return (
      <RealtimeCubeStatusBadge
        cubeId={cubeId}
        initialStatus={status}
        transferState={transferState}
      />
    );
  }

  if (isActiveTransferState(transferState)) {
    return (
      <Badge
        className={cn("border-0", TRANSFERRING_BADGE.className)}
        variant="secondary"
      >
        {TRANSFERRING_BADGE.label}
      </Badge>
    );
  }

  const config = CUBE_STATUS_CONFIG[status];
  return (
    <Badge className={cn("border-0", config.className)} variant="secondary">
      {config.label}
    </Badge>
  );
}

function RealtimeCubeStatusBadge({
  cubeId,
  initialStatus,
  transferState,
}: {
  cubeId: string;
  initialStatus: CubeStatusValue;
  transferState?: string | null;
}) {
  const { status } = useCubeStatus(cubeId, initialStatus);

  // A live transfer overrides the running/sleeping status. The transfer
  // settling flips `status` (via the realtime hook) and clears `transferState`
  // on the next page load, so the badge returns to the real status.
  if (isActiveTransferState(transferState)) {
    return (
      <Badge
        className={cn("border-0", TRANSFERRING_BADGE.className)}
        variant="secondary"
      >
        {TRANSFERRING_BADGE.label}
      </Badge>
    );
  }

  const config = CUBE_STATUS_CONFIG[status];

  return (
    <Badge className={cn("border-0", config.className)} variant="secondary">
      {config.label}
    </Badge>
  );
}
