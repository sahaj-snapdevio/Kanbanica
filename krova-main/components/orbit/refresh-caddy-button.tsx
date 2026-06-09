"use client";

/**
 * "Refresh Routing" button on the server detail page header. Visible only on
 * fully-setup servers (`setupPhase === "ready"`). Triggers
 * `POST /api/orbit/servers/[serverId]/caddy/refresh` which enqueues a
 * `server.refresh-caddy` job.
 *
 * The job re-asserts the server's entire external routing state: both
 * Cloudflare DNS records (proxied origin +
 * DNS-only connect), the Origin CA cert on Caddy (from the platform env),
 * and the Caddy `srv0` routes array (landing route + every customer
 * custom-domain route from `domain_mappings`) plus the ACME automation
 * policy. Used to heal a server after a hostname change, rotate the Origin
 * CA cert, or self-heal drift between Caddy and the DB — without the CLI.
 */

import { ArrowsClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { ServerActionButton } from "@/components/orbit/server-action-button";

interface RefreshCaddyButtonProps {
  hostname: string;
  serverId: string;
}

export function RefreshCaddyButton({
  serverId,
  hostname,
}: RefreshCaddyButtonProps) {
  return (
    <ServerActionButton
      description={
        <>
          <span className="block">
            This re-asserts every part of{" "}
            <span className="font-mono">{hostname}</span>&apos;s external
            routing from the current platform state — idempotent, safe to
            re-run:
          </span>
          <ul className="ml-4 list-disc space-y-1 text-xs">
            <li>
              <strong>Cloudflare DNS</strong> — both derived records (proxied{" "}
              <span className="font-mono">{hostname}</span> origin + DNS-only{" "}
              <span className="font-mono">connect.</span>
              {hostname}), created or updated
            </li>
            <li>
              <strong>Origin CA cert</strong> — re-installed on Caddy from the
              platform env (picks up a rotated cert)
            </li>
            <li>
              <strong>Caddy routes</strong> — the bare-server landing route and
              its ACME policy, plus every customer custom-domain route from{" "}
              <span className="font-mono">domain_mappings</span>, swapped in one
              atomic PATCH
            </li>
          </ul>
          <span className="block">
            Applied as a single atomic PATCH — no routing gap, no half-applied
            state. TCP/SSH mappings are not touched.
          </span>
          <span className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
            <WarningCircleIcon
              className="mt-0.5 size-4 shrink-0"
              weight="fill"
            />
            <span className="block text-xs">
              Any Caddy route added outside the normal domain flow will be
              dropped — the database is the source of truth for the rebuilt
              routes array.
            </span>
          </span>
        </>
      }
      endpoint={`/api/orbit/servers/${serverId}/caddy/refresh`}
      errorMessage="Failed to enqueue routing refresh"
      icon={<ArrowsClockwiseIcon className="size-4" />}
      label="Refresh Routing"
      successMessage="Routing refresh enqueued — watch the activity log for progress"
      title={<>Re-sync routing for {hostname}?</>}
    />
  );
}
