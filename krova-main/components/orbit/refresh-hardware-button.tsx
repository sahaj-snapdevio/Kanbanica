"use client";

/**
 * "Refresh Hardware" button on the server detail page header. Visible only
 * on fully-setup servers (`setupPhase === "ready"`). Triggers
 * `POST /api/orbit/servers/[serverId]/refresh-hardware` which enqueues a
 * `server.refresh-hardware` job. The job re-runs the same `nproc` /
 * `/proc/meminfo` / `df -B1G /` probes that the bootstrap phase used and
 * writes the fresh totals to `servers.totalCpus / totalRamMb / totalDiskGb`.
 *
 * Use after physically upgrading the server (more RAM, larger disk, CPU
 * swap) so the allocator's capacity check stops treating the box as having
 * its bootstrap-time totals. Read-only on the host — no reboot, no service
 * restart.
 */

import { CpuIcon } from "@phosphor-icons/react";
import { ServerActionButton } from "@/components/orbit/server-action-button";

interface RefreshHardwareButtonProps {
  hostname: string;
  serverId: string;
}

export function RefreshHardwareButton({
  serverId,
  hostname,
}: RefreshHardwareButtonProps) {
  return (
    <ServerActionButton
      confirmLabel="Refresh Hardware"
      description={
        <>
          <span className="block">
            Re-probes <span className="font-mono">{hostname}</span> for its
            current CPU, RAM, and disk totals and updates the{" "}
            <span className="font-mono">servers</span> row. Use this after
            physically adding RAM, swapping the CPU, or expanding the root disk
            — the values captured during bootstrap go stale the moment the
            hardware changes.
          </span>
          <span className="block">Read-only on the host:</span>
          <ul className="ml-4 list-disc space-y-1 text-xs">
            <li>
              <span className="font-mono">nproc</span> → total vCPUs
            </li>
            <li>
              <span className="font-mono">/proc/meminfo</span> → total RAM
            </li>
            <li>
              <span className="font-mono">df -B1G /</span> → root disk size
            </li>
          </ul>
          <span className="block text-xs text-muted-foreground">
            No reboot, no service restart. The allocated-resource counters are
            not touched here — they reflect customer cube usage and are
            reconciled separately.
          </span>
        </>
      }
      endpoint={`/api/orbit/servers/${serverId}/refresh-hardware`}
      errorMessage="Failed to enqueue hardware refresh"
      icon={<CpuIcon className="size-4" />}
      label="Refresh Hardware"
      successMessage="Hardware refresh enqueued — watch the activity log for the new totals"
      title={<>Refresh hardware totals on {hostname}?</>}
    />
  );
}
