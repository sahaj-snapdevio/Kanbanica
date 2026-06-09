"use client";

/**
 * Page-header action bar for the plan-detail page. Owns the "Edit plan" sheet
 * open state, plus the inline buttons for Provision in Polar / Set as default
 * / Archive / Unarchive. Each action wraps the matching `app/actions/orbit-plans`
 * server action and surfaces failure via a toast.
 */

import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  PencilSimpleIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  type PlanFormInitial,
  PlanFormSheet,
} from "@/app/(orbit)/orbit/plans/_components/plan-form-sheet";
import {
  archivePlan,
  provisionPlanInPolar,
  setDefaultPlan,
  syncPlanPriceToPolar,
  unarchivePlan,
} from "@/app/actions/orbit-plans";
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

export interface PlanActionsBarPlan extends PlanFormInitial {
  isArchived: boolean;
  isDefaultForNewSpaces: boolean;
  polarProductId: string | null;
}

export function PlanActionsBar({
  plan,
  subscriberCount,
}: {
  plan: PlanActionsBarPlan;
  /** Active subscribers on this plan — drives the edit form's price-change
   *  confirmation dialog. */
  subscriberCount: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const priceUsd = Number.parseFloat(plan.priceUsd);
  const canProvision = !plan.isArchived && priceUsd > 0 && !plan.polarProductId;
  const canSyncPolarPrice =
    !plan.isArchived && priceUsd > 0 && !!plan.polarProductId;
  const canSetDefault =
    !plan.isDefaultForNewSpaces && !plan.isArchived && priceUsd === 0;

  function handleProvision() {
    startTransition(async () => {
      const result = await provisionPlanInPolar(plan.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Plan provisioned in Polar");
      router.refresh();
    });
  }

  function handleSyncPolarPrice() {
    startTransition(async () => {
      const result = await syncPlanPriceToPolar(plan.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Polar price synced — customer now charged $${result.data.grossedUpPriceUsd.toFixed(2)}`
      );
      router.refresh();
    });
  }

  function handleSetDefault() {
    startTransition(async () => {
      const result = await setDefaultPlan(plan.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Plan is now the default for new spaces");
      router.refresh();
    });
  }

  function handleArchive() {
    startTransition(async () => {
      const result = await archivePlan(plan.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Plan archived");
      router.refresh();
    });
  }

  function handleUnarchive() {
    startTransition(async () => {
      const result = await unarchivePlan(plan.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Plan unarchived");
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {canProvision && (
          <Button
            disabled={isPending}
            onClick={handleProvision}
            size="sm"
            type="button"
            variant="default"
          >
            <CloudArrowUpIcon className="size-4" />
            Provision in Polar
          </Button>
        )}
        {canSyncPolarPrice && (
          <Button
            disabled={isPending}
            onClick={handleSyncPolarPrice}
            size="sm"
            title="Push the current service-fee gross-up to the Polar product. Use after a service-fee change."
            type="button"
            variant="outline"
          >
            <CloudArrowUpIcon className="size-4" />
            Sync price to Polar
          </Button>
        )}
        {canSetDefault && (
          <Button
            disabled={isPending}
            onClick={handleSetDefault}
            size="sm"
            type="button"
            variant="outline"
          >
            <StarIcon className="size-4" />
            Set as default
          </Button>
        )}
        {plan.isDefaultForNewSpaces && (
          <Button
            aria-label="Already the default plan"
            disabled
            size="sm"
            type="button"
            variant="outline"
          >
            <CheckCircleIcon className="size-4" />
            Default plan
          </Button>
        )}
        {plan.isArchived ? (
          <Button
            disabled={isPending}
            onClick={handleUnarchive}
            size="sm"
            type="button"
            variant="outline"
          >
            <ArrowCounterClockwiseIcon className="size-4" />
            Unarchive
          </Button>
        ) : (
          <Button
            disabled={isPending}
            onClick={() => setArchiveOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <ArchiveIcon className="size-4" />
            Archive
          </Button>
        )}
        <Button
          disabled={isPending}
          onClick={() => setEditOpen(true)}
          size="sm"
          type="button"
          variant="default"
        >
          <PencilSimpleIcon className="size-4" />
          Edit plan
        </Button>
      </div>

      <PlanFormSheet
        initial={plan}
        mode="edit"
        onOpenChange={setEditOpen}
        open={editOpen}
        subscriberCount={subscriberCount}
      />

      <AlertDialog onOpenChange={setArchiveOpen} open={archiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {plan.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Archived plans are hidden from new checkouts. Existing subscribers
              keep running. The Polar product (if any) is also archived. You can
              unarchive any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={handleArchive}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
