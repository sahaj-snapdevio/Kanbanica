"use client";

/**
 * Platform-settings form. Single-page form covering every operator-tweakable
 * global from the `platform_settings` singleton row. Sections separate the
 * concerns so the operator can scan: service fee, credit top-up
 * bounds, overage cap bounds, plan-credit cooldown, low-balance threshold.
 *
 * react-hook-form + zodResolver; inline `<FormMessage />`; server errors via
 * `form.setError("root", ...)`. Submit disabled until the form is valid AND
 * dirty (a no-op save is meaningless and would emit an empty audit entry).
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { updatePlatformSettings } from "@/app/actions/orbit-platform-settings";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Spinner } from "@/components/ui/spinner";

// Same shape + bounds as the server-action schema (the server is the
// authoritative gate; the client schema is for live inline feedback).
const formSchema = z
  .object({
    paymentFeePercent: z.number().min(0).max(0.1),
    paymentFeeFlatUsd: z.number().min(0).max(5),
    creditTopupMinUsd: z.number().min(1).max(100),
    creditTopupMaxUsd: z.number().min(100).max(10_000),
    creditTopupDefaultUsd: z.number().min(1).max(10_000),
    overageCapMinUsd: z.number().min(1).max(100),
    overageCapMaxUsd: z.number().min(100).max(10_000),
    overageDefaultCapMultiplier: z.number().min(1).max(10),
    planCreditGrantCooldownDays: z.number().int().min(0).max(365),
    lowBalanceThresholdDefaultUsd: z.number().min(1).max(100),
    lowBalanceThresholdMinUsd: z.number().min(1).max(100),
    polarCreditProductId: z.string().max(128).nullable(),
    polarOverageMeterId: z.string().max(128).nullable(),
    backupStorageRatePerGbPerMonth: z.number().min(0).max(10),
  })
  .superRefine((val, ctx) => {
    if (val.creditTopupDefaultUsd < val.creditTopupMinUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditTopupDefaultUsd"],
        message: "Default must be at least the minimum top-up",
      });
    }
    if (val.creditTopupDefaultUsd > val.creditTopupMaxUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditTopupDefaultUsd"],
        message: "Default must be at most the maximum top-up",
      });
    }
    if (val.creditTopupMaxUsd <= val.creditTopupMinUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creditTopupMaxUsd"],
        message: "Maximum must be greater than the minimum",
      });
    }
    if (val.overageCapMaxUsd <= val.overageCapMinUsd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overageCapMaxUsd"],
        message: "Maximum must be greater than the minimum",
      });
    }
  });

type FormValues = z.infer<typeof formSchema>;

export interface PlatformSettingsInitial extends FormValues {
  updatedAt: Date;
}

// Human-readable label per field for the diff dialog.
const FIELD_LABELS: Record<keyof FormValues, string> = {
  paymentFeePercent: "Service fee percent",
  paymentFeeFlatUsd: "Service fee flat (USD)",
  creditTopupMinUsd: "Top-up minimum (USD)",
  creditTopupMaxUsd: "Top-up maximum (USD)",
  creditTopupDefaultUsd: "Top-up default (USD)",
  overageCapMinUsd: "Overage cap minimum (USD)",
  overageCapMaxUsd: "Overage cap maximum (USD)",
  overageDefaultCapMultiplier: "Overage default cap multiplier",
  planCreditGrantCooldownDays: "Plan credit cooldown (days)",
  lowBalanceThresholdDefaultUsd: "Low-balance default (USD)",
  lowBalanceThresholdMinUsd: "Low-balance minimum (USD)",
  polarCreditProductId: "Polar credit product id",
  polarOverageMeterId: "Polar overage meter id",
  backupStorageRatePerGbPerMonth: "Backup storage rate (USD/GB/month)",
};

// Fields whose change has direct billing / customer-experience consequences.
// A diff that touches any of these gets a louder confirmation copy.
const RISKY_FIELDS = new Set<keyof FormValues>([
  "paymentFeePercent",
  "paymentFeeFlatUsd",
  "creditTopupMinUsd",
  "creditTopupMaxUsd",
  "overageCapMinUsd",
  "overageCapMaxUsd",
  "overageDefaultCapMultiplier",
  "planCreditGrantCooldownDays",
  "polarCreditProductId",
  "polarOverageMeterId",
  "backupStorageRatePerGbPerMonth",
]);

function formatValue(v: number | string | null) {
  if (v === null) {
    return "(unset)";
  }
  if (typeof v === "string") {
    return v;
  }
  return Number.isInteger(v) ? String(v) : v.toString();
}

export function PlatformSettingsForm({
  initial,
}: {
  initial: PlatformSettingsInitial;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [pendingValues, setPendingValues] = useState<FormValues | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      paymentFeePercent: initial.paymentFeePercent,
      paymentFeeFlatUsd: initial.paymentFeeFlatUsd,
      creditTopupMinUsd: initial.creditTopupMinUsd,
      creditTopupMaxUsd: initial.creditTopupMaxUsd,
      creditTopupDefaultUsd: initial.creditTopupDefaultUsd,
      overageCapMinUsd: initial.overageCapMinUsd,
      overageCapMaxUsd: initial.overageCapMaxUsd,
      overageDefaultCapMultiplier: initial.overageDefaultCapMultiplier,
      planCreditGrantCooldownDays: initial.planCreditGrantCooldownDays,
      lowBalanceThresholdDefaultUsd: initial.lowBalanceThresholdDefaultUsd,
      lowBalanceThresholdMinUsd: initial.lowBalanceThresholdMinUsd,
      polarCreditProductId: initial.polarCreditProductId,
      polarOverageMeterId: initial.polarOverageMeterId,
      backupStorageRatePerGbPerMonth: initial.backupStorageRatePerGbPerMonth,
    },
    mode: "onChange",
  });

  // Form submit only opens the confirmation dialog. The actual write happens
  // in `handleConfirm` so the operator sees the exact field-by-field diff
  // before any platform-wide globals change.
  function onSubmit(values: FormValues) {
    setPendingValues(values);
  }

  function computeDiff(values: FormValues) {
    const changes: {
      key: keyof FormValues;
      from: number | string | null;
      to: number | string | null;
      risky: boolean;
    }[] = [];
    for (const key of Object.keys(FIELD_LABELS) as (keyof FormValues)[]) {
      const before = initial[key] as number | string | null;
      const after = values[key] as number | string | null;
      if (before !== after) {
        changes.push({
          key,
          from: before,
          to: after,
          risky: RISKY_FIELDS.has(key),
        });
      }
    }
    return changes;
  }

  async function handleConfirm() {
    if (!pendingValues) {
      return;
    }
    const values = pendingValues;
    setIsPending(true);
    try {
      const result = await updatePlatformSettings(values);
      if ("error" in result) {
        form.setError("root", { message: result.error });
        setPendingValues(null);
        return;
      }
      toast.success("Platform settings updated");
      // Reset the form's "dirty" state to the saved values so subsequent edits
      // diff against the new baseline (and the submit button re-disables).
      form.reset(values);
      setPendingValues(null);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  const pendingDiff = pendingValues ? computeDiff(pendingValues) : [];
  const hasRiskyChange = pendingDiff.some((c) => c.risky);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Platform settings</h1>
          <p className="text-sm text-muted-foreground">
            Operator-tunable globals. Server-side reads are cached for 60
            seconds; a save invalidates the cache.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Last updated {initial.updatedAt.toISOString()}
        </p>
      </div>

      <Form {...form}>
        <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
          {form.formState.errors.root && (
            <Alert variant="destructive">
              <AlertDescription>
                {form.formState.errors.root.message}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Service fee</CardTitle>
              <CardDescription>
                The gross-up applied to every credit top-up and recurring
                subscription charge — labelled &quot;service fee&quot; to
                customers. Set both knobs to match (or exceed) Polar&apos;s
                actual processor cost. Polar charges 4% + $0.40 on every
                payment, plus an extra 0.5% on subscriptions — so 4.5% + $0.40
                is the break-even floor for recurring billing. Total customer
                charge = <code>ceil((base + flat) / (1 - percent))</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="paymentFeePercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Percent (0–0.10)</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        max={0.1}
                        min={0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={0.001}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormDescription>
                      Decimal share, e.g. 0.04 for 4%.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="paymentFeeFlatUsd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Flat fee (USD)</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        max={5}
                        min={0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={0.01}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormDescription>
                      Per-transaction flat amount.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Credit top-up bounds</CardTitle>
              <CardDescription>
                Bounds the customer Add-Credits sheet enforces.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <FormField
                control={form.control}
                name="creditTopupMinUsd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum (USD)</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        max={100}
                        min={1}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={1}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="creditTopupMaxUsd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maximum (USD)</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        max={10_000}
                        min={100}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={10}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="creditTopupDefaultUsd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default (USD)</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        max={10_000}
                        min={1}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={1}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormDescription>Pre-filled in the sheet.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Overage cap bounds</CardTitle>
              <CardDescription>
                Bounds and the default cap multiplier for postpaid overage.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <FormField
                control={form.control}
                name="overageCapMinUsd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum cap (USD)</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        max={100}
                        min={1}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={1}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="overageCapMaxUsd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maximum cap (USD)</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        max={10_000}
                        min={100}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={10}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="overageDefaultCapMultiplier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default cap multiplier</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        max={10}
                        min={1}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={0.1}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormDescription>
                      Suggested cap = plan price &times; this.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Plan credit cooldown</CardTitle>
              <CardDescription>
                Anti-abuse window between subscription activations that grant
                included credit on the same space.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="planCreditGrantCooldownDays"
                render={({ field }) => (
                  <FormItem className="max-w-xs">
                    <FormLabel>Cooldown (days)</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        max={365}
                        min={0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={1}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormDescription>
                      Activation-only; renewals are not throttled.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Low-balance threshold defaults</CardTitle>
              <CardDescription>
                Default and minimum allowable per-space low-balance email
                threshold.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="lowBalanceThresholdDefaultUsd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default (USD)</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        max={100}
                        min={1}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={1}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormDescription>
                      Applied to new spaces at create-time.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lowBalanceThresholdMinUsd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum (USD)</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        max={100}
                        min={1}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={1}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormDescription>
                      Customers cannot set their threshold below this.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Polar integration</CardTitle>
              <CardDescription>
                Operator-set Polar resource ids. Create the resources in your
                Polar dashboard and paste the ids here. Leave blank to keep the
                corresponding feature inert (top-up checkout / overage meter
                reporting will throw a loud error instead of silently failing).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="polarCreditProductId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Credit top-up product id</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        onChange={(e) => field.onChange(e.target.value || null)}
                        placeholder="prod_xxxxxxxxxxxxxxxx"
                        type="text"
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      The Polar product id for the one-shot credit top-up.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="polarOverageMeterId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Overage meter id</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        onChange={(e) => field.onChange(e.target.value || null)}
                        placeholder="meter_xxxxxxxxxxxxxxxx"
                        type="text"
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      The Polar meter id for the <code>krova_overage_usd</code>{" "}
                      meter — used by both plan-product metered prices and the
                      overage event reporter.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="backupStorageRatePerGbPerMonth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Backup storage (USD / GB / month)</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isPending}
                        max={10}
                        min={0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step="0.001"
                        type="number"
                        value={field.value}
                      />
                    </FormControl>
                    <FormDescription>
                      Per-GB-month rate charged hourly on every backup a space
                      retains. Default $0.01 — billing-hourly converts to a
                      per-hour rate via /730.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-2">
            <Button
              disabled={
                !form.formState.isValid || !form.formState.isDirty || isPending
              }
              type="submit"
            >
              {isPending && <Spinner className="size-4" />}
              Save settings
            </Button>
          </div>
        </form>
      </Form>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !isPending) {
            setPendingValues(null);
          }
        }}
        open={!!pendingValues}
      >
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasRiskyChange
                ? "Confirm billing-sensitive settings change"
                : "Confirm settings change"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Review every change before applying. These globals affect{" "}
                  <strong>every space</strong>, take effect within 60 seconds
                  (cache TTL), and are audit-logged.
                </p>
                {hasRiskyChange && (
                  <p className="font-medium text-destructive">
                    One or more changes affect billing math, payment processing,
                    or the Polar integration.
                  </p>
                )}
                <div className="rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40 text-xs tracking-wide text-muted-foreground uppercase">
                      <tr>
                        <th className="p-2 text-left font-medium">Setting</th>
                        <th className="p-2 text-right font-medium">From</th>
                        <th className="p-2 text-right font-medium">To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingDiff.map((c) => (
                        <tr className="border-b last:border-0" key={c.key}>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              {FIELD_LABELS[c.key]}
                              {c.risky && (
                                <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-destructive uppercase">
                                  billing
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-2 text-right font-mono text-muted-foreground tabular-nums">
                            {formatValue(c.from)}
                          </td>
                          <td className="p-2 text-right font-mono tabular-nums">
                            {formatValue(c.to)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              className={
                hasRiskyChange
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
            >
              {isPending && <Spinner className="size-4" />}
              {hasRiskyChange ? "Apply changes" : "Save settings"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
