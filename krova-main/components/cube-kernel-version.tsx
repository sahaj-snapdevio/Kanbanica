"use client";

/**
 * Per-Cube kernel version badge + "Cold-restart to upgrade" action.
 *
 * Renders different states based on `bootedKernelVersion` vs the server's
 * `currentKernelVersion`. Both store the MINOR component of the dotted
 * version scheme `${IMAGE_VERSION_MAJOR}.${minor}` (see lib/version.ts).
 *   - bootedKernelVersion null: nothing renders (cube provisioned before versioning shipped)
 *   - equal: green "Kernel v1.N (latest)"
 *   - booted < server: amber "Kernel v1.X · server has v1.Y · cold-restart to upgrade"
 *
 * Cold-restart kills the Firecracker process and relaunches via startCube,
 * which re-reads vmlinux from disk. Customer state under
 * /var/lib/krova/cubes/<id>/rootfs.ext4 is preserved.
 *
 * Used by both the customer cube detail page and the admin cube detail
 * page — pass `apiUrl` as the appropriate route (customer or admin).
 */

import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMutation } from "@/hooks/use-mutation";
import { formatImageVersion, isImageVersionOutdated } from "@/lib/version";

interface CubeKernelVersionProps {
  bootedKernelVersion: number | null;
  /** Whether the viewer can trigger restart. Customer: cube.manage permission.
   *  Admin: always true. */
  canRestart: boolean;
  /** POST URL: customer = /api/spaces/.../cold-restart, admin = /api/orbit/.../cold-restart */
  coldRestartUrl: string;
  cubeName: string;
  cubeStatus: string;
  serverCurrentKernelVersion: number;
}

export function CubeKernelVersion({
  cubeStatus,
  bootedKernelVersion,
  serverCurrentKernelVersion,
  coldRestartUrl,
  cubeName,
  canRestart,
}: CubeKernelVersionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { trigger: mutate, isMutating } = useMutation({
    onSuccess: () => router.refresh(),
  });

  // Don't render if the cube has no recorded version — provisioned before
  // versioning shipped. After the IMAGE_VERSION_MAJOR.minor scheme, minor=0
  // is a valid value (= v1.0 baseline), so we no longer guard on > 0.
  if (bootedKernelVersion == null) {
    return null;
  }

  const isOutdated = isImageVersionOutdated(
    bootedKernelVersion,
    serverCurrentKernelVersion
  );
  const restartable = canRestart && cubeStatus === "running" && isOutdated;
  const bootedLabel = formatImageVersion(bootedKernelVersion);
  const serverLabel = formatImageVersion(serverCurrentKernelVersion);

  async function confirmRestart() {
    await mutate({
      url: coldRestartUrl,
      method: "POST",
      successMessage:
        "Cold-restart enqueued — Cube will be briefly stopped and restarted with the latest kernel",
      errorMessage: "Failed to enqueue cold-restart",
    });
    setOpen(false);
  }

  // When the kernel is already on the latest, surface nothing — the
  // green "v1.8 (latest)" badge was just visual noise in the header.
  // We only call out the kernel when something actually needs attention:
  // an upgrade is available (and the operator can act on it).
  if (!isOutdated) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {restartable ? (
          <Button
            className="border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400"
            disabled={isMutating}
            onClick={() => setOpen(true)}
            size="sm"
            variant="outline"
          >
            {isMutating ? (
              <Spinner className="size-3.5" />
            ) : (
              <ArrowsClockwiseIcon className="size-3.5" />
            )}
            Restart to update kernel
          </Button>
        ) : (
          <Badge
            className="bg-amber-500/10 text-amber-700 dark:text-amber-400"
            variant="secondary"
          >
            <WarningCircleIcon className="size-3.5" weight="fill" />
            Kernel upgrade available (v{bootedLabel} → v{serverLabel})
          </Badge>
        )}
      </div>

      <ConfirmActionDialog
        busy={isMutating}
        confirmLabel="Restart to upgrade"
        description={
          <>
            <p>
              The Cube&apos;s Firecracker process will be stopped and relaunched
              with the latest kernel from disk. Expect ~5–15 seconds of downtime
              — your apps will briefly disconnect.
            </p>
            <div className="flex items-start gap-2 rounded-md bg-blue-500/10 p-2 text-blue-700 dark:text-blue-300">
              <CheckCircleIcon
                className="mt-0.5 size-4 shrink-0"
                weight="fill"
              />
              <p className="text-xs">
                Your customer data (root filesystem, installed software,
                databases) is preserved — only the Linux kernel changes.
              </p>
            </div>
            <p>
              After restart, the Cube comes back on the same internal IP and SSH
              port; existing connections re-establish automatically.
            </p>
          </>
        }
        destructive={false}
        onConfirm={() => void confirmRestart()}
        onOpenChange={setOpen}
        open={open}
        title={`Restart ${cubeName} to upgrade kernel?`}
      />
    </>
  );
}
