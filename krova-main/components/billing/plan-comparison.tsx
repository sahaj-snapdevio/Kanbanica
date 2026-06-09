"use client";

/**
 * Full-width plan comparison grid. Lives on its own route
 * (`/[spaceId]/billing/plans`) so the cards have room to breathe — the
 * previous Dialog-based version squashed 4+ plan cards into a modal and
 * looked terrible.
 *
 * - Plans sort ascending by price so cards read left → right cheapest →
 *   most expensive.
 * - Current plan: primary ring + "Your plan" pill.
 * - The cheapest paid plan strictly above the current price: emerald ring
 *   + "Recommended" pill. Suppressed if the customer is already on top.
 * - Paid plans display face price + processing-fee breakdown + grossed-up
 *   total upfront so the customer is never surprised at checkout.
 * - One explicit CTA per card: Current / Upgrade / Downgrade / Subscribe /
 *   Cancel subscription. No mystery actions.
 */

import { ArrowLeftIcon, CheckIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  cancelPlan,
  changePlan,
  createSubscriptionCheckout,
} from "@/app/actions/subscriptions";
import { CancellationFeedbackFields } from "@/components/billing/cancellation-feedback-fields";
import { paymentBreakdown } from "@/components/billing/topup-math";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import type { CancellationReason } from "@/lib/billing/cancellation-reasons";
import { formatRam } from "@/lib/cube-options";
import { fmtUsd } from "@/lib/format";
import type { Plan } from "@/lib/plan/usage";
import { cn } from "@/lib/utils";

function fmtLimit(n: number | null): string {
  if (n === null) {
    return "Unlimited";
  }
  if (n === 0) {
    return "None";
  }
  return n.toLocaleString();
}

interface PlatformSettingsForPlanGrid {
  paymentFeeFlatUsd: number;
  paymentFeePercent: number;
}

