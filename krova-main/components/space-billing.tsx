"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  CheckIcon,
  ClockIcon,
  CurrencyDollarIcon,
  FunnelIcon,
  GearIcon,
  InfoIcon,
  LightningIcon,
  PlusIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  cancelPlan,
  openCustomerPortal,
  resumePlan,
} from "@/app/actions/subscriptions";
import { AddCreditsSheet } from "@/components/billing/add-credits-sheet";
import { BillingSettingsSheet } from "@/components/billing/billing-settings-sheet";
import { CancellationFeedbackFields } from "@/components/billing/cancellation-feedback-fields";
import { paymentBreakdown } from "@/components/billing/topup-math";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DataTable } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Stat, StatGrid } from "@/components/ui/stat";
import type { CancellationReason } from "@/lib/billing/cancellation-reasons";
import { BILLING_DEBIT_TYPES } from "@/lib/billing-events";
import { cn } from "@/lib/utils";

const DATE_RANGES = [
  { value: "all", label: "All time", days: null as number | null },
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
];

interface BillingEvent {
  amount: number;
  createdAt: string;
  cubeId: string | null;
  cubeName: string | null;
  description: string | null;
  id: string;
  type:
    | "hourly_charge"
    | "prorated_charge"
    | "credit_grant"
    | "credit_topup"
    | "backup_storage_charge"
    | "sleep_storage_charge"
    | "credit_refund"
    | "plan_credit"
    | "overage_charge";
}

interface SpaceBillingProps {
  /** Polar's cancel-at-period-end flag (mirrored on `spaces.cancel_at_period_end`).
   *  When true, the subscription is still active until `currentPeriodEnd` but
   *  will then drop to the default plan. UI surfaces the "Ending on X" badge
   *  + the Resume button. False on a not-canceling subscription OR no sub. */
  cancelAtPeriodEnd: boolean;
  canManageBilling: boolean;
  creditBalance: number;
  /** ISO timestamp the current paid period ends. Null when there's no
   *  subscription. Used by the pending-cancel "Ending on X" copy. */
  currentPeriodEnd: string | null;
  /** Resolved plan row for the current plan + the EFFECTIVE limits (plan
   *  defaults merged with this space's per-space overrides). Drives the
   *  hero plan card. Plan picking lives on the dedicated `/billing/plans`
   *  route, so this component no longer needs the full visible-plans list. */
  currentPlan?: {
    id: string;
    name: string;
    priceUsd: string;
    includedCreditUsd: string;
    limits: {
      maxConcurrentCubes: number | null;
      maxVcpus: number;
      maxRamMb: number;
      maxDiskGb: number;
      maxSeats: number | null;
      maxBackups: number | null;
      maxDomains: number | null;
    };
  };
  /** True iff this space was the owner's first owned space — only then did
   *  it receive the free plan's one-time included credit at creation. The
   *  PlanFeatureList uses this to avoid advertising `$X one-time` on a free
   *  plan space that never actually received it. */
  freePlanCreditApplies: boolean;
  hasSubscription: boolean;
  initialEvents: BillingEvent[];
  isFreePlan: boolean;
  lowBalanceThreshold: number;
  overageCapUsd: number;
  overageEnabled: boolean;
  platformSettings: {
    paymentFeePercent: number;
    paymentFeeFlatUsd: number;
    creditTopupMinUsd: number;
    creditTopupMaxUsd: number;
    creditTopupDefaultUsd: number;
    overageCapMinUsd: number;
    overageCapMaxUsd: number;
    lowBalanceThresholdMinUsd: number;
  };
  rates: {
    vcpuRate: number;
    ramRate: number;
    diskRate: number;
  };
  spaceId: string;
  subscriptionStatus: string | null;
  summary: {
    totalCredited: number;
    totalCharged: number;
    totalGrants: number;
    totalTopups: number;
    totalPlanCredits: number;
  };
  thisPeriodOverageUsd: number;
  totalEvents: number;
  usage: {
    runningCubes: number;
    sleepingCubes: number;
    totalVcpus: number;
    totalRamMb: number;
    /** Sum across running + sleeping cubes (kept for backward compat). */
    totalDiskGb: number;
    /** Sum of `diskLimitGb` across running cubes only. */
    runningDiskGb: number;
    /** Sum of `diskLimitGb` across sleeping cubes only. */
    sleepingDiskGb: number;
    /** Disk above the free tier across RUNNING cubes — what the running
     *  compute disk component bills on. */
    billableDiskGb: number;
    /** Disk billed for sleep storage = full sleeping disk (no free tier
     *  per Rule 53). Exposed so the UI can render the sleep row with the
     *  same GB count + $/hr the worker actually bills. */
    sleepBillableDiskGb: number;
    hourlyBurn: number;
    /** Sleep-storage component of `hourlyBurn`. Subtract to get the
     *  pure running-compute burn. */
    hourlySleepStorageBurn: number;
    estimatedDailyBurn: number;
    estimatedMonthlyBurn: number;
  };
}

