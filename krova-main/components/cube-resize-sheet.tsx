"use client";

/**
 * Shared resize sheet used on both the customer cube detail header and the
 * orbit cube detail page. The two callers differ only in the API endpoint
 * passed via the `endpoint` prop.
 *
 * Live preview reuses the pure `validateResize` from
 * `lib/cube-resize/validate.ts` so the inline error/info messaging matches
 * what the server enforces on submit. When `server` is null (e.g. the
 * customer page chose not to expose the server row), capacity is treated
 * as effectively infinite for preview only — submit-time validation on
 * the server will still catch any real capacity miss and surface the
 * error inline.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowClockwiseIcon,
  InfoIcon,
  LightningIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useTransition } from "react";
import { type Resolver, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
import { CPU_OPTIONS, DISK_OPTIONS, RAM_OPTIONS } from "@/config/platform";
import { formatRam, type PlanCubeLimits } from "@/lib/cube-options";
import { validateResize } from "@/lib/cube-resize/validate";
import { serverCpuRamCapacity } from "@/lib/server/cpu-ram-capacity";

interface FormValues {
  diskLimitGb: number;
  ramMb: number;
  vcpus: number;
}

export interface CubeResizeCube {
  diskLimitGb: number;
  hasVirtioMem: boolean;
  id: string;
  name: string;
  ramMb: number;
  status: string;
  vcpus: number;
}

export interface CubeResizeServer {
  allocatedCpus: number;
  allocatedDiskGb: number;
  allocatedRamMb: number;
  /** Postgres numeric returned by Drizzle as a string. */
  maxCpuOvercommit: string;
  /** Postgres numeric returned by Drizzle as a string. */
  maxRamOvercommit: string;
  /** Measured non-cube disk overhead (GB); effective disk capacity = totalDiskGb − this. */
  overheadDiskGb: number;
  totalCpus: number;
  totalDiskGb: number;
  totalRamMb: number;
}

