"use client";

/**
 * Disk QoS tier editor (Orbit → Platform settings). Operator-editable per-cube
 * disk caps — bandwidth (MB/s), IOPS, and burst multiplier — per vCPU tier.
 * Saved to `platform_settings.disk_qos_tiers`; applies on each cube's NEXT cold
 * boot (per-cube `rate_limiter` + host `io.max`).
 *
 * DEFAULT IS UNLIMITED: leave a field BLANK = no cap on that axis (the customer
 * uses the full disk). Set a number to cap it. The vCPU bands/labels are
 * read-only (they mirror the billing tiers). "Reset to defaults" restores the
 * unlimited platform defaults.
 *
 * react-hook-form + zodResolver; inline `<FormMessage />`; AlertDialog confirm on
 * BOTH save and reset (each changes customer limits). Submit disabled until valid + dirty.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { updateDiskQosTiers } from "@/app/actions/orbit-platform-settings";
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
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { DISK_QOS_CAP_BOUNDS } from "@/config/platform";

export type DiskQosTier = {
  label: string;
  minVcpus: number;
  maxVcpus: number | null;
  /** null = UNLIMITED on that axis. */
  bandwidthMbps: number | null;
  iops: number | null;
  burstMultiplier: number;
  recommendedBandwidthMbps: number;
  recommendedIops: number;
};

// A cap is either UNLIMITED (null) or a number within bounds. Blank input → null.
const capBandwidth = z
  .number()
  .min(DISK_QOS_CAP_BOUNDS.bandwidthMbps.min)
  .max(DISK_QOS_CAP_BOUNDS.bandwidthMbps.max)
  .nullable();
const capIops = z
  .number()
  .int()
  .min(DISK_QOS_CAP_BOUNDS.iops.min)
  .max(DISK_QOS_CAP_BOUNDS.iops.max)
  .nullable();

const tierSchema = z.object({
  label: z.string(),
  minVcpus: z.number(),
  maxVcpus: z.number().nullable(),
  bandwidthMbps: capBandwidth,
  iops: capIops,
  burstMultiplier: z
    .number()
    .min(DISK_QOS_CAP_BOUNDS.burstMultiplier.min)
    .max(DISK_QOS_CAP_BOUNDS.burstMultiplier.max),
  recommendedBandwidthMbps: z.number(),
  recommendedIops: z.number(),
});

const formSchema = z.object({ tiers: z.array(tierSchema) });
type FormValues = z.infer<typeof formSchema>;

function band(t: DiskQosTier): string {
  return t.maxVcpus === null
    ? `${t.minVcpus}+ vCPU`
    : `${t.minVcpus}–${t.maxVcpus} vCPU`;
}

/** Empty input → null (unlimited); a number → the cap. Never NaN. */
function toCap(raw: number): number | null {
  return Number.isNaN(raw) ? null : raw;
}