const FILTER_OPTIONS = [
  { value: "all", label: "All events" },
  { value: "hourly_charge", label: "Hourly charges" },
  { value: "prorated_charge", label: "Prorated charges" },
  { value: "credit_grant", label: "Credit grants" },
  { value: "credit_topup", label: "Top-ups" },
  { value: "backup_storage_charge", label: "Backup storage" },
  { value: "sleep_storage_charge", label: "Sleep storage" },
  { value: "plan_credit", label: "Plan credits" },
  { value: "overage_charge", label: "Overage charges" },
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  hourly_charge: "Hourly charge",
  prorated_charge: "Prorated charge",
  credit_grant: "Credit grant",
  credit_topup: "Top-up",
  backup_storage_charge: "Backup storage",
  sleep_storage_charge: "Sleep storage",
  credit_refund: "Refund",
  plan_credit: "Plan credit",
  overage_charge: "Overage charge",
};

const EVENT_TYPE_STYLES: Record<string, string> = {
  hourly_charge:
    "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
  prorated_charge:
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  credit_grant:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  credit_topup:
    "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  backup_storage_charge:
    "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  sleep_storage_charge:
    "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  credit_refund:
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  plan_credit:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  overage_charge:
    "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
};

// Charge/credit classification lives in `lib/billing-events.ts` —
// `BILLING_DEBIT_TYPES` is the single source of truth across the customer
// dashboard, this billing page, and any future surface (Rule 14).

