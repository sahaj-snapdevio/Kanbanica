"use client";

import {
  ArchiveIcon,
  ArrowClockwiseIcon,
  ArrowsOutIcon,
  MoonIcon,
  PlayIcon,
  PowerIcon,
  TerminalIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  deleteCube,
  powerOffCube,
  restartCube,
  sleepCube,
  wakeCube,
} from "@/app/actions/cubes";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { CubeResizeSheet } from "@/components/cube-resize-sheet";
import { CubeStatusBadge } from "@/components/cube-status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PageHeaderTitle } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CubeStatusValue } from "@/db/schema/types";
import type { PlanCubeLimits } from "@/lib/cube-options";
import { isActiveTransferState } from "@/lib/status-display";

interface CubeDetailHeaderProps {
  backupStorageCostPerHour?: number;
  /** Whether the "Preserve backup before deleting" option is shown in the
   *  delete dialog. False when no storage backend is configured for the
   *  platform. Defaults to true for legacy callers. */
  canCreateBackup?: boolean;
  canManage: boolean;
  cubeId: string;
  cubeName: string;
  currentStatus: CubeStatusValue;
  diskLimitGb: number;
  hasVirtioMem: boolean;
  /** Optional badge slot rendered inline next to the status badge — e.g. the
   *  kernel-version badge. */
  inlineBadge?: ReactNode;
  isDeleted: boolean;
  /** Whether the space's plan allows backups (`maxBackups > 0`). When
   *  false (Trial), the checkbox is hidden entirely. When true (Starter+),
   *  the checkbox renders pre-checked to default customers into preserving
   *  data on delete — they must opt OUT, not opt IN. Defaults to true so
   *  pre-existing callers without the prop preserve their behavior. */
  planAllowsBackups?: boolean;
  /** Space's plan ceilings — clamps the resize sheet's inputs to what the
   *  server's `assertCubeWithinSizeV2` will accept. Optional: Orbit (admin)
   *  callers pass nothing and the sheet falls back to the global config
   *  range. */
  planLimits?: PlanCubeLimits;
  ramMb: number;
  spaceId: string;
  transferState: string;
  vcpus: number;
}