export function CubeResizeSheet({
  cube,
  server,
  planLimits,
  endpoint,
  open,
  onOpenChange,
}: {
  cube: CubeResizeCube;
  /** When null, capacity preview is skipped and only enforced server-side. */
  server: CubeResizeServer | null;
  /** Space's plan ceilings (plan defaults merged with per-space overrides).
   *  When set, the input `max` attributes and the Zod schema upper bounds
   *  are clamped to `min(global config max, plan ceiling)` so the picker
   *  mirrors what `assertCubeWithinSizeV2` will accept. Omit on the admin
   *  (Orbit) side — admins resize past plan caps by design. */
  planLimits?: PlanCubeLimits;
  /** PATCH endpoint — customer or admin. */
  endpoint: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();

  // Per-render effective ranges: bounded above by the plan ceiling when one
  // is supplied, else by the global config range. The Zod schema and the
  // input `max` attributes both consume these so the UI cannot propose a
  // value the server's `assertCubeWithinSizeV2` would reject.
  const effectiveMaxVcpus = planLimits
    ? Math.min(CPU_OPTIONS.max, planLimits.maxVcpus)
    : CPU_OPTIONS.max;
  const effectiveMaxRamMb = planLimits
    ? Math.min(RAM_OPTIONS.max, planLimits.maxRamMb)
    : RAM_OPTIONS.max;
  const effectiveMaxDiskGb = planLimits
    ? Math.min(DISK_OPTIONS.max, planLimits.maxDiskGb)
    : DISK_OPTIONS.max;

  // React Hook Form captures the `resolver` option once at mount (its
  // internal `_options` ref is initialized but never reassigned), so a
  // freshly-built `zodResolver(...)` passed on a later render is ignored.
  // We keep a stable resolver identity and reach the LATEST effective
  // maxes through a ref updated in an effect — that way a plan change
  // while this sheet is mounted is validated against the new ceiling
  // rather than the one captured at mount. The one-render staleness
  // window is harmless: the resolver fires on the next change event,
  // which is strictly after the effect runs.
  const limitsRef = useRef({
    vcpus: effectiveMaxVcpus,
    ramMb: effectiveMaxRamMb,
    diskGb: effectiveMaxDiskGb,
  });
  useEffect(() => {
    limitsRef.current = {
      vcpus: effectiveMaxVcpus,
      ramMb: effectiveMaxRamMb,
      diskGb: effectiveMaxDiskGb,
    };
  }, [effectiveMaxVcpus, effectiveMaxRamMb, effectiveMaxDiskGb]);

  const resolver = useMemo<Resolver<FormValues>>(
    () => (values, ctx, opts) => {
      const schema = z.object({
        vcpus: z
          .number()
          .int()
          .min(CPU_OPTIONS.min)
          .max(limitsRef.current.vcpus),
        ramMb: z
          .number()
          .int()
          .min(RAM_OPTIONS.min)
          .max(limitsRef.current.ramMb),
        diskLimitGb: z
          .number()
          .int()
          .min(DISK_OPTIONS.min)
          .max(limitsRef.current.diskGb),
      });
      return zodResolver(schema)(values, ctx, opts);
    },
    []
  );

  const form = useForm<FormValues>({
    resolver,
    defaultValues: {
      vcpus: cube.vcpus,
      ramMb: cube.ramMb,
      diskLimitGb: cube.diskLimitGb,
    },
    mode: "onChange",
  });

  // Rule 26: useWatch (form.watch breaks the React Compiler).
  const watched = useWatch({ control: form.control });

  // For preview: if server is null, use a sentinel that has effectively
  // infinite capacity so range / shrink / no-op / virtio-mem checks still
  // run. Real capacity is enforced server-side at submit.
  const previewServer: CubeResizeServer = server ?? {
    totalCpus: Number.MAX_SAFE_INTEGER,
    totalRamMb: Number.MAX_SAFE_INTEGER,
    totalDiskGb: Number.MAX_SAFE_INTEGER,
    overheadDiskGb: 0,
    allocatedCpus: 0,
    allocatedRamMb: 0,
    allocatedDiskGb: 0,
    maxCpuOvercommit: "1",
    maxRamOvercommit: "1",
  };

  const validation =
    watched.vcpus !== undefined &&
    watched.ramMb !== undefined &&
    watched.diskLimitGb !== undefined
      ? validateResize({
          cube: {
            vcpus: cube.vcpus,
            ramMb: cube.ramMb,
            diskLimitGb: cube.diskLimitGb,
            hasVirtioMem: cube.hasVirtioMem,
          },
          server: previewServer,
          req: {
            vcpus: watched.vcpus,
            ramMb: watched.ramMb,
            diskLimitGb: watched.diskLimitGb,
          },
        })
      : { ok: false as const, error: "" };

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        form.setError("root", {
          message:
            typeof body?.error === "string"
              ? body.error
              : "Resize failed to start",
        });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { isLive?: boolean };
      const isLive = data.isLive ?? (validation.ok && validation.isLive);
      toast.success(
        isLive
          ? "Resize started — no downtime"
          : "Resize started — brief restart needed"
      );
      // Reset to the new values so re-opening the sheet starts from the
      // requested configuration (the page itself will refresh shortly).
      form.reset(values);
      onOpenChange(false);
    });
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset({
        vcpus: cube.vcpus,
        ramMb: cube.ramMb,
        diskLimitGb: cube.diskLimitGb,
      });
    }
    onOpenChange(next);
  }

  // Capacity preview is only useful when we have the real server row.
  const showCapacity = server !== null && validation.ok;
  const capacityAfter = showCapacity
    ? {
        cpu: server.allocatedCpus + validation.delta.cpu,
        ramMb: server.allocatedRamMb + validation.delta.ram,
        diskGb: server.allocatedDiskGb + validation.delta.disk,
      }
    : null;

  // Eligibility short-circuits.
  const eligible =
    cube.hasVirtioMem &&
    (cube.status === "running" || cube.status === "sleeping");

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Resize cube</SheetTitle>
          <SheetDescription>
            Increase vCPU, RAM, or disk. Shrinking is not supported.
            {!cube.hasVirtioMem &&
              " Live resize is unavailable on this cube — contact support."}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form className="space-y-4 px-4 pb-4" onSubmit={onSubmit}>
            <div className="rounded-md border p-3 text-sm">
              <div className="text-muted-foreground">Current</div>
              <div className="font-medium">{cube.name}</div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {cube.vcpus} vCPU · {formatRam(cube.ramMb)} RAM ·{" "}
                {cube.diskLimitGb} GB disk
              </div>
            </div>

            {planLimits && (
              <p className="text-xs text-muted-foreground">
                Your {planLimits.planName} plan allows up to {effectiveMaxVcpus}{" "}
                vCPU · {formatRam(effectiveMaxRamMb)} RAM · {effectiveMaxDiskGb}{" "}
                GB disk per Cube. Upgrade your plan for larger Cubes.
              </p>
            )}

            <FormField
              control={form.control}
              name="vcpus"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>vCPUs</FormLabel>
                  <FormControl>
                    <Input
                      disabled={isPending || !eligible}
                      max={effectiveMaxVcpus}
                      min={cube.vcpus}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      step={CPU_OPTIONS.step}
                      type="number"
                      value={
                        Number.isFinite(field.value) ? field.value : cube.vcpus
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="ramMb"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>RAM (MB)</FormLabel>
                  <FormControl>
                    <Input
                      disabled={isPending || !eligible}
                      max={effectiveMaxRamMb}
                      min={cube.ramMb}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      step={RAM_OPTIONS.step}
                      type="number"
                      value={
                        Number.isFinite(field.value) ? field.value : cube.ramMb
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="diskLimitGb"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Disk (GB)</FormLabel>
                  <FormControl>
                    <Input
                      disabled={isPending || !eligible}
                      max={effectiveMaxDiskGb}
                      min={cube.diskLimitGb}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      step={DISK_OPTIONS.step}
                      type="number"
                      value={
                        Number.isFinite(field.value)
                          ? field.value
                          : cube.diskLimitGb
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {capacityAfter && server && (
              <div className="rounded-md border p-3 text-xs text-muted-foreground tabular-nums">
                <div className="mb-1 font-medium text-foreground">
                  Server capacity after resize
                </div>
                <div>
                  CPU: {capacityAfter.cpu} /{" "}
                  {Math.floor(serverCpuRamCapacity(server).maxCpu)} vCPU
                </div>
                <div>
                  RAM: {Math.round(capacityAfter.ramMb / 1024)} /{" "}
                  {Math.floor(serverCpuRamCapacity(server).maxRam / 1024)} GB
                </div>
                <div>
                  Disk: {capacityAfter.diskGb} / {server.totalDiskGb} GB
                </div>
              </div>
            )}

            {validation.ok && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs">
                <div className="flex items-center gap-2 text-foreground">
                  {validation.isLive ? (
                    <>
                      <LightningIcon
                        className="size-4 text-emerald-600 dark:text-emerald-400"
                        weight="fill"
                      />
                      <span className="font-medium">
                        Live resize — no downtime
                      </span>
                    </>
                  ) : (
                    <>
                      <ArrowClockwiseIcon className="size-4 text-amber-600 dark:text-amber-400" />
                      <span className="font-medium">
                        Brief restart required (≈30 seconds)
                      </span>
                    </>
                  )}
                </div>
                <ul className="ml-6 list-disc space-y-1 text-muted-foreground">
                  {validation.isLive ? (
                    <li>
                      RAM is hot-plugged via virtio-mem and disk grown in place
                      — the Cube keeps serving requests.
                    </li>
                  ) : (
                    <li>
                      vCPU count changes require a clean reboot. The Cube will
                      be paused, reconfigured, and started again. Existing
                      connections are dropped.
                    </li>
                  )}
                  <li>
                    Hourly billing updates immediately. The current hour is
                    prorated — you&apos;ll see two billing rows for this hour
                    (old rate × minutes elapsed, new rate × minutes remaining).
                  </li>
                  <li>
                    Resize is one-way — you cannot shrink vCPU, RAM, or disk. To
                    go smaller, delete this Cube and create a new one from a
                    snapshot or backup.
                  </li>
                </ul>
              </div>
            )}

            {!validation.ok && validation.error && (
              <Alert variant="destructive">
                <AlertDescription>{validation.error}</AlertDescription>
              </Alert>
            )}

            {!eligible && cube.hasVirtioMem && (
              <Alert>
                <InfoIcon className="size-4" />
                <AlertDescription>
                  The Cube must be running or sleeping to start a resize.
                </AlertDescription>
              </Alert>
            )}

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
                  !validation.ok ||
                  isPending ||
                  !eligible
                }
                type="submit"
              >
                {isPending && <Spinner className="size-4" />}
                Apply resize
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
