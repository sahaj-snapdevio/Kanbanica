"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { createCreditCheckout } from "@/app/actions/billing";
import { paymentBreakdown } from "@/components/billing/topup-math";
import { InstructionList } from "@/components/instruction-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
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

/** Subset of `PlatformSettings` this sheet needs — fee math + amount bounds. */
interface PlatformSettingsForTopup {
  creditTopupDefaultUsd: number;
  creditTopupMaxUsd: number;
  creditTopupMinUsd: number;
  paymentFeeFlatUsd: number;
  paymentFeePercent: number;
}

export function AddCreditsSheet({
  spaceId,
  open,
  onOpenChange,
  platformSettings,
}: {
  spaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Operator-tunable fee + bounds. Resolved server-side via
   *  `getPlatformSettings()` and threaded down so a mid-day operator change
   *  takes effect on the next page load without a redeploy. */
  platformSettings: PlatformSettingsForTopup;
}) {
  const [isPending, setIsPending] = useState(false);

  // Build the Zod schema from the prop values so a config change takes effect
  // on the next render rather than being frozen at module load.
  const schema = useMemo(
    () =>
      z.object({
        amount: z
          .number({ message: "Enter an amount" })
          .min(
            platformSettings.creditTopupMinUsd,
            `Minimum top-up is $${platformSettings.creditTopupMinUsd}`
          )
          .max(
            platformSettings.creditTopupMaxUsd,
            `Maximum top-up is $${platformSettings.creditTopupMaxUsd}`
          ),
      }),
    [platformSettings.creditTopupMinUsd, platformSettings.creditTopupMaxUsd]
  );

  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amount: platformSettings.creditTopupDefaultUsd },
    mode: "onChange",
  });

  // Rule 26: useWatch (form.watch breaks the React Compiler).
  const amount = useWatch({ control: form.control, name: "amount" });
  const breakdown = paymentBreakdown(typeof amount === "number" ? amount : 0, {
    percent: platformSettings.paymentFeePercent,
    flatUsd: platformSettings.paymentFeeFlatUsd,
  });

  async function onSubmit(values: FormValues) {
    setIsPending(true);
    const result = await createCreditCheckout(spaceId, values.amount);
    if ("error" in result) {
      form.setError("root", { message: result.error });
      setIsPending(false);
      return;
    }
    // Do not clear pending — page is navigating away.
    window.location.assign(result.data.checkoutUrl);
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset({ amount: platformSettings.creditTopupDefaultUsd });
    }
    onOpenChange(next);
  }

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add credits</SheetTitle>
          <SheetDescription asChild>
            <div className="space-y-3">
              <p>Top up your prepaid credit balance with a one-time payment.</p>
              <InstructionList
                items={[
                  "1 USD = 1 credit",
                  "Credits land in your balance immediately after payment",
                  "A small service fee covers payment processing",
                ]}
              />
            </div>
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            className="space-y-4 px-4 pb-4"
            onSubmit={form.handleSubmit(onSubmit)}
          >
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount (USD)</FormLabel>
                  <FormControl>
                    <Input
                      disabled={isPending}
                      max={platformSettings.creditTopupMaxUsd}
                      min={platformSettings.creditTopupMinUsd}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      step={1}
                      type="number"
                      value={
                        Number.isFinite(field.value)
                          ? field.value
                          : platformSettings.creditTopupDefaultUsd
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-md border p-3 text-sm tabular-nums">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Credit</span>
                <span>${breakdown.baseUsd.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Service fee</span>
                <span>${breakdown.feeUsd.toFixed(2)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t pt-2">
                <span className="font-medium">Total</span>
                <span className="font-medium">
                  ${breakdown.totalUsd.toFixed(2)}
                </span>
              </div>
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
                disabled={!form.formState.isValid || isPending}
                type="submit"
              >
                {isPending && <Spinner className="size-4" />}
                Continue to payment
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