export function CubeDetailHeader({
  cubeId,
  cubeName,
  currentStatus,
  isDeleted,
  canManage,
  spaceId,
  vcpus,
  ramMb,
  diskLimitGb,
  hasVirtioMem,
  transferState,
  backupStorageCostPerHour,
  planLimits,
  canCreateBackup = true,
  planAllowsBackups = true,
  inlineBadge,
}: CubeDetailHeaderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Default-checked on paid plans (planAllowsBackups=true) so accidental
  // deletes preserve data; hidden entirely on Trial. Customers can still
  // opt out by unchecking before confirming.
  const [preserveBackup, setPreserveBackup] = useState(planAllowsBackups);
  const [resizeOpen, setResizeOpen] = useState(false);

  // Mirrors enqueueResize gates: virtio-mem capability + running/sleeping
  // + no transfer in flight.
  const resizeEligible =
    hasVirtioMem &&
    (currentStatus === "running" || currentStatus === "sleeping") &&
    (transferState === "idle" || transferState === "failed");

  // While a cross-server transfer is in flight, every lifecycle action
  // (restart / terminal / sleep / power-off / start / resize / delete) would
  // disrupt the copy of the live rootfs — so hide the whole action cluster and
  // show a paused hint instead. Cancelling a transfer is admin-only (Orbit).
  const transferActive = isActiveTransferState(transferState);

  function handleSleep() {
    startTransition(async () => {
      const result = await sleepCube(spaceId, cubeId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Sleep initiated");
      router.refresh();
    });
  }

  function handleWake() {
    startTransition(async () => {
      const result = await wakeCube(spaceId, cubeId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Wake initiated");
      router.refresh();
    });
  }

  function handleRestart() {
    startTransition(async () => {
      const result = await restartCube(spaceId, cubeId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Restart initiated");
      router.refresh();
    });
  }

  function handlePowerOff() {
    startTransition(async () => {
      const result = await powerOffCube(spaceId, cubeId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Power off initiated");
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteCube(spaceId, cubeId, {
        preserveBackup,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        preserveBackup
          ? "Cube deletion initiated with backup"
          : "Cube deletion initiated"
      );
      router.push(`/${spaceId}/cubes`);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <PageHeaderTitle>{cubeName}</PageHeaderTitle>
        <CubeStatusBadge status={currentStatus} transferState={transferState} />
        {inlineBadge}
      </div>
      {!isDeleted && transferActive && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Transfer in progress — actions are paused
        </div>
      )}
      {!isDeleted && !transferActive && (
        <div className="flex items-center gap-2">
          {canManage &&
            (currentStatus === "running" || currentStatus === "sleeping") &&
            (resizeEligible ? (
              <Button
                disabled={isPending}
                onClick={() => setResizeOpen(true)}
                variant="outline"
              >
                <ArrowsOutIcon className="size-4" />
                Resize
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* Wrap the disabled Button in a span so the tooltip
                      still triggers on hover — disabled buttons don't
                      receive pointer events themselves. */}
                  <span>
                    <Button disabled variant="outline">
                      <ArrowsOutIcon className="size-4" />
                      Resize
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  {hasVirtioMem ? (
                    <p>Cube is busy — wait until any transfer completes.</p>
                  ) : (
                    <div className="space-y-1.5 text-xs">
                      <p>
                        Live resize is unavailable — the Cube was booted on a
                        host kernel that does not support memory hot-plug.
                      </p>
                      <p>To enable it:</p>
                      <ol className="ml-0 list-decimal pl-4">
                        <li>Power off the Cube.</li>
                        <li>Start it again — it picks up the latest kernel.</li>
                      </ol>
                      <p className="text-muted-foreground">
                        If the issue persists, contact support.
                      </p>
                    </div>
                  )}
                </TooltipContent>
              </Tooltip>
            ))}
          {canManage && currentStatus === "running" && (
            <>
              <Button
                disabled={isPending}
                onClick={handleRestart}
                variant="outline"
              >
                {isPending ? (
                  <Spinner className="size-4" />
                ) : (
                  <ArrowClockwiseIcon className="size-4" />
                )}
                Restart
              </Button>
              <Button asChild variant="outline">
                <a
                  href={`/${spaceId}/cubes/${cubeId}/terminal`}
                  rel="noopener noreferrer"
                  target="_blank"
                  title="Open a terminal in a new tab"
                >
                  <TerminalIcon className="size-4" />
                  Terminal
                </a>
              </Button>
              <Button
                disabled={isPending}
                onClick={handleSleep}
                variant="outline"
              >
                {isPending ? (
                  <Spinner className="size-4" />
                ) : (
                  <MoonIcon className="size-4" />
                )}
                Sleep
              </Button>
              <Button
                disabled={isPending}
                onClick={handlePowerOff}
                variant="outline"
              >
                {isPending ? (
                  <Spinner className="size-4" />
                ) : (
                  <PowerIcon className="size-4" />
                )}
                Power Off
              </Button>
            </>
          )}
          {canManage && currentStatus === "sleeping" && (
            <Button disabled={isPending} onClick={handleWake} variant="outline">
              {isPending ? (
                <Spinner className="size-4" />
              ) : (
                <PlayIcon className="size-4" />
              )}
              Start
            </Button>
          )}
          {canManage &&
            currentStatus !== "stopping" &&
            currentStatus !== "pending" &&
            currentStatus !== "booting" && (
              <>
                <Button
                  disabled={isPending}
                  onClick={() => setDeleteOpen(true)}
                  variant="destructive"
                >
                  <TrashIcon className="size-4" />
                  Delete
                </Button>
                <ConfirmDestructiveDialog
                  busy={isPending}
                  confirmLabel={
                    preserveBackup ? "Backup & Delete" : "Delete Cube"
                  }
                  confirmText={cubeName}
                  confirmValue={deleteConfirm}
                  description={
                    <p>
                      This action cannot be undone. Type{" "}
                      <strong className="text-foreground">{cubeName}</strong> to
                      confirm.
                    </p>
                  }
                  extraContent={
                    // Preserve backup option — only shown when a storage
                    // backend is configured AND the space's plan includes
                    // backups (Trial = maxBackups 0 = hidden). Otherwise
                    // the action would fail at job time.
                    canCreateBackup && planAllowsBackups ? (
                      <div className="space-y-2 rounded-md border p-3">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={preserveBackup}
                            id="preserve-backup"
                            onCheckedChange={(checked) =>
                              setPreserveBackup(checked === true)
                            }
                          />
                          <div className="space-y-1">
                            <Label
                              className="cursor-pointer text-sm font-medium"
                              htmlFor="preserve-backup"
                            >
                              <ArchiveIcon className="mr-1 inline size-4" />
                              Preserve backup before deleting
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              Creates a snapshot of this Cube&apos;s disk and
                              saves its full configuration (CPU, RAM, disk,
                              domains, TCP mappings). You can redeploy an
                              identical Cube from the backup later.
                            </p>
                            {backupStorageCostPerHour != null &&
                              backupStorageCostPerHour > 0 && (
                                <p className="text-xs text-muted-foreground tabular-nums">
                                  Storage cost: $
                                  {backupStorageCostPerHour.toFixed(4)}
                                  /hr (~$
                                  {(backupStorageCostPerHour * 730).toFixed(2)}
                                  /mo) for {diskLimitGb} GB disk
                                </p>
                              )}
                          </div>
                        </div>
                      </div>
                    ) : null
                  }
                  onConfirm={handleDelete}
                  onConfirmValueChange={setDeleteConfirm}
                  onOpenChange={(open) => {
                    if (!open) {
                      setDeleteConfirm("");
                      setPreserveBackup(planAllowsBackups);
                    }
                    setDeleteOpen(open);
                  }}
                  open={deleteOpen}
                  title="Delete Cube"
                />
              </>
            )}
        </div>
      )}
      <CubeResizeSheet
        cube={{
          id: cubeId,
          name: cubeName,
          vcpus,
          ramMb,
          diskLimitGb,
          hasVirtioMem,
          status: currentStatus,
        }}
        endpoint={`/api/spaces/${spaceId}/cubes/${cubeId}/resize`}
        onOpenChange={setResizeOpen}
        open={resizeOpen}
        planLimits={planLimits}
        // Customer side does not expose server capacity. The pure
        // validateResize still runs all non-capacity checks (range, shrink,
        // no-op, virtio-mem) on the client; capacity is enforced server-side
        // and any failure surfaces inline via form.setError.
        server={null}
      />
    </div>
  );
}