export function DiskQosTiersForm({
  initial,
  defaults,
}: {
  /** The current EFFECTIVE caps (config defaults + any DB override). */
  initial: DiskQosTier[];
  /** The config defaults (unlimited) — what "Reset to defaults" restores. */
  defaults: DiskQosTier[];
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  // null = dialog closed; "save"/"reset" = which confirmed action is pending.
  const [pendingAction, setPendingAction] = useState<"save" | "reset" | null>(
    null
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { tiers: initial },
    mode: "onChange",
  });

  async function save(values: FormValues, reset: boolean) {
    setIsPending(true);
    form.clearErrors("root");
    const result = await updateDiskQosTiers(
      reset ? { reset: true } : { tiers: values.tiers }
    );
    setIsPending(false);
    setPendingAction(null);
    if ("error" in result) {
      form.setError("root", { message: result.error });
      return;
    }
    toast.success(
      reset ? "Disk QoS caps reset to defaults" : "Disk QoS caps saved"
    );
    form.reset(reset ? { tiers: defaults } : values);
    router.refresh();
  }

  const rootError = form.formState.errors.root?.message;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Disk QoS — per-cube disk limits</CardTitle>
        <CardDescription>
          The maximum disk throughput each cube may use, by vCPU tier. Caps a
          cube's <strong>bandwidth</strong> (MB/s — sequential reads/writes) and{" "}
          <strong>IOPS</strong> (random ops) so one cube can't starve its
          co-tenants on the shared disk; the <strong>burst</strong> multiplier
          lets short spikes through before the sustained cap bites.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Alert>
          <AlertDescription>
            <ul className="ml-4 list-disc space-y-1 text-sm">
              <li>
                <strong>Leave a field blank = Unlimited</strong> (no cap on that
                axis — the customer uses the full disk). This is the default;
                nothing is throttled until you set a number.
              </li>
              <li>
                <strong>Suggested</strong> values (shown under each field) are a
                fair single-cube share of a ~480 MB/s SATA-SSD array shared by
                ~30 cubes. Tune to your hardware — they are hints, not enforced.
              </li>
              <li>
                Allowed ranges — bandwidth{" "}
                {DISK_QOS_CAP_BOUNDS.bandwidthMbps.min}–
                {DISK_QOS_CAP_BOUNDS.bandwidthMbps.max.toLocaleString()} MB/s,
                IOPS {DISK_QOS_CAP_BOUNDS.iops.min}–
                {DISK_QOS_CAP_BOUNDS.iops.max.toLocaleString()}, burst{" "}
                {DISK_QOS_CAP_BOUNDS.burstMultiplier.min}–
                {DISK_QOS_CAP_BOUNDS.burstMultiplier.max}×.
              </li>
              <li>
                Caps apply <strong>per tier across every server</strong>. Each
                host enforces them against its own disk, so a slower or faster
                server is handled automatically; set the value as a fair share
                of your <em>slowest</em> relevant server.
              </li>
              <li>
                Takes effect on a cube's <strong>next cold boot</strong> —
                running cubes keep their current limits until they relaunch.
                Requires <code>DISK_QOS_ENABLED</code> /{" "}
                <code>IO_CGROUP_ENABLED</code> on to enforce.
              </li>
            </ul>
          </AlertDescription>
        </Alert>

        <Form {...form}>
          <form
            className="space-y-6"
            onSubmit={form.handleSubmit(() => setPendingAction("save"))}
          >
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-start gap-x-4 gap-y-4">
              <div className="text-muted-foreground text-xs font-medium">
                Tier
              </div>
              <div className="text-muted-foreground text-xs font-medium">
                Bandwidth (MB/s)
              </div>
              <div className="text-muted-foreground text-xs font-medium">
                IOPS
              </div>
              <div className="text-muted-foreground text-xs font-medium">
                Burst ×
              </div>
              {initial.map((t, i) => (
                <Fragment key={t.label}>
                  <div className="pt-2 text-sm">
                    <span className="font-medium">{t.label}</span>
                    <span className="text-muted-foreground ml-2">
                      {band(t)}
                    </span>
                  </div>
                  <FormField
                    control={form.control}
                    name={`tiers.${i}.bandwidthMbps`}
                    render={({ field }) => (
                      <FormItem className="w-28">
                        <FormControl>
                          <Input
                            min={1}
                            onChange={(e) =>
                              field.onChange(toCap(e.target.valueAsNumber))
                            }
                            placeholder="Unlimited"
                            type="number"
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <p className="text-muted-foreground text-xs">
                          Suggested: {t.recommendedBandwidthMbps}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`tiers.${i}.iops`}
                    render={({ field }) => (
                      <FormItem className="w-28">
                        <FormControl>
                          <Input
                            min={1}
                            onChange={(e) =>
                              field.onChange(toCap(e.target.valueAsNumber))
                            }
                            placeholder="Unlimited"
                            type="number"
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <p className="text-muted-foreground text-xs">
                          Suggested: {t.recommendedIops.toLocaleString()}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`tiers.${i}.burstMultiplier`}
                    render={({ field }) => (
                      <FormItem className="w-20">
                        <FormControl>
                          <Input
                            min={1}
                            onChange={(e) =>
                              field.onChange(e.target.valueAsNumber)
                            }
                            step="0.5"
                            type="number"
                            value={field.value}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </Fragment>
              ))}
            </div>

            {rootError ? (
              <Alert variant="destructive">
                <AlertDescription>{rootError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex items-center gap-3">
              <Button
                disabled={
                  !form.formState.isValid ||
                  !form.formState.isDirty ||
                  isPending
                }
                type="submit"
              >
                {isPending ? <Spinner className="mr-2" /> : null}
                Save caps
              </Button>
              <Button
                disabled={isPending}
                onClick={() => setPendingAction("reset")}
                type="button"
                variant="outline"
              >
                Reset to unlimited
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingAction(null);
          }
        }}
        open={pendingAction !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === "reset"
                ? "Reset disk QoS to unlimited?"
                : "Update disk QoS caps?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction === "reset"
                ? "This removes all caps — every customer cube goes back to unlimited disk throughput. "
                : "This changes the maximum disk throughput for every customer cube on the affected tiers. "}
              It takes effect on each cube's next cold boot — running cubes keep
              their current limits until they relaunch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                save(form.getValues(), pendingAction === "reset");
              }}
            >
              {isPending ? <Spinner className="mr-2" /> : null}
              {pendingAction === "reset" ? "Reset" : "Save"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
