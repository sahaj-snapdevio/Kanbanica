"use client";

/**
 * Plan create / edit sheet. Reused by the Plans list page (create) and the
 * plan detail page (edit). Form pattern follows `cube-resize-sheet.tsx`:
 * react-hook-form + zodResolver, inline `<FormMessage />`, server errors via
 * `form.setError("root", ...)`.
 *
 * Slug is auto-suggested from name in create mode and locked in edit mode
 * (the slug is part of `plan_id` FK semantics per the design spec).
 *
 * "Unlimited" toggles for nullable fields (max_concurrent_cubes, max_seats,
 * max_backups, max_domains) flip the underlying value between `null` and a
 * positive integer.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  type CreatePlanInput,
  createPlan,
  updatePlan,
} from "@/app/actions/orbit-plans";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CPU_OPTIONS, DISK_OPTIONS, RAM_OPTIONS } from "@/config/platform";

const slugRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * The form's working shape uses `null` (not undefined) for unlimited so the
 * "Unlimited" checkbox bindings stay consistent with the server action's
 * Zod schema.
 */
const formSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(63)
    .regex(slugRegex, "Lowercase letters, digits and hyphens only"),
  description: z.string().trim().max(500),
  priceUsd: z.number().nonnegative("Must be 0 or greater").max(100_000),
  includedCreditUsd: z
    .number()
    .nonnegative("Must be 0 or greater")
    .max(100_000),
  maxConcurrentCubes: z.number().int().nonnegative().nullable(),
  maxVcpus: z.number().int().min(CPU_OPTIONS.min).max(CPU_OPTIONS.max),
  maxRamMb: z.number().int().min(RAM_OPTIONS.min).max(RAM_OPTIONS.max),
  maxDiskGb: z.number().int().min(DISK_OPTIONS.min).max(DISK_OPTIONS.max),
  maxSeats: z.number().int().nonnegative().nullable(),
  maxBackups: z.number().int().nonnegative().nullable(),
  maxDomains: z.number().int().nonnegative().nullable(),
  allowTopup: z.boolean(),
  allowOverage: z.boolean(),
  // Snapshots — null cadence = auto disabled (Trial). Minimum 2h guards
  // host I/O. Bucket counts feed `restic forget --keep-*`.
  autoSnapshotCadenceHours: z
    .number()
    .int()
    .min(2, "Minimum cadence is 2 hours")
    .max(168, "Max cadence is 168h (1 week)")
    .nullable(),
  autoSnapshotKeepLast: z.number().int().min(0).max(100),
  autoSnapshotKeepDaily: z.number().int().min(0).max(365),
  autoSnapshotKeepWeekly: z.number().int().min(0).max(104),
  maxManualSnapshotsPerCube: z.number().int().min(0).max(100),
  visibility: z.enum(["public", "custom"]),
  sortOrder: z.number().int().nonnegative().max(10_000),
});

type FormValues = z.infer<typeof formSchema>;

export interface PlanFormInitial {
  allowOverage: boolean;
  allowTopup: boolean;
  autoSnapshotCadenceHours: number | null;
  autoSnapshotKeepDaily: number;
  autoSnapshotKeepLast: number;
  autoSnapshotKeepWeekly: number;
  description: string | null;
  id: string;
  includedCreditUsd: string;
  maxBackups: number | null;
  maxConcurrentCubes: number | null;
  maxDiskGb: number;
  maxDomains: number | null;
  maxManualSnapshotsPerCube: number;
  maxRamMb: number;
  maxSeats: number | null;
  maxVcpus: number;
  name: string;
  priceUsd: string;
  slug: string;
  sortOrder: number;
  visibility: "public" | "custom";
}

