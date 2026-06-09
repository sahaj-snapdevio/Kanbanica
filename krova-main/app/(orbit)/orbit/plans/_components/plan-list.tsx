"use client";

/**
 * Client wrapper for the Plans list page. Holds the create-sheet open state,
 * renders the three sections (Public / Custom / Archived), and dispatches
 * Duplicate / Archive / Unarchive actions inline.
 *
 * Heavy data fetching lives in the parent server component; this component
 * receives prepared rows and is purely interactive.
 */

import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  CopyIcon,
  DotsThreeVerticalIcon,
  PencilSimpleIcon,
  PlusIcon,
  TagIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { PlanFormSheet } from "@/app/(orbit)/orbit/plans/_components/plan-form-sheet";
import {
  archivePlan,
  duplicatePlan,
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { getPlanStatus } from "@/lib/plan-status";

export interface PlanListRow {
  allowOverage: boolean;
  allowTopup: boolean;
  assignedSpaceCount: number;
  description: string | null;
  id: string;
  includedCreditUsd: string;
  isArchived: boolean;
  isDefaultForNewSpaces: boolean;
  maxBackups: number | null;
  maxConcurrentCubes: number | null;
  maxDiskGb: number;
  maxDomains: number | null;
  maxRamMb: number;
  maxSeats: number | null;
  maxVcpus: number;
  name: string;
  polarProductId: string | null;
  priceUsd: string;
  slug: string;
  sortOrder: number;
  subscriberCount: number;
  visibility: "public" | "custom";
}

export function PlanList({ plans }: { plans: PlanListRow[] }) {
  const [createOpen, setCreateOpen] = useState(false);

  const publicPlans = plans
    .filter((p) => p.visibility === "public" && !p.isArchived)
    .sort(byOrderThenPrice);
  const customPlans = plans
    .filter((p) => p.visibility === "custom" && !p.isArchived)
    .sort(byOrderThenPrice);
  const archivedPlans = plans
    .filter((p) => p.isArchived)
    .sort(byOrderThenPrice);

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
            <p className="text-sm text-muted-foreground">
              Operator-editable plan catalog. Limits, prices, and visibility
              update without a redeploy.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <PlusIcon className="size-4" />
            New plan
          </Button>
        </div>

        <Section
          description="Visible to every space in the customer plan-selection sheet."
          emptyHint="No public plans yet. Create one to make it subscribeable platform-wide."
          plans={publicPlans}
          title="Public"
        />

        <Section
          description="Visible only to spaces explicitly assigned to the plan."
          emptyHint="No custom plans. Duplicate a public plan or create one and set visibility = Custom."
          plans={customPlans}
          title="Custom"
        />

        {archivedPlans.length > 0 && (
          <Section
            description="Hidden from new checkouts. Existing subscribers continue running."
            emptyHint="No archived plans."
            plans={archivedPlans}
            title="Archived"
          />
        )}
      </div>

      <PlanFormSheet
        initial={null}
        mode="create"
        onOpenChange={setCreateOpen}
        open={createOpen}
      />
    </>
  );
}

function byOrderThenPrice(a: PlanListRow, b: PlanListRow): number {
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }
  return Number.parseFloat(a.priceUsd) - Number.parseFloat(b.priceUsd);
}

function Section({
  title,
  description,
  plans,
  emptyHint,
}: {
  title: string;
  description: string;
  plans: PlanListRow[];
  emptyHint: string;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageWindow = useMemo(() => {
    const start = (page - 1) * pageSize;
    return plans.slice(start, start + pageSize);
  }, [plans, page, pageSize]);
  const [prevPageSize, setPrevPageSize] = useState(pageSize);
  if (prevPageSize !== pageSize) {
    setPrevPageSize(pageSize);
    setPage(1);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {plans.length === 0 ? (
          <Empty>
            <EmptyMedia variant="icon">
              <TagIcon className="size-5" />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No plans</EmptyTitle>
              <EmptyDescription>{emptyHint}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Badges</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Included credit</TableHead>
                  <TableHead className="text-right">Subscribers</TableHead>
                  <TableHead className="text-right">Assignments</TableHead>
                  <TableHead className="w-[3rem]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageWindow.map((p) => (
                  <Fragment key={p.id}>
                    <PlanRow plan={p} />
                  </Fragment>
                ))}
              </TableBody>
            </Table>
            <div className="border-t p-2">
              <TablePagination
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                page={page}
                pageSize={pageSize}
                total={plans.length}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlanRow({ plan }: { plan: PlanListRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [archiveOpen, setArchiveOpen] = useState(false);

  const price = Number.parseFloat(plan.priceUsd);
  const included = Number.parseFloat(plan.includedCreditUsd);

  function go() {
    router.push(`/orbit/plans/${plan.id}`);
  }

  function handleDuplicate() {
    startTransition(async () => {
      const result = await duplicatePlan(plan.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Plan duplicated");
      router.push(`/orbit/plans/${result.data.planId}`);
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
      <TableRow className="cursor-pointer" onClick={go}>
        <TableCell className="font-medium">
          <div className="flex flex-col">
            <span>{plan.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {plan.slug}
            </span>
          </div>
        </TableCell>
        <TableCell>
          {/* One status pill per plan; precedence + classes live in
               `lib/plan-status.ts` so the plan detail page renders the same. */}
          {(() => {
            const status = getPlanStatus({
              isArchived: plan.isArchived,
              isDefaultForNewSpaces: plan.isDefaultForNewSpaces,
              visibility: plan.visibility,
              priceUsd: price,
              polarProductId: plan.polarProductId,
            });
            return (
              <Badge className={status.className} variant="outline">
                {status.label}
              </Badge>
            );
          })()}
        </TableCell>
        <TableCell className="text-right font-mono">
          {price === 0 ? "Free" : `$${price.toFixed(2)}`}
        </TableCell>
        <TableCell className="text-right font-mono">
          ${included.toFixed(2)}
        </TableCell>
        <TableCell className="text-right">{plan.subscriberCount}</TableCell>
        <TableCell className="text-right">
          {plan.visibility === "custom" ? plan.assignedSpaceCount : "—"}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={isPending}
                size="icon"
                type="button"
                variant="ghost"
              >
                <DotsThreeVerticalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={go}>
                <PencilSimpleIcon className="size-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDuplicate}>
                <CopyIcon className="size-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {plan.isArchived ? (
                <DropdownMenuItem onClick={handleUnarchive}>
                  <ArrowCounterClockwiseIcon className="size-4" />
                  Unarchive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() => setArchiveOpen(true)}
                  variant="destructive"
                >
                  <ArchiveIcon className="size-4" />
                  Archive
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>

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