export function PlanComparison({
  spaceId,
  currentPlanId,
  hasSubscription,
  cancelAtPeriodEnd,
  visiblePlans,
  freePlanCreditApplies,
  platformSettings,
}: {
  spaceId: string;
  currentPlanId: string;
  hasSubscription: boolean;
  /** Polar's pending-cancel flag (mirrored on `spaces.cancel_at_period_end`).
   *  When true, the Cancel button on the current-plan card is hidden — the
   *  customer manages the pending-cancel from the main /billing page's
   *  Resume banner. Without this gate, clicking Cancel here would surface
   *  the server-side "already scheduled to cancel" error. */
  cancelAtPeriodEnd: boolean;
  visiblePlans: Plan[];
  /** Free-plan one-time credit only applies on the owner's first owned
   *  space. Drives free-plan card labels so subsequent spaces don't see a
   *  `$X one-time` credit they didn't (and won't) actually receive. */
  freePlanCreditApplies: boolean;
  platformSettings: PlatformSettingsForPlanGrid;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [violations, setViolations] = useState<string[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancellationReason | null>(
    null
  );
  const [cancelComment, setCancelComment] = useState("");
  // Confirmation target for upgrade/downgrade/subscribe — shared dialog at
  // the bottom of the grid. Null = no dialog open.
  const [pendingAction, setPendingAction] = useState<null | {
    kind: "subscribe" | "upgrade" | "downgrade";
    planId: string;
    planName: string;
    priceUsd: number;
  }>(null);

  const currentPlan = visiblePlans.find((p) => p.id === currentPlanId);
  const currentPriceUsd = currentPlan
    ? Number.parseFloat(currentPlan.priceUsd)
    : 0;

  // Split the catalog: every space sees the public Trial / Starter / Pro /
  // Business tier on top; any plans assigned ONLY to this space (custom
  // tier) fall below a divider so the standard pricing reads cleanly first.
  // Both buckets sort ascending by price.
  const byPrice = (a: Plan, b: Plan) =>
    Number.parseFloat(a.priceUsd) - Number.parseFloat(b.priceUsd);
  const publicPlans = visiblePlans
    .filter((p) => p.visibility !== "custom")
    .sort(byPrice);
  const customPlans = visiblePlans
    .filter((p) => p.visibility === "custom")
    .sort(byPrice);

  // "Recommended" highlights the cheapest paid public tier strictly above
  // the customer's current price — only one card gets the green ring.
  const recommendedId =
    publicPlans.find((p) => Number.parseFloat(p.priceUsd) > currentPriceUsd)
      ?.id ?? null;

  function resetMessages() {
    setError(null);
    setViolations([]);
  }

  async function handleSubscribe(planId: string) {
    resetMessages();
    setIsPending(true);
    setPendingPlanId(planId);
    const result = await createSubscriptionCheckout(spaceId, planId);
    if ("error" in result) {
      setError(result.error ?? "Something went wrong. Please try again.");
      setIsPending(false);
      setPendingPlanId(null);
      return;
    }
    window.location.assign(result.data.checkoutUrl);
  }

  async function handleChange(planId: string) {
    resetMessages();
    setIsPending(true);
    setPendingPlanId(planId);
    const result = await changePlan(spaceId, planId);
    if ("error" in result) {
      setError(result.error ?? "Something went wrong. Please try again.");
      if ("violations" in result && Array.isArray(result.violations)) {
        setViolations(result.violations);
      }
      setIsPending(false);
      setPendingPlanId(null);
      return;
    }
    toast.success("Plan change requested — your plan will update shortly.");
    setIsPending(false);
    setPendingPlanId(null);
    router.push(`/${spaceId}/billing`);
    router.refresh();
  }

  async function handleCancelConfirm() {
    resetMessages();
    setIsPending(true);
    const result = await cancelPlan(spaceId, {
      reason: cancelReason ?? undefined,
      comment: cancelComment.trim() || undefined,
    });
    if ("error" in result) {
      setError(result.error ?? "Something went wrong. Please try again.");
      setIsPending(false);
      setCancelOpen(false);
      return;
    }
    toast.success("Subscription will end at the current period end.");
    setIsPending(false);
    setCancelOpen(false);
    setCancelReason(null);
    setCancelComment("");
    router.push(`/${spaceId}/billing`);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Button asChild className="-ml-2" size="sm" variant="ghost">
            <Link href={`/${spaceId}/billing`}>
              <ArrowLeftIcon className="size-4" />
              Back to Billing
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Choose your plan
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Each paid plan&apos;s monthly price is credited in full to your
              balance — the service fee shown on each card covers payment
              processing. Upgrades apply immediately. Downgrades require your
              current usage to fit the lower tier first.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            <span>{error}</span>
            {violations.length > 0 && (
              <ul className="mt-2 list-disc pl-4 text-sm">
                {violations.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Public tier grid — always rendered, always on top. */}
      <div
        className={cn(
          "grid gap-5",
          publicPlans.length === 2 && "sm:grid-cols-2",
          publicPlans.length === 3 && "sm:grid-cols-2 lg:grid-cols-3",
          publicPlans.length >= 4 &&
            "sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4"
        )}
      >
        {publicPlans.map((plan) => {
          const priceUsd = Number.parseFloat(plan.priceUsd);
          const isPaid = priceUsd > 0;
          const isCurrent = plan.id === currentPlanId;
          const isUpgrade = priceUsd > currentPriceUsd;
          const isRecommended =
            !isCurrent && plan.id === recommendedId && isPaid;
          const fee = isPaid
            ? paymentBreakdown(priceUsd, {
                percent: platformSettings.paymentFeePercent,
                flatUsd: platformSettings.paymentFeeFlatUsd,
              })
            : null;
          const isUnprovisioned = isPaid && !plan.polarProductId;
          const isThisOnePending = isPending && pendingPlanId === plan.id;

          const features: { label: string; value: string }[] = [
            {
              label: "Included credit",
              value: isPaid
                ? `$${fmtUsd(plan.includedCreditUsd)} per month`
                : freePlanCreditApplies
                  ? `$${fmtUsd(plan.includedCreditUsd)} one-time`
                  : "$0 — first space only",
            },
            {
              label: "Concurrent Cubes",
              value: fmtLimit(plan.maxConcurrentCubes),
            },
            {
              label: "Max Cube size",
              value: `${plan.maxVcpus} vCPU · ${formatRam(plan.maxRamMb)} · ${plan.maxDiskGb} GB`,
            },
            {
              label: "Team seats",
              value: fmtLimit(plan.maxSeats),
            },
            {
              label: "Backups",
              value: fmtLimit(plan.maxBackups),
            },
            {
              label: "Custom domains",
              value: fmtLimit(plan.maxDomains),
            },
          ];

          return (
            <div
              className={cn(
                "relative flex flex-col rounded-xl border bg-card p-6 shadow-sm transition",
                isCurrent && "border-primary ring-2 ring-primary/30",
                isRecommended &&
                  "border-emerald-500/40 ring-2 ring-emerald-500/20"
              )}
              key={plan.id}
            >
              {isCurrent && (
                <div className="absolute -top-2.5 left-5 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary-foreground uppercase">
                  Your plan
                </div>
              )}
              {isRecommended && (
                <div className="absolute -top-2.5 left-5 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-50 uppercase">
                  Recommended
                </div>
              )}

              <div className="space-y-1.5">
                <h3 className="text-lg font-semibold tracking-tight">
                  {plan.name}
                </h3>
                {plan.description && (
                  <p className="text-sm text-muted-foreground">
                    {plan.description}
                  </p>
                )}
              </div>

              <div className="mt-6 space-y-1">
                {isPaid ? (
                  <>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-4xl font-semibold tabular-nums">
                        ${priceUsd}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        / month
                      </span>
                    </div>
                    {fee && (
                      <p className="text-xs text-muted-foreground">
                        + ${fee.feeUsd.toFixed(2)} service fee · billed{" "}
                        <span className="font-mono text-foreground tabular-nums">
                          ${fee.totalUsd.toFixed(2)}
                        </span>
                      </p>
                    )}
                  </>
                ) : (
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono text-4xl font-semibold tabular-nums">
                      Free
                    </span>
                  </div>
                )}
              </div>

              <ul className="mt-6 space-y-3 border-t pt-6">
                {features.map((f) => (
                  <li className="flex items-start gap-2.5" key={f.label}>
                    <CheckIcon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        isCurrent
                          ? "text-primary"
                          : isRecommended
                            ? "text-emerald-500"
                            : "text-muted-foreground/70"
                      )}
                      weight="bold"
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-xs text-muted-foreground">{f.label}</p>
                      <p className="text-sm font-medium text-foreground">
                        {f.value}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-6 flex-1" />

              <div className="space-y-2">
                {isCurrent && isPaid ? (
                  cancelAtPeriodEnd ? (
                    <Button
                      asChild
                      className="w-full"
                      type="button"
                      variant="outline"
                    >
                      <Link href={`/${spaceId}/billing`}>
                        Manage pending cancel
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      disabled={isPending}
                      onClick={() => setCancelOpen(true)}
                      type="button"
                      variant="outline"
                    >
                      Cancel subscription
                    </Button>
                  )
                ) : isCurrent ? (
                  <Button
                    className="w-full"
                    disabled
                    type="button"
                    variant="outline"
                  >
                    Current plan
                  </Button>
                ) : isPaid ? (
                  isUnprovisioned ? (
                    <Button
                      className="w-full"
                      disabled
                      title="Plan not yet provisioned with the payment provider"
                      type="button"
                      variant="outline"
                    >
                      Provisioning…
                    </Button>
                  ) : hasSubscription ? (
                    <Button
                      className={cn(
                        "w-full",
                        isRecommended &&
                          "bg-emerald-600 hover:bg-emerald-600/90"
                      )}
                      disabled={isPending}
                      onClick={() =>
                        setPendingAction({
                          kind: isUpgrade ? "upgrade" : "downgrade",
                          planId: plan.id,
                          planName: plan.name,
                          priceUsd,
                        })
                      }
                      type="button"
                    >
                      {isThisOnePending && <Spinner className="size-4" />}
                      {isUpgrade ? "Upgrade" : "Downgrade"}
                    </Button>
                  ) : (
                    <Button
                      className={cn(
                        "w-full",
                        isRecommended &&
                          "bg-emerald-600 hover:bg-emerald-600/90"
                      )}
                      disabled={isPending}
                      onClick={() =>
                        setPendingAction({
                          kind: "subscribe",
                          planId: plan.id,
                          planName: plan.name,
                          priceUsd,
                        })
                      }
                      type="button"
                    >
                      {isThisOnePending && <Spinner className="size-4" />}
                      Subscribe
                    </Button>
                  )
                ) : hasSubscription ? (
                  cancelAtPeriodEnd ? (
                    <Button
                      asChild
                      className="w-full"
                      type="button"
                      variant="outline"
                    >
                      <Link href={`/${spaceId}/billing`}>
                        Manage pending cancel
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      disabled={isPending}
                      onClick={() => setCancelOpen(true)}
                      type="button"
                      variant="outline"
                    >
                      Cancel subscription
                    </Button>
                  )
                ) : (
                  <Button
                    className="w-full"
                    disabled
                    type="button"
                    variant="outline"
                  >
                    Free plan
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom-plan section — only renders when this space has any
          operator-assigned custom plans. Sits below a horizontal divider
          with its own header so it doesn't blend with the public tiers
          above. Cards lay out horizontally on wide screens, just like the
          public grid. */}
      {customPlans.length > 0 && (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <hr className="flex-1 border-border" />
            <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              Custom plans for this space
            </p>
            <hr className="flex-1 border-border" />
          </div>
          <div
            className={cn(
              "grid gap-5",
              customPlans.length === 1 && "sm:grid-cols-2 lg:grid-cols-3",
              customPlans.length === 2 && "sm:grid-cols-2 lg:grid-cols-3",
              customPlans.length === 3 && "sm:grid-cols-2 lg:grid-cols-3",
              customPlans.length >= 4 &&
                "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            )}
          >
            {customPlans.map((plan) => {
              const priceUsd = Number.parseFloat(plan.priceUsd);
              const isPaid = priceUsd > 0;
              const isCurrent = plan.id === currentPlanId;
              const isUpgrade = priceUsd > currentPriceUsd;
              const fee = isPaid
                ? paymentBreakdown(priceUsd, {
                    percent: platformSettings.paymentFeePercent,
                    flatUsd: platformSettings.paymentFeeFlatUsd,
                  })
                : null;
              const isUnprovisioned = isPaid && !plan.polarProductId;
              const isThisOnePending = isPending && pendingPlanId === plan.id;

              const features: { label: string; value: string }[] = [
                {
                  label: "Included credit",
                  value: isPaid
                    ? `$${fmtUsd(plan.includedCreditUsd)} per month`
                    : `$${fmtUsd(plan.includedCreditUsd)} one-time`,
                },
                {
                  label: "Concurrent Cubes",
                  value: fmtLimit(plan.maxConcurrentCubes),
                },
                {
                  label: "Max Cube size",
                  value: `${plan.maxVcpus} vCPU · ${formatRam(plan.maxRamMb)} · ${plan.maxDiskGb} GB`,
                },
                {
                  label: "Team seats",
                  value: fmtLimit(plan.maxSeats),
                },
                {
                  label: "Backups",
                  value: fmtLimit(plan.maxBackups),
                },
                {
                  label: "Custom domains",
                  value: fmtLimit(plan.maxDomains),
                },
              ];

              return (
                <div
                  className={cn(
                    "relative flex flex-col rounded-xl border bg-card p-6 shadow-sm transition",
                    isCurrent && "border-primary ring-2 ring-primary/30",
                    // Custom plans always carry an amber accent border so
                    // it's visually clear at a glance that this is a
                    // bespoke / operator-assigned tier, not a public one.
                    !isCurrent && "border-amber-500/30"
                  )}
                  key={plan.id}
                >
                  {isCurrent && (
                    <div className="absolute -top-2.5 left-5 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-primary-foreground uppercase">
                      Your plan
                    </div>
                  )}
                  {!isCurrent && (
                    <div className="absolute -top-2.5 left-5 rounded-full bg-amber-600 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-50 uppercase">
                      Custom
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <h3 className="text-lg font-semibold tracking-tight">
                      {plan.name}
                    </h3>
                    {plan.description && (
                      <p className="text-sm text-muted-foreground">
                        {plan.description}
                      </p>
                    )}
                  </div>

                  <div className="mt-6 space-y-1">
                    {isPaid ? (
                      <>
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono text-4xl font-semibold tabular-nums">
                            ${priceUsd}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            / month
                          </span>
                        </div>
                        {fee && (
                          <p className="text-xs text-muted-foreground">
                            + ${fee.feeUsd.toFixed(2)} service fee · billed{" "}
                            <span className="font-mono text-foreground tabular-nums">
                              ${fee.totalUsd.toFixed(2)}
                            </span>
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="flex items-baseline gap-1">
                        <span className="font-mono text-4xl font-semibold tabular-nums">
                          Free
                        </span>
                      </div>
                    )}
                  </div>

                  <ul className="mt-6 space-y-3 border-t pt-6">
                    {features.map((f) => (
                      <li className="flex items-start gap-2.5" key={f.label}>
                        <CheckIcon
                          className={cn(
                            "mt-0.5 size-4 shrink-0",
                            isCurrent ? "text-primary" : "text-amber-500"
                          )}
                          weight="bold"
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-xs text-muted-foreground">
                            {f.label}
                          </p>
                          <p className="text-sm font-medium text-foreground">
                            {f.value}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-6 flex-1" />

                  <div className="space-y-2">
                    {isCurrent && isPaid ? (
                      <Button
                        className="w-full"
                        disabled={isPending}
                        onClick={() => setCancelOpen(true)}
                        type="button"
                        variant="outline"
                      >
                        Cancel subscription
                      </Button>
                    ) : isCurrent ? (
                      <Button
                        className="w-full"
                        disabled
                        type="button"
                        variant="outline"
                      >
                        Current plan
                      </Button>
                    ) : isUnprovisioned ? (
                      <Button
                        className="w-full"
                        disabled
                        title="Plan not yet provisioned with the payment provider"
                        type="button"
                        variant="outline"
                      >
                        Provisioning…
                      </Button>
                    ) : hasSubscription ? (
                      <Button
                        className="w-full bg-amber-600 hover:bg-amber-600/90"
                        disabled={isPending}
                        onClick={() =>
                          setPendingAction({
                            kind: isUpgrade ? "upgrade" : "downgrade",
                            planId: plan.id,
                            planName: plan.name,
                            priceUsd,
                          })
                        }
                        type="button"
                      >
                        {isThisOnePending && <Spinner className="size-4" />}
                        {isUpgrade
                          ? "Switch to this plan"
                          : "Downgrade to this plan"}
                      </Button>
                    ) : (
                      <Button
                        className="w-full bg-amber-600 hover:bg-amber-600/90"
                        disabled={isPending}
                        onClick={() =>
                          setPendingAction({
                            kind: "subscribe",
                            planId: plan.id,
                            planName: plan.name,
                            priceUsd,
                          })
                        }
                        type="button"
                      >
                        {isThisOnePending && <Spinner className="size-4" />}
                        Subscribe
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        All paid plans bill monthly via Polar. Cancel anytime — your plan stays
        active until the current period ends.
      </p>

      <AlertDialog onOpenChange={setCancelOpen} open={cancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              Your space stays on its paid plan until the current period ends,
              then drops to the free plan. You can resubscribe at any time —
              your data and Cubes are untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <CancellationFeedbackFields
            comment={cancelComment}
            disabled={isPending}
            onCommentChange={setCancelComment}
            onReasonChange={setCancelReason}
            reason={cancelReason}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              Keep my plan
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                handleCancelConfirm();
              }}
            >
              {isPending && <Spinner className="size-4" />}
              Cancel subscription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Shared subscribe/upgrade/downgrade confirmation. */}
      <AlertDialog
        onOpenChange={(next) => {
          if (!next) {
            setPendingAction(null);
          }
        }}
        open={pendingAction !== null}
      >
        <AlertDialogContent>
          {pendingAction && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {pendingAction.kind === "subscribe" &&
                    `Subscribe to ${pendingAction.planName}?`}
                  {pendingAction.kind === "upgrade" &&
                    `Upgrade to ${pendingAction.planName}?`}
                  {pendingAction.kind === "downgrade" &&
                    `Downgrade to ${pendingAction.planName}?`}
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    {pendingAction.kind === "subscribe" && (
                      <p>
                        You&apos;ll be redirected to Polar&apos;s secure
                        checkout to complete payment ($
                        {pendingAction.priceUsd}/mo + processing fee).
                      </p>
                    )}
                    {pendingAction.kind === "upgrade" && (
                      <p>
                        Polar will charge the prorated difference{" "}
                        <strong>immediately</strong>, and your new plan takes
                        effect right now. You&apos;ll also receive prorated
                        additional credit for the remainder of the period.
                      </p>
                    )}
                    {pendingAction.kind === "downgrade" && (
                      <p>
                        Your plan changes immediately. Polar will credit the
                        unused portion of your current plan toward your next
                        invoice. Cubes over the new tier&apos;s limits may be
                        auto-slept.
                      </p>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>
                  Keep current plan
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    const action = pendingAction;
                    setPendingAction(null);
                    if (action.kind === "subscribe") {
                      handleSubscribe(action.planId);
                    } else {
                      handleChange(action.planId);
                    }
                  }}
                >
                  {isPending && <Spinner className="size-4" />}
                  {pendingAction.kind === "subscribe"
                    ? "Continue to checkout"
                    : pendingAction.kind === "upgrade"
                      ? "Upgrade & charge"
                      : "Downgrade"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
