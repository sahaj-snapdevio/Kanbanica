"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import type { CancellationReason } from "@/lib/billing/cancellation-reasons";
import { formatRam } from "@/lib/cube-options";
import { fmtUsd } from "@/lib/format";
import type { Plan } from "@/lib/plan/usage";

/** Render a limit value — `null` means unlimited, `0` means not included. */
function fmtLimit(n: number | null): string {
  if (n === null) {
    return "Unlimited";
  }
  if (n === 0) {
    return "None";
  }
  return String(n);
}

/** Subset of `PlatformSettings` this sheet needs — fee math for the paid-plan
 *  "+$X.XX fee" preview. */
interface PlatformSettingsForPlanSheet {
  paymentFeeFlatUsd: number;
  paymentFeePercent: number;
}

export function PlanSelectionSheet({
  spaceId,
  currentPlanId,
  hasSubscription,
  visiblePlans,
  open,
  onOpenChange,
  platformSettings,
}: {
  spaceId: string;
  /** `plans.id` of the space's current plan — drives the "Current" badge. */
  currentPlanId: string;
  hasSubscription: boolean;
  /** Plans visible to this space — `visiblePlansForSpace(spaceId)` output. */
  visiblePlans: Plan[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Operator-tunable fee config. Resolved server-side via
   *  `getPlatformSettings()` and threaded down so a mid-day operator change
   *  takes effect on the next page load without a redeploy. */
  platformSettings: PlatformSettingsForPlanSheet;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [violations, setViolations] = useState<string[]>([]);
  const [cancelReason, setCancelReason] = useState<CancellationReason | null>(
    null
  );
  const [cancelComment, setCancelComment] = useState("");
  // Pending confirmation target — drives the shared AlertDialog. Null = no
  // dialog open. `kind` distinguishes the three destructive/billing actions.
  const [pendingAction, setPendingAction] = useState<null | {
    kind: "subscribe" | "upgrade" | "downgrade";
    planId: string;
    planName: string;
    priceUsd: number;
  }>(null);

  // The current plan row (if it is in the visible-set). Used to determine
  // upgrade vs. downgrade by comparing `price_usd`.
  const currentPlan = visiblePlans.find((p) => p.id === currentPlanId);

  function resetMessages() {
    setError(null);
    setViolations([]);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      resetMessages();
    }
    onOpenChange(next);
  }

  async function handleSubscribe(planId: string) {
    resetMessages();
    setIsPending(true);
    const result = await createSubscriptionCheckout(spaceId, planId);
    if ("error" in result) {
      setError(result.error ?? "Something went wrong. Please try again.");
      setIsPending(false);
      return;
    }
    // Do not clear pending — page is navigating away.
    window.location.assign(result.data.checkoutUrl);
  }

  async function handleChange(planId: string) {
    resetMessages();
    setIsPending(true);
    const result = await changePlan(spaceId, planId);
    if ("error" in result) {
      setError(result.error ?? "Something went wrong. Please try again.");
      if ("violations" in result && Array.isArray(result.violations)) {
        setViolations(result.violations);
      }
      setIsPending(false);
      return;
    }
    toast.success("Plan change requested — your plan will update shortly.");
    setIsPending(false);
    handleOpenChange(false);
    router.refresh();
  }

  async function handleCancel() {
    resetMessages();
    setIsPending(true);
    const result = await cancelPlan(spaceId, {
      reason: cancelReason ?? undefined,
      comment: cancelComment.trim() || undefined,
    });
    if ("error" in result) {
      setError(result.error ?? "Something went wrong. Please try again.");
      setIsPending(false);
      return;
    }
    toast.success("Subscription will end at the period end.");
    setIsPending(false);
    setCancelReason(null);
    setCancelComment("");
    handleOpenChange(false);
    router.refresh();
  }

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Change plan</SheetTitle>
          <SheetDescription>
            Pick a plan for this space. Each paid plan&apos;s monthly price is
            credited in full to your balance; a small processing fee on top
            covers Polar&apos;s payment processing. Upgrades apply immediately;
            downgrades require your usage to fit the lower tier first.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                <span>{error}</span>
                {violations.length > 0 && (
                  <ul className="mt-2 list-disc pl-4">
                    {violations.map((v) => (
                      <li key={v}>{v}</li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}

          {visiblePlans
            // Hide free non-current plans from the customer picker — the
            // customer cannot self-subscribe to a free plan (the action
            // rejects with "Cannot subscribe to a free plan") and the only
            // action the picker can offer is a disabled "Free plan" button,
            // which is a dead-end. Free plans appear in the picker ONLY as
            // the current plan (so the customer can see what they're on)
            // or as the target of a "cancel subscription" downgrade from a
            // paid plan. Custom free plans assigned by an admin are still
            // honored — the space is on them via `spaces.plan_id`, they
            // just aren't shoppable here.
            .filter((plan) => {
              const isFree = Number.parseFloat(plan.priceUsd) <= 0;
              if (!isFree) {
                return true;
              }
              const isCurrent = plan.id === currentPlanId;
              if (isCurrent) {
                return true;
              }
              // A free public default plan stays visible as the "downgrade
              // target" for spaces with an active subscription — the
              // "Cancel subscription" button on that card is how a paid
              // customer drops back to free. Custom free plans never serve
              // this role, so suppress them.
              return hasSubscription && plan.visibility === "public";
            })
            .map((plan) => {
              const priceUsd = Number.parseFloat(plan.priceUsd);
              const isPaid = priceUsd > 0;
              const isCurrent = plan.id === currentPlanId;
              const currentPriceUsd = currentPlan
                ? Number.parseFloat(currentPlan.priceUsd)
                : 0;
              const isUpgrade = priceUsd > currentPriceUsd;
              // Paid tiers gross up Polar's processor fee — show face price +
              // the fee inline so the customer sees the real total upfront.
              const fee = isPaid
                ? paymentBreakdown(priceUsd, {
                    percent: platformSettings.paymentFeePercent,
                    flatUsd: platformSettings.paymentFeeFlatUsd,
                  })
                : null;
              // Unprovisioned paid plans (no Polar product yet) cannot be
              // checked out — display them disabled with a clear hint.
              const isUnprovisioned = isPaid && !plan.polarProductId;

              const rows: { label: string; value: string }[] = [
                {
                  label: "Included credit",
                  value: isPaid
                    ? `$${fmtUsd(plan.includedCreditUsd)}/mo`
                    : `$${fmtUsd(plan.includedCreditUsd)} (one-time)`,
                },
                {
                  label: "Concurrent Cubes",
                  value: fmtLimit(plan.maxConcurrentCubes),
                },
                {
                  label: "Max Cube size",
                  value: `${plan.maxVcpus} vCPU · ${formatRam(plan.maxRamMb)} · ${plan.maxDiskGb} GB`,
                },
                { label: "Team seats", value: fmtLimit(plan.maxSeats) },
                { label: "Backups", value: fmtLimit(plan.maxBackups) },
                {
                  label: "Custom domains",
                  value: fmtLimit(plan.maxDomains),
                },
              ];

              return (
                <Fragment key={plan.id}>
                  <div className="rounded-md border p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{plan.name}</span>
                        {isCurrent && (
                          <Badge variant="secondary">Current</Badge>
                        )}
                      </div>
                      <span className="text-right text-sm tabular-nums">
                        {fee ? (
                          <>
                            <span className="font-medium">${priceUsd}/mo</span>
                            <span className="block text-xs text-muted-foreground">
                              + ${fee.feeUsd.toFixed(2)} fee · $
                              {fee.totalUsd.toFixed(2)} total
                            </span>
                          </>
                        ) : (
                          <span className="font-medium">Free</span>
                        )}
                      </span>
                    </div>

                    {plan.description && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {plan.description}
                      </p>
                    )}

                    <dl className="mt-3 grid gap-1.5">
                      {rows.map((r) => (
                        <div
                          className="flex justify-between gap-4 text-sm"
                          key={r.label}
                        >
                          <dt className="text-muted-foreground">{r.label}</dt>
                          <dd className="font-medium">{r.value}</dd>
                        </div>
                      ))}
                    </dl>

                    <div className="mt-4">
                      {isCurrent && isPaid ? (
                        // Current paid plan — offer the cancel-to-free action.
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              className="w-full"
                              disabled={isPending}
                              type="button"
                              variant="outline"
                            >
                              Cancel subscription
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Cancel subscription?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Your space stays on its paid plan until the
                                current period ends, then drops to the free
                                plan. You can resubscribe at any time.
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
                              <AlertDialogCancel>Keep plan</AlertDialogCancel>
                              <AlertDialogAction
                                disabled={isPending}
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleCancel();
                                }}
                              >
                                Cancel subscription
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : isCurrent ? (
                        // Current free plan — the default with no action.
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
                            className="w-full"
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
                            {isPending && <Spinner className="size-4" />}
                            {isUpgrade ? "Upgrade" : "Downgrade"}
                          </Button>
                        ) : (
                          <Button
                            className="w-full"
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
                            {isPending && <Spinner className="size-4" />}
                            Subscribe
                          </Button>
                        )
                      ) : // A free plan card that is NOT current — surfaces only
                      // for spaces on a paid plan (cancel via the current
                      // plan card instead).
                      hasSubscription ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              className="w-full"
                              disabled={isPending}
                              type="button"
                              variant="outline"
                            >
                              Cancel subscription
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Cancel subscription?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Your space stays on its paid plan until the
                                current period ends, then drops to the free
                                plan. You can resubscribe at any time.
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
                              <AlertDialogCancel>Keep plan</AlertDialogCancel>
                              <AlertDialogAction
                                disabled={isPending}
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleCancel();
                                }}
                              >
                                Cancel subscription
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
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
                </Fragment>
              );
            })}
        </div>

        {/* Shared confirmation dialog for subscribe / upgrade / downgrade.
            Driven by `pendingAction`. Confirm dispatches the right handler;
            cancel closes without doing anything. Keeps the customer from
            accidentally upgrading + getting charged on a misclick. */}
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
      </SheetContent>
    </Sheet>
  );
}
