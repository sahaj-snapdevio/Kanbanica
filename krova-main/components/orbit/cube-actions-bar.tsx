"use client";

/**
 * Client wrapper for the orbit cube detail header. Hosts the Transfer
 * button + sheet so the parent RSC page can stay server-rendered.
 *
 * Other admin actions (force-stop, force-delete, purge) already live on
 * the cubes-table — this bar focuses on the operations that benefit
 * from a focused detail view (Transfer, future: live resize ops).
 */

import {
  ArrowsLeftRightIcon,
  ArrowsOutIcon,
  MagnifyingGlassIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  type CubeResizeServer,
  CubeResizeSheet,
} from "@/components/cube-resize-sheet";
import { CubeTransferCheckSheet } from "@/components/orbit/cube-transfer-check-sheet";
import { CubeTransferSheet } from "@/components/orbit/cube-transfer-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { CubeStatusValue } from "@/db/schema/types";
import { isActiveTransferState } from "@/lib/status-display";

interface Cube {
  diskLimitGb: number;
  hasVirtioMem: boolean;
  id: string;
  name: string;
  ramMb: number;
  status: CubeStatusValue;
  transferState: string;
  vcpus: number;
}

export function CubeActionsBar({
  cube,
  server,
}: {
  cube: Cube;
  server: CubeResizeServer | null;
}) {
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferCheckOpen, setTransferCheckOpen] = useState(false);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [isCancelling, startCancelTransition] = useTransition();

  // Same gates as POST /api/orbit/cubes/[cubeId]/transfer — disable the
  // button so admins don't get a 400 on submit.
  const transferEligible =
    (cube.status === "running" || cube.status === "sleeping") &&
    (cube.transferState === "idle" || cube.transferState === "failed");

  // Mirrors enqueueResize gates — running/sleeping with no transfer in
  // flight, plus virtio-mem capability.
  const resizeEligible =
    cube.hasVirtioMem &&
    (cube.status === "running" || cube.status === "sleeping") &&
    (cube.transferState === "idle" || cube.transferState === "failed");

  // Active = snapshotting | restoring | finalizing | cancelling (the shared
  // single source of truth, so this can't drift from the badge logic).
  const transferActive = isActiveTransferState(cube.transferState);
  const transferCancelling = cube.transferState === "cancelling";

  function handleCancelConfirm() {
    startCancelTransition(async () => {
      try {
        const res = await fetch(`/api/orbit/cubes/${cube.id}/transfer/cancel`, {
          method: "POST",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(
            (data as { error?: string }).error ?? "Failed to cancel transfer"
          );
          return;
        }
        toast.success("Transfer cancellation requested — cleanup in progress");
        setCancelDialogOpen(false);
      } catch {
        toast.error("Failed to cancel transfer — check your connection");
      }
    });
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {transferActive ? (
          // Mid-transfer: every other action would disrupt the in-flight rootfs
          // copy, so the only control offered is the cancel escape hatch.
          <Button
            disabled={transferCancelling || isCancelling}
            onClick={() => setCancelDialogOpen(true)}
            title={
              transferCancelling
                ? "Cancellation in progress…"
                : "Abort this transfer and restore the cube"
            }
            type="button"
            variant="destructive"
          >
            {transferCancelling || isCancelling ? (
              <Spinner className="size-4" />
            ) : (
              <XCircleIcon className="size-4" />
            )}
            {transferCancelling ? "Cancelling…" : "Cancel Transfer"}
          </Button>
        ) : (
          <>
            <Button
              disabled={!resizeEligible}
              onClick={() => setResizeOpen(true)}
              title={
                resizeEligible
                  ? undefined
                  : cube.hasVirtioMem
                    ? `Cube must be running or sleeping with no transfer in progress (status: ${cube.status}, transfer: ${cube.transferState})`
                    : "Cube was provisioned before live-resize support; contact support"
              }
              type="button"
              variant="outline"
            >
              <ArrowsOutIcon className="size-4" />
              Resize
            </Button>
            <Button
              onClick={() => setTransferCheckOpen(true)}
              title="Check transfer compatibility before migrating"
              type="button"
              variant="outline"
            >
              <MagnifyingGlassIcon className="size-4" />
              Transfer Check
            </Button>
            <Button
              disabled={!transferEligible}
              onClick={() => setTransferOpen(true)}
              title={
                transferEligible
                  ? undefined
                  : `Cube must be running or sleeping with no transfer in progress (status: ${cube.status}, transfer: ${cube.transferState})`
              }
              type="button"
              variant="outline"
            >
              <ArrowsLeftRightIcon className="size-4" />
              Transfer
            </Button>
          </>
        )}
      </div>

      <CubeTransferCheckSheet
        cube={cube}
        onOpenChange={setTransferCheckOpen}
        open={transferCheckOpen}
      />
      <CubeTransferSheet
        cube={cube}
        onOpenChange={setTransferOpen}
        open={transferOpen}
      />
      <CubeResizeSheet
        cube={cube}
        endpoint={`/api/orbit/cubes/${cube.id}/resize`}
        onOpenChange={setResizeOpen}
        open={resizeOpen}
        server={server}
      />

      <AlertDialog onOpenChange={setCancelDialogOpen} open={cancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel transfer?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This will abort the in-progress transfer of{" "}
                  <strong className="text-foreground">{cube.name}</strong> and
                  clean up any partial state on the destination server.
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>The destination cube directory will be deleted.</li>
                  <li>
                    If the source cube was paused for cutover, it will be woken
                    and come back online automatically.
                  </li>
                  <li>
                    The transfer state will be reset to{" "}
                    <code className="font-mono text-xs">failed</code> — you can
                    retry the transfer afterwards.
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isCancelling}>
              Keep running
            </AlertDialogCancel>
            <AlertDialogAction
              className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
              disabled={isCancelling}
              onClick={handleCancelConfirm}
            >
              {isCancelling && <Spinner className="size-4" />}
              Yes, cancel transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
