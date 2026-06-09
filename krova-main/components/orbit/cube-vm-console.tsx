"use client";

/**
 * VM Console — admin-only diagnostic surface for a Cube's serial console
 * and Firecracker process log. Pulled on demand (and on a manual refresh)
 * from the bare-metal host via SSH; does NOT poll, since the underlying
 * SSH read is not free.
 *
 * Use case: triage why a Cube failed to boot. The serial.log captures
 * everything the kernel printed before dying — kernel panic stack
 * traces, missing root device errors, init failures. The firecracker.log
 * captures Firecracker's own state changes and API call results.
 *
 * Hidden from non-admin users by virtue of being rendered only when
 * `orbit` is passed to CubeDetail.
 */

import {
  ArrowClockwiseIcon,
  CopyIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { copyToClipboard } from "@/lib/clipboard";
import { fetcher } from "@/lib/fetcher";

interface VmConsoleResponse {
  fetchedAt: string;
  firecrackerBytes: number;
  firecrackerLog: string;
  serialBytes: number;
  serialLog: string;
}

interface CubeVmConsoleProps {
  cubeId: string;
}

export function CubeVmConsole({ cubeId }: CubeVmConsoleProps) {
  // Fetch is manual: SWR with `null` key means "don't fetch automatically".
  // Operator clicks "Load Console" → we set the key → SWR fetches.
  const [enabled, setEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState<"serial" | "firecracker">(
    "serial"
  );
  const { data, error, isLoading, mutate } = useSWR<VmConsoleResponse>(
    enabled ? `/api/orbit/cubes/${cubeId}/vm-console?bytes=65536` : null,
    fetcher
  );

  function copy(text: string, label: string) {
    if (!text) {
      toast.info(`${label} is empty`);
      return;
    }
    copyToClipboard(text, `${label} copied`);
  }

  if (!enabled) {
    return (
      <div className="rounded-md border border-dashed p-6 text-center">
        <TerminalIcon className="mx-auto mb-2 size-6 text-muted-foreground" />
        <p className="text-sm font-medium">VM Console (admin)</p>
        <p className="mt-1 mb-3 text-xs text-muted-foreground">
          Pulls the last 64KB of the Cube&apos;s serial console and Firecracker
          log directly from the host. Use this to diagnose boot failures (kernel
          panics, init errors, missing devices).
        </p>
        <Button onClick={() => setEnabled(true)} size="sm" variant="outline">
          Load Console
        </Button>
      </div>
    );
  }

  const activeLog =
    activeTab === "serial" ? data?.serialLog : data?.firecrackerLog;
  const activeLabel = activeTab === "serial" ? "serial.log" : "firecracker.log";

  return (
    <div className="space-y-3 rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            onClick={() => setActiveTab("serial")}
            size="sm"
            variant={activeTab === "serial" ? "secondary" : "ghost"}
          >
            <TerminalIcon className="size-3.5" />
            serial.log
            {data ? (
              <span className="ml-1 text-xs text-muted-foreground">
                ({data.serialBytes.toLocaleString()}B)
              </span>
            ) : null}
          </Button>
          <Button
            onClick={() => setActiveTab("firecracker")}
            size="sm"
            variant={activeTab === "firecracker" ? "secondary" : "ghost"}
          >
            firecracker.log
            {data ? (
              <span className="ml-1 text-xs text-muted-foreground">
                ({data.firecrackerBytes.toLocaleString()}B)
              </span>
            ) : null}
          </Button>
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <span className="mr-2 text-xs text-muted-foreground">
              fetched {new Date(data.fetchedAt).toLocaleTimeString()}
            </span>
          )}
          <Button
            disabled={!activeLog}
            onClick={() => copy(activeLog ?? "", activeLabel)}
            size="icon-sm"
            title="Copy to clipboard"
            variant="ghost"
          >
            <CopyIcon className="size-3.5" />
          </Button>
          <Button
            disabled={isLoading}
            onClick={() => mutate()}
            size="icon-sm"
            title="Refresh"
            variant="ghost"
          >
            {isLoading ? (
              <Spinner className="size-3.5" />
            ) : (
              <ArrowClockwiseIcon className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="px-3 pb-3 text-sm text-destructive">
          Failed to load:{" "}
          {error instanceof Error ? error.message : String(error)}
        </div>
      ) : isLoading && !data ? (
        <div className="flex items-center gap-2 px-3 pb-3 text-sm text-muted-foreground">
          <Spinner className="size-3.5" />
          Reading from host via SSH…
        </div>
      ) : (
        <pre className="max-h-120 overflow-auto bg-muted/30 px-3 py-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
          {activeLog || `<${activeLabel} is empty or not present on host>`}
        </pre>
      )}
    </div>
  );
}
