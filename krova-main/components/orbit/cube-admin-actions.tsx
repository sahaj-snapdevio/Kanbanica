"use client";

import {
  ArrowSquareOutIcon,
  MoonIcon,
  TrashIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { CubeStatusValue } from "@/db/schema/types";
import { useMutation } from "@/hooks/use-mutation";

interface CubeAdminActionsProps {
  cubeId: string;
  cubeName: string;
  spaceId: string;
  spaceOwnerId: string | null;
  status: CubeStatusValue;
}

/**
 * Force-state admin actions for the Orbit cube detail page. Kept distinct
 * from CubeActionsBar (resize / transfer) so the destructive operations
 * sit together and are visually separated from the routine ones.
 *
 * "Open as customer" calls the impersonation API and navigates to the
 * customer-side cube detail — preserved as an explicit opt-in (it used
 * to silently fire on every row-click in the cubes table).
 */
export function CubeAdminActions({
  cubeId,
  cubeName,
  spaceId,
  spaceOwnerId,
  status,
}: CubeAdminActionsProps) {
  const { trigger } = useMutation();
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const canSleep = status === "running";
  const canDelete = status !== "deleted";
  const canPurge = status === "deleted";

  async function handleSleep() {
    setActionTarget("sleep");
    await trigger({
      url: `/api/orbit/cubes/${cubeId}/force-stop`,
      method: "POST",
      successMessage: `Force-slept ${cubeName}`,
      errorMessage: "Failed to force sleep",
    });
    setActionTarget(null);
  }

  async function handleDelete() {
    setActionTarget("delete");
    await trigger({
      url: `/api/orbit/cubes/${cubeId}/force-delete`,
      method: "POST",
      successMessage: `Force-deleted ${cubeName}`,
      errorMessage: "Failed to force delete",
    });
    setActionTarget(null);
  }

  async function handlePurge() {
    setActionTarget("purge");
    await trigger({
      url: `/api/orbit/cubes/${cubeId}/purge`,
      method: "POST",
      successMessage: `Permanently purged ${cubeName}`,
      errorMessage: "Failed to purge",
    });
    setActionTarget(null);
  }

  async function handleOpenAsCustomer() {
    if (!spaceOwnerId) {
      toast.error("Space has no owner — cannot open as customer");
      return;
    }
    setOpening(true);
    try {
      const res = await fetch("/api/orbit/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: spaceOwnerId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? "Impersonation failed"
        );
      }
      window.location.href = `/${spaceId}/cubes/${cubeId}`;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Cannot impersonate this user"
      );
      setOpening(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        disabled={!spaceOwnerId || opening}
        onClick={handleOpenAsCustomer}
        title={
          spaceOwnerId
            ? "Impersonate the space owner and open the customer-facing cube page"
            : "Space has no owner — impersonation unavailable"
        }
        type="button"
        variant="secondary"
      >
        {opening ? (
          <Spinner className="size-4" />
        ) : (
          <ArrowSquareOutIcon className="size-4" />
        )}
        Open as customer
      </Button>

      {canSleep && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              disabled={actionTarget === "sleep"}
              type="button"
              variant="outline"
            >
              {actionTarget === "sleep" ? (
                <Spinner className="size-4" />
              ) : (
                <MoonIcon className="size-4" />
              )}
              Force sleep
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Force sleep Cube?</AlertDialogTitle>
              <AlertDialogDescription>
                This will immediately put <strong>{cubeName}</strong> to sleep
                without graceful shutdown.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleSleep}>
                Force sleep
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {canDelete && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              disabled={actionTarget === "delete"}
              type="button"
              variant="destructive"
            >
              {actionTarget === "delete" ? (
                <Spinner className="size-4" />
              ) : (
                <TrashIcon className="size-4" />
              )}
              Force delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Force delete Cube?</AlertDialogTitle>
              <AlertDialogDescription>
                Permanently destroys <strong>{cubeName}</strong> and releases
                all associated resources. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete}>
                Force delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {canPurge && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              disabled={actionTarget === "purge"}
              type="button"
              variant="destructive"
            >
              {actionTarget === "purge" ? (
                <Spinner className="size-4" />
              ) : (
                <WarningOctagonIcon className="size-4" />
              )}
              Purge permanently
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Permanently purge Cube?</AlertDialogTitle>
              <AlertDialogDescription>
                Hard-deletes the row for <strong>{cubeName}</strong> and erases
                all associated lifecycle, audit, and job logs. Billing events
                and backup records are preserved (cube reference set to NULL).
                Use this only when you no longer need the forensic trail. This
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
                onClick={handlePurge}
              >
                Purge permanently
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
