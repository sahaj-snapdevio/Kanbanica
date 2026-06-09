"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  updateLowBalanceThreshold,
  updateOverageSettings,
} from "@/app/actions/billing";
import { InstructionList } from "@/components/instruction-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Subset of `PlatformSettings` this sheet needs — threshold + overage cap bounds. */
interface PlatformSettingsForBillingSheet {
  lowBalanceThresholdMinUsd: number;
  overageCapMaxUsd: number;
  overageCapMinUsd: number;
}

export function BillingSettingsSheet({
  spaceId,
  currentThreshold,
  isFreePlan,
  overageEnabled,
  overageCapUsd,
  thisPeriodOverageUsd,
  subscriptionActive,
  open,
  onOpenChange,
  platformSettings,
}: {
  spaceId: string;
  currentThreshold: number;
  /** True when the space's current plan is free (`priceUsd <= 0`). Free
   *  plans cannot enable overage — same gating as the legacy `trial` check. */
  isFreePlan: boolean;
  overageEnabled: boolean;
  overageCapUsd: number;
  thisPeriodOverageUsd: number;
  subscriptionActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Operator-tunable bounds. Resolved server-side via
   *  `getPlatformSettings()` and threaded down so a mid-day operator change
   *  takes effect on the next page load without a redeploy. */
  platformSettings: PlatformSettingsForBillingSheet;
}) {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();

  const overageDisabled = isFreePlan || !subscriptionActive;
  const overageDisabledReason = isFreePlan
    ? "Free plans cannot enable overage. Subscribe to a paid plan to use postpaid billing."
    : subscriptionActive
      ? null
      : "Overage can only be enabled while your subscription is active.";

  // If overage cannot be enabled (Trial / inactive), seed the cap with a sane
  // default so the Zod min/max gate doesn't make the form forever-invalid.
  const initialCap =
    overageCapUsd > 0
      ? overageCapUsd
      : Math.max(platformSettings.overageCapMinUsd, 20);

  // Build the Zod schema from the prop values so an operator config change
  // takes effect on the next render rather than being frozen at module load.
  const schema = useMemo(
    () =>
      z.object({
        threshold: z
          .number({ message: "Enter an amount" })
          .min(
            platformSettings.lowBalanceThresholdMinUsd,
            `Must be at least $${platformSettings.lowBalanceThresholdMinUsd}`
          ),
        overageEnabled: z.boolean(),
        overageCapUsd: z
          .number({ message: "Enter an amount" })
          .min(
            platformSettings.overageCapMinUsd,
            `Must be at least $${platformSettings.overageCapMinUsd}`
          )
          .max(
            platformSettings.overageCapMaxUsd,
            `Must be at most $${platformSettings.overageCapMaxUsd}`
          ),
      }),
    [
      platformSettings.lowBalanceThresholdMinUsd,
      platformSettings.overageCapMinUsd,
      platformSettings.overageCapMaxUsd,
    ]
  );

  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      threshold: currentThreshold,
      overageEnabled,
      overageCapUsd: initialCap,
    },
    mode: "onChange",
  });

  const overageOn = useWatch({ control: form.control, name: "overageEnabled" });

  async function onSubmit(values: FormValues) {
    setIsPending(true);
    try {
      const thresholdChanged = values.threshold !== currentThreshold;
      const overageChanged =
        values.overageEnabled !== overageEnabled ||
        values.overageCapUsd !== overageCapUsd;

      // Track which of the two saves landed so a partial failure is
      // surfaced to the customer accurately (the alternative — a generic
      // "something failed" — would leave them unsure whether the threshold
      // change persisted).
      let thresholdSaved = false;
      if (thresholdChanged) {
        const result = await updateLowBalanceThreshold(
          spaceId,
          values.threshold
        );
        if ("error" in result) {
          form.setError("root", { message: result.error });
          return;
        }
        thresholdSaved = true;
      }
      if (overageChanged) {
        const result = await updateOverageSettings(spaceId, {
          enabled: values.overageEnabled,
          capUsd: values.overageCapUsd,
        });
        if ("error" in result) {
          form.setError("root", {
            message: thresholdSaved
              ? `Low-balance threshold saved. Overage update failed: ${result.error}`
              : result.error,
          });
          // The threshold WAS persisted server-side; refresh so the next
          // open of the sheet sees the new value as the baseline.
          if (thresholdSaved) {
            router.refresh();
          }
          return;
        }
      }
      toast.success("Billing settings updated");
      onOpenChange(false);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset({
        threshold: currentThreshold,
        overageEnabled,
        overageCapUsd: initialCap,
      });
    }
    onOpenChange(next);
  }

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Billing settings</SheetTitle>
          <SheetDescription>
            Configure low-balance notifications and postpaid overage for this
            space.
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            className="space-y-6 px-4 pb-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FormField
              control={form.control}
              name="threshold"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Low-balance threshold (USD)</FormLabel>
                  <FormControl>
                    <Input
                      disabled={isPending}
                      min={platformSettings.lowBalanceThresholdMinUsd}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      step={1}
                      type="number"
                      value={
                        Number.isFinite(field.value)
                          ? field.value
                          : currentThreshold
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    You&apos;ll get a low-balance email when your space&apos;s
                    credit reaches this amount.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-4 border-t pt-6">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Postpaid overage</h3>
                <InstructionList
                  items={[
                    "Cubes keep running after your prepaid credit runs out",
                    "The extra usage appears on next month's invoice",
                    "We never bill more than your monthly cap",
                  ]}
                />
              </div>

              <FormField
                control={form.control}
                name="overageEnabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-md border px-3 py-2">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm">
                        Enable postpaid overage
                      </FormLabel>
                      {overageDisabledReason && (
                        <p className="text-xs text-muted-foreground">
                          {overageDisabledReason}
                        </p>
                      )}
                    </div>
                    <FormControl>
                      {overageDisabled ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {/* Wrapping span so a disabled Switch still
                                  fires the tooltip on hover. */}
                              <span className="inline-flex">
                                <Switch
                                  checked={field.value}
                                  disabled
                                  onCheckedChange={field.onChange}
                                />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {overageDisabledReason}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <Switch
                          checked={field.value}
                          disabled={isPending}
                          onCheckedChange={field.onChange}
                        />
                      )}
                    </FormControl>
                  </FormItem>
                )}
              />

              {overageOn && !overageDisabled && (
                <>
                  <FormField
                    control={form.control}
                    name="overageCapUsd"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Monthly cap (USD)</FormLabel>
                        <FormControl>
                          <Input
                            disabled={isPending}
                            max={platformSettings.overageCapMaxUsd}
                            min={platformSettings.overageCapMinUsd}
                            onChange={(e) =>
                              field.onChange(Number(e.target.value))
                            }
                            step={1}
                            type="number"
                            value={
                              Number.isFinite(field.value)
                                ? field.value
                                : initialCap
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          Between ${platformSettings.overageCapMinUsd} and $
                          {platformSettings.overageCapMaxUsd}. We&apos;ll never
                          bill above this in a single billing period.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <p className="text-xs text-muted-foreground">
                    This period:{" "}
                    <span className="font-mono">
                      ${thisPeriodOverageUsd.toFixed(2)} of $
                      {overageCapUsd.toFixed(2)} used
                    </span>
                  </p>
                </>
              )}
            </div>

            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button
                disabled={isPending}
                onClick={() => handleOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={
                  !form.formState.isValid ||
                  !form.formState.isDirty ||
                  isPending
                }
                type="submit"
              >
                {isPending && <Spinner className="size-4" />}
                Save settings
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