export function SpaceBilling({
  spaceId,
  creditBalance,
  canManageBilling,
  currentPlan,
  isFreePlan,
  freePlanCreditApplies,
  subscriptionStatus,
  hasSubscription,
  cancelAtPeriodEnd,
  currentPeriodEnd,
  lowBalanceThreshold,
  overageEnabled,
  overageCapUsd,
  thisPeriodOverageUsd,
  summary,
  usage,
  rates,
  initialEvents,
  totalEvents,
  platformSettings,
}: SpaceBillingProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [events, setEvents] = useState<BillingEvent[]>(initialEvents);
  const [page, setPage] = useState(1);
  // Default page size is 10 — matches the platform-wide pagination spec.
  // The per-page selector (10/25/50/100) is rendered by the DataTable.
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [total, setTotal] = useState(totalEvents);
  const [billingInfoOpen, setBillingInfoOpen] = useState(false);

  const topupParam = searchParams.get("topup");
  const planParam = searchParams.get("plan");
  const [addCreditsOpen, setAddCreditsOpen] = useState(
    () => topupParam === "open" && canManageBilling && !isFreePlan
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancellationReason | null>(
    null
  );
  const [cancelComment, setCancelComment] = useState("");
  const [subscriptionMutationBusy, setSubscriptionMutationBusy] =
    useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const plansPageHref = `/${spaceId}/billing/plans`;

  // Direct cancel + resume handlers so the customer can manage their
  // subscription without navigating to /billing/plans. Both flow through
  // Polar -> webhook -> handleSubscriptionEvent -> spaces.cancel_at_period_end,
  // and `router.refresh()` re-fetches the column on success.
  async function handleCancelSubscription() {
    setSubscriptionMutationBusy(true);
    const result = await cancelPlan(spaceId, {
      reason: cancelReason ?? undefined,
      comment: cancelComment.trim() || undefined,
    });
    setSubscriptionMutationBusy(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(
      "Subscription will end at the current period end. You can resume any time before then."
    );
    setCancelDialogOpen(false);
    // Reset so a future cancel attempt starts with a clean form.
    setCancelReason(null);
    setCancelComment("");
    router.refresh();
  }

  async function handleResumeSubscription() {
    setSubscriptionMutationBusy(true);
    const result = await resumePlan(spaceId);
    setSubscriptionMutationBusy(false);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success("Subscription resumed — renewal will continue as scheduled.");
    setResumeDialogOpen(false);
    router.refresh();
  }

  async function handleOpenPortal() {
    setPortalBusy(true);
    const result = await openCustomerPortal(spaceId);
    if ("error" in result) {
      setPortalBusy(false);
      toast.error(result.error);
      return;
    }
    // Page navigates away — leave busy state set so the button stays disabled.
    window.location.assign(result.data.url);
  }

  const paramHandled = useRef(false);
  useEffect(() => {
    if (paramHandled.current) {
      return;
    }
    if (!topupParam && !planParam) {
      return;
    }
    paramHandled.current = true;
    if (topupParam === "success") {
      toast.success("Payment received — credits will appear shortly.");
    }
    if (planParam === "success") {
      toast.success("Subscription started — your plan will update shortly.");
    }
    if (planParam === "open" && canManageBilling) {
      // Legacy `?plan=open` deep-links now route to the dedicated
      // /billing/plans page rather than opening a dialog here.
      router.replace(plansPageHref);
      return;
    }
    router.replace(`/${spaceId}/billing`);
  }, [topupParam, planParam, spaceId, router, plansPageHref, canManageBilling]);

  const [dateRange, setDateRange] = useState<string>("all");

  const fetchEvents = useCallback(
    async (newPage: number, type: string, range: string, pageLimit: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(newPage),
          limit: String(pageLimit),
        });
        if (type !== "all") {
          params.set("type", type);
        }
        const dr = DATE_RANGES.find((r) => r.value === range);
        if (dr?.days) {
          const from = new Date();
          from.setUTCHours(0, 0, 0, 0);
          from.setUTCDate(from.getUTCDate() - dr.days);
          params.set("from", from.toISOString());
        }

        const res = await fetch(
          `/api/spaces/${spaceId}/billing?${params.toString()}`
        );
        if (!res.ok) {
          return;
        }

        const data = await res.json();
        setEvents(data.events);
        setTotal(data.pagination.totalEvents);
        setPage(data.pagination.page);
      } finally {
        setLoading(false);
      }
    },
    [spaceId]
  );

  function handleTypeFilter(value: string) {
    setTypeFilter(value);
    fetchEvents(1, value, dateRange, pageSize);
  }

  function handleDateRange(value: string) {
    setDateRange(value);
    fetchEvents(1, typeFilter, value, pageSize);
  }

  function handlePageChange(next: number) {
    fetchEvents(next, typeFilter, dateRange, pageSize);
  }

  function handlePageSizeChange(nextSize: number) {
    setPageSize(nextSize);
    fetchEvents(1, typeFilter, dateRange, nextSize);
  }

  // Balance tone + runway estimates.
  const hoursRemaining =
    usage.hourlyBurn > 0 ? creditBalance / usage.hourlyBurn : null;
  const daysRemaining = hoursRemaining === null ? null : hoursRemaining / 24;
  const lowBalance = creditBalance <= lowBalanceThreshold;

  const balanceTone: "destructive" | "warning" | "success" =
    creditBalance < 1 ? "destructive" : lowBalance ? "warning" : "success";

  // Plan + subscription summary copy.
  const currentPlanPrice = currentPlan
    ? Number.parseFloat(currentPlan.priceUsd)
    : 0;
  const currentPlanFee =
    currentPlanPrice > 0
      ? paymentBreakdown(currentPlanPrice, {
          percent: platformSettings.paymentFeePercent,
          flatUsd: platformSettings.paymentFeeFlatUsd,
        })
      : null;

  const subscriptionLabel = (() => {
    if (!hasSubscription) {
      return isFreePlan
        ? "No subscription — free plan"
        : "No active subscription";
    }
    // Polar keeps a canceling subscription in `status="active"` until the
    // current period actually ends — `cancelAtPeriodEnd` is the
    // "ending soon" signal, not the status string. Surface it loudly so
    // the customer is never confused about whether they're still being
    // billed (they're not, but service runs through `currentPeriodEnd`).
    if (cancelAtPeriodEnd && subscriptionStatus === "active") {
      return "Ending at period end";
    }
    if (subscriptionStatus === "active") {
      return "Active";
    }
    if (subscriptionStatus === "past_due") {
      return "Past due — payment failed";
    }
    if (subscriptionStatus === "canceled") {
      return "Ending at period end";
    }
    if (subscriptionStatus === "trialing") {
      return "Trialing";
    }
    return subscriptionStatus ?? "Active";
  })();

  const periodEndDate = currentPeriodEnd ? new Date(currentPeriodEnd) : null;

  const overagePct =
    overageCapUsd > 0
      ? Math.min(100, (thisPeriodOverageUsd / overageCapUsd) * 100)
      : 0;

  return (
    <div className="space-y-8">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Billing</PageHeaderTitle>
          <PageHeaderDescription>
            Manage your plan, top up credits, and review every charge.
          </PageHeaderDescription>
        </PageHeaderContent>
        {canManageBilling && (
          <PageHeaderActions>
            <Button
              onClick={() => setSettingsOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <GearIcon className="size-4" />
              Settings
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={plansPageHref}>Change plan</Link>
            </Button>
            {isFreePlan ? (
              <Button
                disabled
                size="sm"
                title="Subscribe to a paid plan to add prepaid credits"
                type="button"
              >
                <PlusIcon className="size-4" />
                Add credits
              </Button>
            ) : (
              <Button
                onClick={() => setAddCreditsOpen(true)}
                size="sm"
                type="button"
              >
                <PlusIcon className="size-4" />
                Add credits
              </Button>
            )}
          </PageHeaderActions>
        )}
      </PageHeader>

      {/* Past-due banner — high-priority alert above everything else */}
      {subscriptionStatus === "past_due" && (
        <Alert variant="destructive">
          <WarningCircleIcon className="size-4" weight="fill" />
          <AlertDescription>
            Your last subscription payment failed. Update your payment method to
            keep your plan — your Cubes will be auto-slept if the balance runs
            out.
          </AlertDescription>
        </Alert>
      )}

      {/* Hero — balance + plan side-by-side, equal width.
          Both cards are deliberately ~the same height: the balance side
          holds the big number + runway + action buttons, and the plan
          side holds the 6 effective-limit rows your plan actually grants
          (plan defaults merged with any per-space operator overrides). */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          className={cn(
            "flex flex-col",
            balanceTone === "destructive" && "border-rose-500/40",
            balanceTone === "warning" && "border-amber-500/40"
          )}
        >
          <CardContent className="flex flex-1 flex-col gap-4 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Credit balance
                </p>
                <div className="flex items-baseline gap-2">
                  <span
                    className={cn(
                      "font-mono text-4xl font-semibold tabular-nums",
                      balanceTone === "destructive" &&
                        "text-rose-600 dark:text-rose-400",
                      balanceTone === "warning" &&
                        "text-amber-600 dark:text-amber-400",
                      balanceTone === "success" && "text-foreground"
                    )}
                  >
                    ${creditBalance.toFixed(2)}
                  </span>
                  {lowBalance && (
                    <Badge
                      className={cn(
                        "text-xs",
                        balanceTone === "destructive"
                          ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      )}
                      variant="outline"
                    >
                      Low balance
                    </Badge>
                  )}
                </div>
                {daysRemaining !== null && daysRemaining < 999 ? (
                  <p
                    className={cn(
                      "text-sm",
                      daysRemaining < 3
                        ? "text-rose-600 dark:text-rose-400"
                        : daysRemaining < 7
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground"
                    )}
                  >
                    Roughly{" "}
                    <span className="font-mono tabular-nums">
                      {daysRemaining < 1
                        ? `${Math.max(1, Math.round(hoursRemaining ?? 0))} hours`
                        : `${Math.round(daysRemaining)} days`}
                    </span>{" "}
                    of runway at your current burn rate.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No Cubes are running right now — no credit is being
                    consumed.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Low-balance alert at{" "}
                  <span className="font-mono tabular-nums">
                    ${lowBalanceThreshold.toFixed(2)}
                  </span>
                  .
                </p>
              </div>
              <CurrencyDollarIcon className="size-8 shrink-0 text-muted-foreground/40" />
            </div>

            <div className="flex-1" />

            {canManageBilling && (
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                {isFreePlan ? (
                  <Button asChild size="sm">
                    <Link href={plansPageHref}>
                      Choose a paid plan to add credits
                    </Link>
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => setAddCreditsOpen(true)}
                      size="sm"
                      type="button"
                    >
                      <PlusIcon className="size-4" />
                      Top up
                    </Button>
                    <Button
                      onClick={() => setSettingsOpen(true)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Low-balance & overage settings
                    </Button>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Current plan — name, price, then a 6-row feature breakdown
            of the EFFECTIVE limits (plan + space overrides). */}
        <Card className="flex flex-col">
          <CardContent className="flex flex-1 flex-col gap-4 pt-6">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Current plan
                </p>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-2xl font-semibold tracking-tight">
                    {currentPlan?.name ?? "Free"}
                  </span>
                  {currentPlan && (
                    <span className="font-mono text-sm text-muted-foreground tabular-nums">
                      {currentPlanPrice === 0
                        ? "Free"
                        : `· $${currentPlanPrice}/mo${currentPlanFee ? ` (billed $${currentPlanFee.totalUsd.toFixed(2)})` : ""}`}
                    </span>
                  )}
                </div>
              </div>
              <Badge
                className={cn(
                  "shrink-0 text-xs",
                  subscriptionStatus === "active"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : subscriptionStatus === "past_due"
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400"
                      : "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-400"
                )}
                variant="outline"
              >
                {subscriptionLabel}
              </Badge>
            </div>

            {/* Pending-cancel banner — only when the subscription is
                still active but set to cancel at period end. Loud copy +
                inline Resume so the customer never feels trapped. */}
            {cancelAtPeriodEnd && hasSubscription && periodEndDate && (
              <Alert className="border-amber-500/30 bg-amber-500/10">
                <AlertDescription className="flex flex-col gap-2 text-amber-900 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm">
                    Subscription ends on{" "}
                    <strong>
                      {periodEndDate.toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </strong>
                    . You will keep your current plan until then.
                  </span>
                  {canManageBilling && (
                    <Button
                      className="shrink-0 self-start border-amber-600/40 bg-transparent text-amber-900 hover:bg-amber-100 sm:self-auto dark:text-amber-100 dark:hover:bg-amber-900/30"
                      disabled={subscriptionMutationBusy}
                      onClick={() => setResumeDialogOpen(true)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {subscriptionMutationBusy && (
                        <Spinner className="size-4" />
                      )}
                      Resume subscription
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {currentPlan?.limits && (
              <PlanFeatureList
                freePlanCreditApplies={freePlanCreditApplies}
                includedCreditUsd={Number.parseFloat(
                  currentPlan.includedCreditUsd
                )}
                isPaid={currentPlanPrice > 0}
                limits={currentPlan.limits}
              />
            )}

            <div className="flex-1" />

            {canManageBilling && (
              <div className="space-y-2">
                <Button asChild className="w-full" size="sm" variant="outline">
                  <Link href={plansPageHref}>
                    {hasSubscription ? "Change plan" : "Compare plans"}
                  </Link>
                </Button>
                {/* Manage in Polar — opens a pre-authenticated customer
                    portal session. Customer can update payment method,
                    download invoices, manage subscription. Only visible
                    when there IS a Polar customer to authenticate as. */}
                {hasSubscription && (
                  <Button
                    className="w-full"
                    disabled={portalBusy}
                    onClick={handleOpenPortal}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {portalBusy && <Spinner className="size-4" />}
                    Manage payment & invoices in Polar
                  </Button>
                )}
                {/* Direct cancel — only when there's a live subscription
                    that is not already pending-cancel. Previously the
                    customer had to navigate to /billing/plans, find their
                    current plan card, and click Cancel there — making the
                    cancellation flow feel hidden behind a Polar-dashboard
                    requirement. Now it's one click from this card. */}
                {hasSubscription && !cancelAtPeriodEnd && (
                  <Button
                    className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={subscriptionMutationBusy}
                    onClick={() => setCancelDialogOpen(true)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Cancel subscription
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cancel-subscription confirmation dialog. Polar sets
          cancelAtPeriodEnd=true; the customer keeps their plan + service
          through the rest of the period. The webhook persists the flag
          and the pending-cancel banner appears on this page. */}
      <ConfirmActionDialog
        busy={subscriptionMutationBusy}
        cancelLabel="Keep plan"
        confirmLabel="Cancel subscription"
        description={
          <>
            <p>
              Your space stays on its current paid plan until the period ends
              {periodEndDate
                ? ` on ${periodEndDate.toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}`
                : ""}
              , then drops to the free plan.
            </p>
            <p>
              You can resume your subscription any time before the period ends —
              no need to re-enter card details.
            </p>
          </>
        }
        extraContent={
          <CancellationFeedbackFields
            comment={cancelComment}
            disabled={subscriptionMutationBusy}
            onCommentChange={setCancelComment}
            onReasonChange={setCancelReason}
            reason={cancelReason}
          />
        }
        onConfirm={handleCancelSubscription}
        onOpenChange={setCancelDialogOpen}
        open={cancelDialogOpen}
        title="Cancel subscription?"
      />

      {/* Resume-subscription confirmation. Polar flips cancelAtPeriodEnd
          back to false; renewals continue. The webhook persists the flag
          and the pending-cancel banner disappears on this page. */}
      <ConfirmActionDialog
        busy={subscriptionMutationBusy}
        cancelLabel="Keep cancellation"
        confirmLabel="Resume subscription"
        description={
          <>
            <p>
              Your {currentPlan?.name ?? "current"} subscription will continue
              past
              {periodEndDate
                ? ` ${periodEndDate.toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}`
                : " the current period"}
              . Renewal will happen on the same date as before.
            </p>
            <p>No charge today — your next bill is your normal renewal.</p>
          </>
        }
        destructive={false}
        onConfirm={handleResumeSubscription}
        onOpenChange={setResumeDialogOpen}
        open={resumeDialogOpen}
        title="Resume subscription?"
      />

      {/* Overage bar — only when opted-in on a paid plan */}
      {overageEnabled && !isFreePlan && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium">Overage this billing period</p>
              <p className="font-mono text-sm tabular-nums">
                <span className="text-foreground">
                  ${thisPeriodOverageUsd.toFixed(2)}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  / ${overageCapUsd.toFixed(2)} cap
                </span>
              </p>
            </div>
            <Progress
              className={cn(
                "h-1.5",
                overagePct > 80
                  ? "*:data-[slot=progress-indicator]:bg-rose-500"
                  : overagePct > 50
                    ? "*:data-[slot=progress-indicator]:bg-amber-500"
                    : ""
              )}
              value={overagePct}
            />
            <p className="text-xs text-muted-foreground">
              Postpaid overage continues running your Cubes once prepaid credit
              hits zero. You&apos;ll be billed for any overage on your next
              subscription invoice.
            </p>
          </CardContent>
        </Card>
      )}

      {/* This-period stats */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">This space, all-time</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Lifetime totals across every charge and credit applied to this
            space.
          </p>
        </div>
        <StatGrid columns={3}>
          <Stat
            icon={<ArrowUpIcon />}
            label="Total credited"
            sublabel={`$${summary.totalGrants.toFixed(2)} grants · $${summary.totalTopups.toFixed(2)} top-ups · $${summary.totalPlanCredits.toFixed(2)} plan credit`}
            tone="success"
            value={`$${summary.totalCredited.toFixed(2)}`}
          />
          <Stat
            icon={<ArrowDownIcon />}
            label="Total spent"
            sublabel="Hourly + prorated + storage + overage"
            value={`$${summary.totalCharged.toFixed(2)}`}
          />
          <Stat
            icon={<LightningIcon />}
            label="Hourly burn rate"
            sublabel={`≈ $${usage.estimatedDailyBurn.toFixed(2)} / day · $${usage.estimatedMonthlyBurn.toFixed(2)} / mo`}
            tone={usage.hourlyBurn > 0 ? "warning" : "default"}
            value={`$${usage.hourlyBurn.toFixed(4)}`}
          />
        </StatGrid>
      </section>

      {/* Live usage + cost breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClockIcon className="size-4" />
            Live usage
          </CardTitle>
          <CardDescription>
            {usage.runningCubes === 0 && usage.sleepingCubes === 0
              ? "Nothing is running or sleeping. You aren't being charged right now."
              : usage.runningCubes === 0
                ? `${usage.sleepingCubes} sleeping ${usage.sleepingCubes === 1 ? "Cube" : "Cubes"} — only the disk component of each Cube's hourly rate applies.`
                : `Resources currently consumed by ${usage.runningCubes} running ${
                    usage.runningCubes === 1 ? "Cube" : "Cubes"
                  }${usage.sleepingCubes > 0 ? ` (plus ${usage.sleepingCubes} sleeping)` : ""}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usage.runningCubes === 0 && usage.sleepingCubes === 0 ? (
            <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
              Wake or create a Cube to see live cost breakdowns.
            </p>
          ) : usage.runningCubes === 0 ? (
            <div className="space-y-2">
              <p className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
                Compute charges (vCPU + RAM) are paused while every Cube is
                sleeping. The rootfs of each sleeping Cube still occupies host
                disk and is billed HOURLY at the same per-GB rate as running
                disk, on the FULL disk size (the free-disk tier does not apply
                to sleeping Cubes — idle storage costs are real).
              </p>
              <UsageRow
                cost={usage.hourlySleepStorageBurn}
                count={`${usage.sleepBillableDiskGb} GB`}
                label={`Sleep storage (${usage.sleepingCubes} ${
                  usage.sleepingCubes === 1 ? "Cube" : "Cubes"
                })`}
                rateLabel={`× $${rates.diskRate.toFixed(4)}/hr`}
              />
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <UsageRow
                  cost={usage.totalVcpus * rates.vcpuRate}
                  count={`${usage.totalVcpus}`}
                  label="vCPUs"
                  rateLabel={`× $${rates.vcpuRate.toFixed(4)}/hr`}
                />
                <UsageRow
                  cost={(usage.totalRamMb / 1024) * rates.ramRate}
                  count={`${(usage.totalRamMb / 1024).toFixed(1)} GB`}
                  label="RAM"
                  rateLabel={`× $${rates.ramRate.toFixed(4)}/hr`}
                />
                <UsageRow
                  cost={usage.billableDiskGb * rates.diskRate}
                  count={`${usage.billableDiskGb} GB`}
                  label="Disk"
                  rateLabel={`× $${rates.diskRate.toFixed(4)}/hr`}
                />
                <p className="pt-1 text-xs text-muted-foreground">
                  Every GB of allocated disk is billed — no overselling on RAM
                  or disk. Total running disk: {usage.runningDiskGb} GB.
                </p>
                {usage.sleepingCubes > 0 && (
                  <>
                    <UsageRow
                      cost={usage.hourlySleepStorageBurn}
                      count={`${usage.sleepBillableDiskGb} GB`}
                      label={`Sleep storage (${usage.sleepingCubes} ${
                        usage.sleepingCubes === 1 ? "Cube" : "Cubes"
                      })`}
                      rateLabel="× full disk × disk rate"
                    />
                    <p className="pt-1 text-xs text-muted-foreground">
                      Sleeping Cubes pay on the full {usage.sleepBillableDiskGb}{" "}
                      GB — the free-disk tier applies to running Cubes only.
                    </p>
                  </>
                )}
                {(() => {
                  const flatBurn =
                    Math.round(
                      (usage.totalVcpus * rates.vcpuRate +
                        (usage.totalRamMb / 1024) * rates.ramRate +
                        usage.billableDiskGb * rates.diskRate) *
                        10_000
                    ) / 10_000;
                  // The volume discount applies to running-compute only —
                  // compare against the compute portion of hourlyBurn so
                  // sleep-storage doesn't dilute the savings percentage.
                  const computeBurn =
                    Math.round(
                      (usage.hourlyBurn - usage.hourlySleepStorageBurn) * 10_000
                    ) / 10_000;
                  if (flatBurn > computeBurn) {
                    const savingsPct = Math.round(
                      ((flatBurn - computeBurn) / flatBurn) * 100
                    );
                    return (
                      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                        Volume discount applied — effective compute rate is{" "}
                        <span className="font-mono tabular-nums">
                          ${computeBurn.toFixed(4)}
                        </span>
                        /hr ({savingsPct}% off list).
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              <aside className="rounded-lg border bg-muted/30 p-4 lg:w-64">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Projected cost
                </p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex items-baseline justify-between">
                    <dt className="text-muted-foreground">Per hour</dt>
                    <dd className="font-mono tabular-nums">
                      ${usage.hourlyBurn.toFixed(4)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <dt className="text-muted-foreground">Per day</dt>
                    <dd className="font-mono tabular-nums">
                      ${usage.estimatedDailyBurn.toFixed(2)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <dt className="text-muted-foreground">Per month</dt>
                    <dd className="font-mono tabular-nums">
                      ${usage.estimatedMonthlyBurn.toFixed(2)}
                    </dd>
                  </div>
                </dl>
              </aside>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transaction history */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <CardTitle>Transaction history</CardTitle>
              <CardDescription>
                {total} total {total === 1 ? "event" : "events"} · most recent
                first
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FunnelIcon className="size-4 text-muted-foreground" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="w-36 justify-between font-normal"
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {DATE_RANGES.find((r) => r.value === dateRange)?.label ??
                      "All time"}
                    <CaretDownIcon className="size-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                  {DATE_RANGES.map((range) => (
                    <DropdownMenuItem
                      key={range.value}
                      onClick={() => handleDateRange(range.value)}
                    >
                      {range.label}
                      {dateRange === range.value && (
                        <CheckIcon className="ml-auto size-4" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="w-44 justify-between font-normal"
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {FILTER_OPTIONS.find((o) => o.value === typeFilter)
                      ?.label ?? "All events"}
                    <CaretDownIcon className="size-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                  {FILTER_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => handleTypeFilter(option.value)}
                    >
                      {option.label}
                      {typeFilter === option.value && (
                        <CheckIcon className="ml-auto size-4" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={[
              {
                id: "date",
                header: "Date",
                className: "whitespace-nowrap text-muted-foreground",
                cell: (event) =>
                  format(new Date(event.createdAt), "MMM d, yyyy HH:mm"),
              },
              {
                id: "type",
                header: "Type",
                cell: (event) => (
                  <Badge
                    className={cn(
                      "text-xs",
                      EVENT_TYPE_STYLES[event.type] ?? ""
                    )}
                    variant="outline"
                  >
                    {EVENT_TYPE_LABELS[event.type] ?? event.type}
                  </Badge>
                ),
              },
              {
                id: "cube",
                header: "Cube",
                className: "text-muted-foreground",
                cell: (event) =>
                  event.cubeName ?? (event.cubeId ? "Deleted Cube" : "—"),
              },
              {
                id: "description",
                header: "Description",
                className: "max-w-60 truncate text-muted-foreground",
                cell: (event) => event.description ?? "—",
              },
              {
                id: "amount",
                header: "Amount",
                numeric: true,
                className: "whitespace-nowrap",
                cell: (event) => {
                  const isDebit = BILLING_DEBIT_TYPES.has(event.type);
                  return (
                    <span
                      className={
                        isDebit
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }
                    >
                      {isDebit ? "−" : "+"}${Math.abs(event.amount).toFixed(4)}
                    </span>
                  );
                },
              },
            ]}
            data={events}
            emptyDescription="No billing events match these filters."
            emptyTitle="No billing events"
            loading={loading}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            pagination={{ page, pageSize, total }}
            rowKey={(event) => event.id}
          />
        </CardContent>
      </Card>

      <AddCreditsSheet
        onOpenChange={setAddCreditsOpen}
        open={addCreditsOpen}
        platformSettings={platformSettings}
        spaceId={spaceId}
      />
      <BillingSettingsSheet
        currentThreshold={lowBalanceThreshold}
        isFreePlan={isFreePlan}
        onOpenChange={setSettingsOpen}
        open={settingsOpen}
        overageCapUsd={overageCapUsd}
        overageEnabled={overageEnabled}
        platformSettings={platformSettings}
        spaceId={spaceId}
        subscriptionActive={subscriptionStatus === "active"}
        thisPeriodOverageUsd={thisPeriodOverageUsd}
      />
      {/* Plan selection lives on its own page (`/[spaceId]/billing/plans`)
          so the comparison cards have room to breathe. Every "Change plan"
          / "Compare plans" trigger above is a <Link> to that page. */}

      {/* How Billing Works — quiet collapsible at the bottom */}
      <Collapsible onOpenChange={setBillingInfoOpen} open={billingInfoOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer select-none">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <InfoIcon className="size-4" />
                  How billing works
                </CardTitle>
                <CaretDownIcon
                  className={cn(
                    "size-4 text-muted-foreground transition-transform",
                    billingInfoOpen && "rotate-180"
                  )}
                />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 border-t pt-4 text-sm text-muted-foreground">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <p className="font-medium text-foreground">Pay-as-you-go</p>
                  <p>
                    Charges are deducted from your credit balance for every hour
                    a Cube is running. Sleeping or stopped Cubes are not billed.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="font-medium text-foreground">
                    Hourly rate formula
                  </p>
                  <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
                    <p>hourly cost = vCPU + RAM + Disk</p>
                    <p className="mt-1 text-muted-foreground">
                      vCPU: count × ${rates.vcpuRate.toFixed(4)}/h
                    </p>
                    <p className="text-muted-foreground">
                      RAM: GB × ${rates.ramRate.toFixed(4)}/h
                    </p>
                    <p className="text-muted-foreground">
                      Disk: GB × ${rates.diskRate.toFixed(4)}/h
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Hourly charges</p>
                  <p>
                    Running Cubes are billed every hour for the elapsed time. 45
                    minutes of runtime = 0.75 hours of charge.
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    Prorated charges
                  </p>
                  <p>
                    Stopping or sleeping a Cube fires a final prorated charge
                    covering the partial hour of compute since the last hourly
                    bill.
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Sleep storage</p>
                  <p>
                    Sleeping Cubes stop accruing compute charges (no vCPU, no
                    RAM) but their rootfs still occupies host disk. We charge
                    HOURLY at the same per-GB disk rate as running disk, on the
                    FULL disk size — the free-disk tier does not apply to
                    sleeping Cubes. Wake or delete the Cube to stop the charge.
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Backup storage</p>
                  <p>
                    Pre-deletion backups are billed hourly at the backup-storage
                    rate for the compressed size. Delete them manually when no
                    longer needed.
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-dashed px-3 py-2 text-xs">
                <span className="font-medium text-foreground">
                  Zero balance:
                </span>{" "}
                When your balance reaches $0.00, every running Cube in this
                space auto-sleeps. No data is lost — top up and wake them to
                resume.
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

/** Six-row feature breakdown of the EFFECTIVE plan limits the space gets.
 *  Sits in the hero "Current plan" card so customers see at a glance what
 *  their plan actually allows — included credit, concurrent cube cap, max
 *  cube size, team seats, backups, and custom domains. The values reflect
 *  per-space overrides if an operator granted any. */
function PlanFeatureList({
  isPaid,
  includedCreditUsd,
  freePlanCreditApplies,
  limits,
}: {
  isPaid: boolean;
  includedCreditUsd: number;
  /** Free-plan one-time credit only applies on the owner's first owned
   *  space. When false on a free plan, show `$0` instead of advertising a
   *  one-time credit this space never received. */
  freePlanCreditApplies: boolean;
  limits: {
    maxConcurrentCubes: number | null;
    maxVcpus: number;
    maxRamMb: number;
    maxDiskGb: number;
    maxSeats: number | null;
    maxBackups: number | null;
    maxDomains: number | null;
  };
}) {
  const fmtLimit = (n: number | null) =>
    n === null ? "Unlimited" : n === 0 ? "None" : n.toLocaleString();
  const fmtRam = (mb: number) =>
    mb >= 1024
      ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`
      : `${mb} MB`;

  const includedCreditLabel = isPaid
    ? `$${includedCreditUsd.toFixed(0)} / month`
    : freePlanCreditApplies
      ? `$${includedCreditUsd.toFixed(0)} one-time`
      : "$0 — one-time credit only applies to your first space";

  const rows: { label: string; value: string }[] = [
    { label: "Included credit", value: includedCreditLabel },
    {
      label: "Concurrent Cubes",
      value: fmtLimit(limits.maxConcurrentCubes),
    },
    {
      label: "Max Cube size",
      value: `${limits.maxVcpus} vCPU · ${fmtRam(limits.maxRamMb)} · ${limits.maxDiskGb} GB`,
    },
    { label: "Team seats", value: fmtLimit(limits.maxSeats) },
    { label: "Backups", value: fmtLimit(limits.maxBackups) },
    { label: "Custom domains", value: fmtLimit(limits.maxDomains) },
  ];

  return (
    <dl className="divide-y divide-border border-t border-b">
      {rows.map((r) => (
        <div
          className="flex items-baseline justify-between gap-4 py-2 text-sm"
          key={r.label}
        >
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="text-right font-medium text-foreground">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function UsageRow({
  label,
  count,
  rateLabel,
  cost,
}: {
  label: string;
  count: string;
  rateLabel: string;
  cost: number;
}) {
  return (
    <div className="flex items-baseline justify-between rounded-md border bg-card px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="font-mono text-xs text-muted-foreground tabular-nums">
          {count} {rateLabel}
        </p>
      </div>
      <p className="font-mono text-sm font-medium tabular-nums">
        ${cost.toFixed(4)}
        <span className="text-xs text-muted-foreground"> /hr</span>
      </p>
    </div>
  );
}
