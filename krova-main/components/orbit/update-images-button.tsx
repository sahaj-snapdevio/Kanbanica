"use client";

/**
 * "Update Images" button on the server detail page header. Visible only on
 * fully-setup servers (`setupPhase === "ready"`). Triggers
 * `POST /api/orbit/servers/[serverId]/update-images` which enqueues a
 * `server.update-images` job. The job re-runs the same image-sync core as
 * the `pull_images` setup phase but without touching phase state or
 * rebooting — safe to run on active servers with customer Cubes scheduled
 * to them.
 *
 * Use after `pnpm build:images` produces new artifacts (e.g. a kernel
 * rebuild for additional features). Existing Cubes keep their currently-
 * loaded kernel until they next boot from cold; new Cubes pick up the
 * refreshed images immediately.
 */

import { CloudArrowDownIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { ServerActionButton } from "@/components/orbit/server-action-button";

interface UpdateImagesButtonProps {
  hostname: string;
  serverId: string;
}

export function UpdateImagesButton({
  serverId,
  hostname,
}: UpdateImagesButtonProps) {
  return (
    <ServerActionButton
      confirmLabel="Refresh Images"
      description={
        <>
          <span className="block">
            This re-runs the image-sync logic on{" "}
            <span className="font-mono">{hostname}</span> without touching phase
            state or rebooting. The server stays active throughout.
          </span>
          <span className="block">
            Each image in <span className="font-mono">platform_images</span> is
            SFTPed onto the box and verified by sha256:
          </span>
          <ul className="ml-4 list-disc space-y-1 text-xs">
            <li>
              <strong>Kernels</strong> — skipped if on-disk sha256 already
              matches (idempotent)
            </li>
            <li>
              <strong>Rootfs images</strong> — always re-uploaded (decompressed
              sha256 isn&apos;t recoverable)
            </li>
          </ul>
          <span className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
            <WarningCircleIcon
              className="mt-0.5 size-4 shrink-0"
              weight="fill"
            />
            <span className="block text-xs">
              Existing customer Cubes keep their currently-loaded kernel until
              they boot from cold (sleep + wake doesn&apos;t reload it). New
              Cubes get the refreshed images immediately.
            </span>
          </span>
        </>
      }
      endpoint={`/api/orbit/servers/${serverId}/update-images`}
      errorMessage="Failed to enqueue image update"
      icon={<CloudArrowDownIcon className="size-4" />}
      label="Update Images"
      successMessage="Image update enqueued — watch the activity log for progress"
      title={<>Refresh images on {hostname}?</>}
    />
  );
}
