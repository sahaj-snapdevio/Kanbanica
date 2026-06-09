"use client";

/**
 * "Update Caddy" button on the server detail page header. Visible only on
 * fully-setup servers (`setupPhase === "ready"`). Triggers
 * `POST /api/orbit/servers/[serverId]/update-caddy` which enqueues a
 * `server.update-caddy` job. The job upgrades the Caddy package to the
 * platform-pinned CADDY_VERSION, restarts the service, and verifies the
 * version — without touching phase state, rebooting, or changing Caddy
 * routes.
 */

import { ShieldCheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { ServerActionButton } from "@/components/orbit/server-action-button";

interface UpdateCaddyButtonProps {
  hostname: string;
  serverId: string;
}

export function UpdateCaddyButton({
  serverId,
  hostname,
}: UpdateCaddyButtonProps) {
  return (
    <ServerActionButton
      description={
        <>
          <span className="block">
            This upgrades the Caddy package on{" "}
            <span className="font-mono">{hostname}</span> to the platform-pinned
            version, restarts the service, and verifies the installed version.
          </span>
          <span className="block">
            Caddy reloads its saved routing config on restart, so customer
            domains and the landing page stay routed. Phase state is not changed
            and the server is not rebooted.
          </span>
          <span className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
            <WarningCircleIcon
              className="mt-0.5 size-4 shrink-0"
              weight="fill"
            />
            <span className="block text-xs">
              The restart causes a sub-second blip on in-flight HTTP connections
              through this server.
            </span>
          </span>
        </>
      }
      endpoint={`/api/orbit/servers/${serverId}/update-caddy`}
      errorMessage="Failed to enqueue Caddy upgrade"
      icon={<ShieldCheckIcon className="size-4" />}
      label="Update Caddy"
      successMessage="Caddy upgrade enqueued — watch the activity log for progress"
      title={<>Upgrade Caddy on {hostname}?</>}
    />
  );
}
