"use client";

import {
  CopyIcon,
  KeyIcon,
  LaptopIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CubeStatusValue } from "@/db/schema/types";
import { copyToClipboard } from "@/lib/clipboard";

interface CubeDetailConnectTabProps {
  currentStatus: CubeStatusValue;
  sshCommand: string | null;
  sshDisabled?: boolean;
  sshTunnelExample: string | null;
}

export function CubeDetailConnectTab({
  sshCommand,
  sshTunnelExample,
  currentStatus,
  sshDisabled,
}: CubeDetailConnectTabProps) {
  if (!sshCommand) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {sshDisabled
          ? "SSH access is disabled. Re-enable it from the Networking tab to reconnect."
          : currentStatus === "pending" || currentStatus === "booting"
            ? "SSH access will be available once the Cube is ready."
            : currentStatus === "sleeping"
              ? "Wake the Cube to access SSH."
              : "SSH access is not available."}
      </p>
    );
  }

  return (
    <>
      {/* SSH Access */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <TerminalIcon className="size-4" />
          SSH Access
        </div>
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3">
          <code className="min-w-0 flex-1 truncate font-mono text-sm">
            {sshCommand}
          </code>
          <Button
            aria-label="Copy SSH command"
            onClick={() => copyToClipboard(sshCommand)}
            size="icon-xs"
            variant="ghost"
          >
            <CopyIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Port Forwarding */}
      {sshTunnelExample && (
        <div className="space-y-2 border-t pt-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <LaptopIcon className="size-4" />
            Port Forwarding
            <Badge
              className="border-0 text-[10px] font-normal"
              variant="secondary"
            >
              Local Testing
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Access services running on your Cube from your local machine via an
            encrypted SSH tunnel — without exposing anything publicly. Best for
            previewing and testing before going live.
          </p>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3">
            <code className="min-w-0 flex-1 truncate font-mono text-sm">
              {sshTunnelExample}
            </code>
            <Button
              aria-label="Copy port forwarding command"
              onClick={() => copyToClipboard(sshTunnelExample)}
              size="icon-xs"
              variant="ghost"
            >
              <CopyIcon className="size-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Replace <code className="font-mono">3000</code> with the port your
            service listens on, then visit{" "}
            <code className="font-mono">localhost:3000</code> in your browser.
            Works with any service — web apps, APIs, databases, etc.
          </p>
        </div>
      )}

      {/* SSH Key hint */}
      <div className="flex items-center gap-1.5 border-t pt-4 text-xs text-muted-foreground">
        <KeyIcon className="size-3.5 shrink-0" />
        <span>
          Your SSH key was added during Cube creation. To manage keys, SSH in
          and edit <code className="font-mono">~/.ssh/authorized_keys</code>.
          Use <code className="font-mono">ssh -i ~/.ssh/your_key ...</code> if
          it&apos;s not your default key.
        </span>
      </div>
    </>
  );
}