/** Slugify a name into a candidate URL identifier. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 63);
}

function toFormValues(initial: PlanFormInitial | null): FormValues {
  if (!initial) {
    // Per-Cube size defaults to the PLATFORM MAX (16 vCPU / 32 GB / 100 GB
    // today). The schema requires non-null values here, so "no cap" means
    // "up to the platform's hardware ceiling" — the most-permissive sane
    // default. The operator can lower it for restrictive plans. Defaulting
    // to the min ships every fresh plan with a 1 vCPU / 1 GB / 10 GB cap,
    // which silently clamps the create-cube + resize sliders on any space
    // assigned to that plan.
    return {
      name: "",
      slug: "",
      description: "",
      priceUsd: 0,
      includedCreditUsd: 0,
      maxConcurrentCubes: 1,
      maxVcpus: CPU_OPTIONS.max,
      maxRamMb: RAM_OPTIONS.max,
      maxDiskGb: DISK_OPTIONS.max,
      maxSeats: 1,
      maxBackups: 0,
      maxDomains: 0,
      allowTopup: true,
      allowOverage: false,
      // Snapshots default to OFF for a fresh plan — the operator opts in.
      autoSnapshotCadenceHours: null,
      autoSnapshotKeepLast: 0,
      autoSnapshotKeepDaily: 0,
      autoSnapshotKeepWeekly: 0,
      maxManualSnapshotsPerCube: 0,
      visibility: "public",
      sortOrder: 0,
    };
  }
  return {
    name: initial.name,
    slug: initial.slug,
    description: initial.description ?? "",
    priceUsd: Number.parseFloat(initial.priceUsd),
    includedCreditUsd: Number.parseFloat(initial.includedCreditUsd),
    maxConcurrentCubes: initial.maxConcurrentCubes,
    maxVcpus: initial.maxVcpus,
    maxRamMb: initial.maxRamMb,
    maxDiskGb: initial.maxDiskGb,
    maxSeats: initial.maxSeats,
    maxBackups: initial.maxBackups,
    maxDomains: initial.maxDomains,
    allowTopup: initial.allowTopup,
    allowOverage: initial.allowOverage,
    autoSnapshotCadenceHours: initial.autoSnapshotCadenceHours,
    autoSnapshotKeepLast: initial.autoSnapshotKeepLast,
    autoSnapshotKeepDaily: initial.autoSnapshotKeepDaily,
    autoSnapshotKeepWeekly: initial.autoSnapshotKeepWeekly,
    maxManualSnapshotsPerCube: initial.maxManualSnapshotsPerCube,
    visibility: initial.visibility,
    sortOrder: initial.sortOrder,
  };
}

export function PlanFormSheet({
  open,
  onOpenChange,
  mode,
  initial,
  subscriberCount = 0,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  mode: "create" | "edit";
  initial: PlanFormInitial | null;
  /** Active subscribers on this plan (`spaces.providerSubscriptionId IS NOT
   *  NULL AND planId = ?`). Drives the price-change confirmation dialog
   *  copy — Polar grandfathers existing subs at the old price. Defaults
   *  to 0 for the create flow. */
  subscriberCount?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Pending price-change confirmation. Held until the operator confirms via
  // the dialog OR cancels (resetting to null). Stores the resolved form
  // values so the submit handler can dispatch without re-validating.
  const [pendingPriceChange, setPendingPriceChange] = useState<null | {
    oldPriceUsd: number;
    newPriceUsd: number;
    values: FormValues;
  }>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toFormValues(initial),
    mode: "onChange",
  });

  // Slug auto-suggest while creating, until the operator manually edits it.
  // Tracked locally so the live name → slug derivation stops the moment they
  // change the slug field by hand.
  const [autoSlug, setAutoSlug] = useState(mode === "create");

  const watchedName = useWatch({ control: form.control, name: "name" });
  const watchedVisibility = useWatch({
    control: form.control,
    name: "visibility",
  });

  useEffect(() => {
    if (mode === "create" && autoSlug && typeof watchedName === "string") {
      form.setValue("slug", slugify(watchedName), { shouldValidate: true });
    }
  }, [watchedName, autoSlug, mode, form]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      form.reset(toFormValues(initial));
      setAutoSlug(mode === "create");
    }
    onOpenChange(next);
  }

  function dispatchSubmit(values: FormValues) {
    startTransition(async () => {
      // Map the form's working shape onto the server action's input type.
      const payload: CreatePlanInput = {
        name: values.name,
        slug: values.slug,
        description:
          values.description.trim().length > 0 ? values.description : null,
        priceUsd: values.priceUsd,
        includedCreditUsd: values.includedCreditUsd,
        maxConcurrentCubes: values.maxConcurrentCubes,
        maxVcpus: values.maxVcpus,
        maxRamMb: values.maxRamMb,
        maxDiskGb: values.maxDiskGb,
        maxSeats: values.maxSeats,
        maxBackups: values.maxBackups,
        maxDomains: values.maxDomains,
        allowTopup: values.allowTopup,
        allowOverage: values.allowOverage,
        autoSnapshotCadenceHours: values.autoSnapshotCadenceHours,
        autoSnapshotKeepLast: values.autoSnapshotKeepLast,
        autoSnapshotKeepDaily: values.autoSnapshotKeepDaily,
        autoSnapshotKeepWeekly: values.autoSnapshotKeepWeekly,
        maxManualSnapshotsPerCube: values.maxManualSnapshotsPerCube,
        visibility: values.visibility,
        sortOrder: values.sortOrder,
      };

      const result =
        mode === "create"
          ? await createPlan(payload)
          : await updatePlan(initial!.id, payload);

      if ("error" in result) {
        form.setError("root", { message: result.error });
        return;
      }
      if ("warning" in result && result.warning) {
        // Polar price sync failed but the Krova-side write landed. The
        // operator can re-save to retry the Polar leg. Surfaced via toast so
        // the next save attempt sees a clean form (no sticky inline error).
        toast.warning(result.warning);
      } else {
        toast.success(mode === "create" ? "Plan created" : "Plan updated");
      }
      router.refresh();
      onOpenChange(false);
    });
  }

  const onSubmit = form.handleSubmit((values) => {
    // Intercept price changes on an existing plan with live subscribers —
    // Polar grandfathers existing subs at the old price, which is easy for
    // an operator to forget. The dialog makes the consequence loud and
    // requires an explicit confirm before the API call goes out.
    if (mode === "edit" && initial) {
      const oldPriceUsd = Number.parseFloat(initial.priceUsd);
      if (oldPriceUsd !== values.priceUsd && subscriberCount > 0) {
        setPendingPriceChange({
          oldPriceUsd,
          newPriceUsd: values.priceUsd,
          values,
        });
        return;
      }
    }
    dispatchSubmit(values);
  });

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {mode === "create" ? "New plan" : "Edit plan"}
          </SheetTitle>
          <SheetDescription>
            {mode === "create"
              ? "Create a plan and configure its limits. Paid plans must be provisioned in Polar separately before they accept subscribers."
              : "Update plan details. Price changes sync to Polar; existing subscribers are grandfathered."}
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form className="space-y-4 px-4 pb-6" onSubmit={onSubmit}>
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Starter" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slug"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Slug</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="starter"
                      {...field}
                      disabled={mode === "edit"}
                      onChange={(e) => {
                        if (mode === "create") {
                          setAutoSlug(false);
                        }
                        field.onChange(e);
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    {mode === "edit"
                      ? "Slug is locked after creation."
                      : "URL- and log-safe identifier. Auto-suggested from name."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Shown to customers in the plan-selection sheet."
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="priceUsd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Price (USD / month)</FormLabel>
                    <FormControl>
                      <Input
                        min={0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={0.01}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormDescription>0 for a free plan.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="includedCreditUsd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Included credit (USD)</FormLabel>
                    <FormControl>
                      <Input
                        min={0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={0.01}
                        type="number"
                        value={Number.isFinite(field.value) ? field.value : 0}
                      />
                    </FormControl>
                    <FormDescription>
                      Paid plans grant this credit at subscription activation
                      and on each renewal. Free plans grant it once when a space
                      first joins the plan (via admin assignment, or space
                      creation if this is the default plan).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <p className="text-xs font-medium text-muted-foreground">
              Per-Cube ceilings
            </p>
            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="maxVcpus"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>vCPUs</FormLabel>
                    <FormControl>
                      <Input
                        max={CPU_OPTIONS.max}
                        min={CPU_OPTIONS.min}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={CPU_OPTIONS.step}
                        type="number"
                        value={
                          Number.isFinite(field.value)
                            ? field.value
                            : CPU_OPTIONS.min
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxRamMb"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>RAM (MB)</FormLabel>
                    <FormControl>
                      <Input
                        max={RAM_OPTIONS.max}
                        min={RAM_OPTIONS.min}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={RAM_OPTIONS.step}
                        type="number"
                        value={
                          Number.isFinite(field.value)
                            ? field.value
                            : RAM_OPTIONS.min
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxDiskGb"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Disk (GB)</FormLabel>
                    <FormControl>
                      <Input
                        max={DISK_OPTIONS.max}
                        min={DISK_OPTIONS.min}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        step={DISK_OPTIONS.step}
                        type="number"
                        value={
                          Number.isFinite(field.value)
                            ? field.value
                            : DISK_OPTIONS.min
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            <p className="text-xs font-medium text-muted-foreground">
              Per-space caps (check &quot;Unlimited&quot; to leave uncapped)
            </p>
            <NullableIntField
              control={form.control}
              label="Max concurrent Cubes"
              name="maxConcurrentCubes"
            />
            <NullableIntField
              control={form.control}
              label="Max team seats"
              name="maxSeats"
            />
            <NullableIntField
              control={form.control}
              label="Max backups"
              name="maxBackups"
            />
            <NullableIntField
              control={form.control}
              label="Max custom domains"
              name="maxDomains"
            />

            <Separator />

            <BooleanField
              control={form.control}
              description="Customers on this plan can buy prepaid credit via Polar."
              label="Allow credit top-up"
              name="allowTopup"
            />
            <BooleanField
              control={form.control}
              description="When credit hits zero, postpaid overage continues running Cubes (subject to per-space cap)."
              label="Allow overage"
              name="allowOverage"
            />

            <Separator />

            <div className="space-y-1">
              <h3 className="text-sm font-medium">Snapshots</h3>
              <p className="text-xs text-muted-foreground">
                Auto snapshots run on the cron cadence and rotate per the
                retention buckets. Pinned snapshots count against the manual cap
                and survive auto-prune.
              </p>
            </div>

            <FormField
              control={form.control}
              name="autoSnapshotCadenceHours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Auto-snapshot cadence (hours)</FormLabel>
                  <FormControl>
                    <Input
                      max={168}
                      min={2}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === "" ? null : Number(e.target.value)
                        )
                      }
                      placeholder="Disabled"
                      type="number"
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormDescription>
                    Blank = auto disabled (Trial). Minimum 2h. Common: 12h
                    (Starter), 6h (Pro), 4h (Business).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-3">
              <FormField
                control={form.control}
                name="autoSnapshotKeepLast"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Keep last</FormLabel>
                    <FormControl>
                      <Input
                        min={0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        type="number"
                        value={field.value}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="autoSnapshotKeepDaily"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Keep daily</FormLabel>
                    <FormControl>
                      <Input
                        min={0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        type="number"
                        value={field.value}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="autoSnapshotKeepWeekly"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Keep weekly</FormLabel>
                    <FormControl>
                      <Input
                        min={0}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                        type="number"
                        value={field.value}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="maxManualSnapshotsPerCube"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Max manual snapshots per Cube</FormLabel>
                  <FormControl>
                    <Input
                      min={0}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      type="number"
                      value={field.value}
                    />
                  </FormControl>
                  <FormDescription>
                    Hard cap. 0 = customer cannot create manual snapshots
                    (Trial). Pinning an auto snapshot consumes a manual slot.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />

            <FormField
              control={form.control}
              name="visibility"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Visibility</FormLabel>
                  <FormControl>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          className="w-full justify-between font-normal"
                          type="button"
                          variant="outline"
                        >
                          {field.value === "public"
                            ? "Public — visible to every space"
                            : "Custom — visible only to assigned spaces"}
                          <CaretDownIcon className="size-4 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                        <DropdownMenuItem
                          onClick={() =>
                            form.setValue("visibility", "public", {
                              shouldValidate: true,
                              shouldDirty: true,
                            })
                          }
                        >
                          Public
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            form.setValue("visibility", "custom", {
                              shouldValidate: true,
                              shouldDirty: true,
                            })
                          }
                        >
                          Custom
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </FormControl>
                  {watchedVisibility === "custom" && (
                    <FormDescription>
                      Custom plans require explicit assignment per space.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sortOrder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sort order</FormLabel>
                  <FormControl>
                    <Input
                      max={10_000}
                      min={0}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      step={1}
                      type="number"
                      value={Number.isFinite(field.value) ? field.value : 0}
                    />
                  </FormControl>
                  <FormDescription>
                    Lower sorts first in the customer plan-selection UI.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-center justify-end gap-2 pt-2">
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
                  (mode === "edit" && !form.formState.isDirty) ||
                  isPending
                }
                type="submit"
              >
                {isPending && <Spinner className="size-4" />}
                {mode === "create" ? "Create plan" : "Save changes"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>

      {/* Price-change pre-confirm dialog. Polar grandfathers existing
          subscribers at the old price — surface subscriber count + the
          consequence so the operator never silently changes pricing
          without realizing only NEW checkouts are affected. */}
      <AlertDialog
        onOpenChange={(next) => {
          if (!next) {
            setPendingPriceChange(null);
          }
        }}
        open={pendingPriceChange !== null}
      >
        <AlertDialogContent>
          {pendingPriceChange && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Change price from ${pendingPriceChange.oldPriceUsd}/mo to $
                  {pendingPriceChange.newPriceUsd}/mo?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>
                      <strong>{subscriberCount}</strong> active{" "}
                      {subscriberCount === 1 ? "subscriber" : "subscribers"} on
                      this plan will be{" "}
                      <strong>
                        grandfathered at ${pendingPriceChange.oldPriceUsd}/mo
                      </strong>{" "}
                      — Polar keeps existing subscriptions on their original
                      price. Only NEW checkouts will be charged $
                      {pendingPriceChange.newPriceUsd}/mo.
                    </p>
                    <p>
                      To migrate existing subscribers, you would need to cancel
                      + re-subscribe each one, which they will see as a one-day
                      service interruption.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isPending}>
                  Keep current price
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    const confirmed = pendingPriceChange;
                    setPendingPriceChange(null);
                    dispatchSubmit(confirmed.values);
                  }}
                >
                  {isPending && <Spinner className="size-4" />}
                  Change price (new checkouts only)
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

type NullableIntName =
  | "maxConcurrentCubes"
  | "maxSeats"
  | "maxBackups"
  | "maxDomains";

function NullableIntField({
  control,
  name,
  label,
}: {
  control: ReturnType<typeof useForm<FormValues>>["control"];
  name: NullableIntName;
  label: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const unlimited = field.value === null;
        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <div className="flex items-center gap-3">
              <FormControl>
                <Input
                  className="max-w-[10rem]"
                  disabled={unlimited}
                  min={0}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === "" ? 0 : Number(e.target.value)
                    )
                  }
                  placeholder={unlimited ? "Unlimited" : undefined}
                  step={1}
                  type="number"
                  value={unlimited ? "" : (field.value ?? 0)}
                />
              </FormControl>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps a Radix Checkbox which renders as a button — implicit-child association is intentional */}
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={unlimited}
                  onCheckedChange={(checked) =>
                    field.onChange(checked === true ? null : 0)
                  }
                />
                <span>Unlimited</span>
              </label>
            </div>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

type BooleanFieldName = "allowTopup" | "allowOverage";

function BooleanField({
  control,
  name,
  label,
  description,
}: {
  control: ReturnType<typeof useForm<FormValues>>["control"];
  name: BooleanFieldName;
  label: string;
  description: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <div className="flex items-start justify-between gap-3">
            <div>
              <FormLabel>{label}</FormLabel>
              <FormDescription>{description}</FormDescription>
            </div>
            <FormControl>
              <Switch
                aria-label={label}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            </FormControl>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
