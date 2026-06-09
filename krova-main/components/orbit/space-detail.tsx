"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { format, formatDistanceToNow, isPast } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import type { OverrideField } from "@/app/actions/orbit-space-overrides";
import { setSpaceOverride } from "@/app/actions/orbit-space-overrides";
import { CopyButton } from "@/components/copy-button";
import { CubesTable } from "@/components/orbit/cubes-table";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { CubeStatusValue } from "@/db/schema/types";
import { useMutation } from "@/hooks/use-mutation";
import { useTabParam } from "@/hooks/use-tab-param";
import { isBillingDebit } from "@/lib/billing-events";
import {
  BILLING_EVENT_TYPE_CLASSES,
  type BillingEventType,
  subscriptionStatusVariant,
} from "@/lib/status-display";

const TAB_VALUES = [
  "overview",
  "members",
  "cubes",
  "plan",
  "subscription",
  "billing",
  "danger",
] as const;

const topupSchema = z.object({
  amount: z
    .number({ error: "Enter a valid amount" })
    .positive("Amount must be greater than 0"),
  note: z.string().optional(),
});

type TopupValues = z.infer<typeof topupSchema>;

interface SpaceProps {
  createdAt: Date;
  creditBalance: number;
  id: string;
  name: string;
}

interface MemberRow {
  email: string;
  id: string;
  isOwner: boolean;
  joinedAt: Date;
  name: string;
  userId: string;
}

interface CubeRow {
  createdAt: Date;
  id: string;
  name: string;
  ramMb: number;
  regionName: string;
  serverHostname: string;
  serverId: string;
  spaceId: string;
  spaceName: string;
  status: CubeStatusValue;
  vcpus: number;
}

interface BillingEventRow {
  amount: number;
  createdAt: Date;
  description: string | null;
  id: string;
  type: BillingEventType;
}

/** Plan defaults the overrides card shows alongside each input. */
interface PlanForOverrides {
  allowOverage: boolean;
  allowTopup: boolean;
  id: string;
  includedCreditUsd: number;
  maxBackups: number | null;
  maxConcurrentCubes: number | null;
  maxDiskGb: number;
  maxDomains: number | null;
  maxRamMb: number;
  maxSeats: number | null;
  maxVcpus: number;
  name: string;
}

/** Live subscription state, hydrated from `spaces` columns + `plans` join. */
interface SubscriptionInfo {
  currentPeriodEnd: Date | null;
  paymentProvider: string | null;
  polarCustomerId: string | null;
  providerSubscriptionId: string | null;
  status: string | null;
  subscriptionEventAt: Date | null;
}

/** A single row from `subscription_credit_grants` for the recent-grants mini-table. */
interface GrantRow {
  amount: number;
  createdAt: Date;
  id: string;
  periodEnd: Date;
  periodStart: Date;
  planName: string;
  reason: string;
}

/** Per-space override state — null = use plan default. */
interface SpaceOverrideValues {
  overrideAllowOverage: boolean | null;
  overrideAllowTopup: boolean | null;
  overrideIncludedCreditUsd: number | null;
  overrideMaxBackups: number | null;
  overrideMaxConcurrentCubes: number | null;
  overrideMaxDiskGb: number | null;
  overrideMaxDomains: number | null;
  overrideMaxRamMb: number | null;
  overrideMaxSeats: number | null;
  overrideMaxVcpus: number | null;
  overrideOverageCapMaxUsd: number | null;
}

export function SpaceDetail({
  space,
  plan,
  overrides,
  members,
  cubes,
  deletionScope,
  billingEvents,
  subscription,
  recentGrants,
}: {
  space: SpaceProps;
  plan: PlanForOverrides;
  overrides: SpaceOverrideValues;
  members: MemberRow[];
  cubes: CubeRow[];
  deletionScope: { cubes: number; snapshots: number; backups: number };
  billingEvents: BillingEventRow[];
  subscription: SubscriptionInfo;
  recentGrants: GrantRow[];
}) {
  const router = useRouter();
  const tabParam = useTabParam(TAB_VALUES, "overview");
  const { trigger: triggerTopup, isMutating: toppingUp } = useMutation();
  const { trigger: triggerResync, isMutating: resyncing } = useMutation();
  // Force-delete navigates away from this page. We MUST skip the
  // hook's default `router.refresh()` (which targets the CURRENT route per
  // Next.js docs) — otherwise the server component re-fetches a space that
  // no longer exists, hits notFound(), and the user sees a 404 flash before
  // the push lands. Refresh fires on the destination instead.
  const { trigger: triggerDelete, isMutating: deleting } = useMutation({
    revalidate: false,
    onSuccess: () => {
      router.push("/orbit/spaces");
      router.refresh();
    },
  });
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const topupForm = useForm<TopupValues>({
    resolver: zodResolver(topupSchema),
    defaultValues: { note: "" },
    mode: "onChange",
  });

  async function handleTopup(values: TopupValues) {
    const result = await triggerTopup({
      url: `/api/orbit/spaces/${space.id}`,
      method: "PATCH",
      body: {
        amount: values.amount,
        note: values.note || undefined,
      },
      successMessage: `Added ${values.amount} credits to ${space.name}`,
      errorMessage: "Failed to top up",
    });

    if (result !== null) {
      topupForm.reset({ note: "" });
    }
  }

  async function handleResync() {
    const result = (await triggerResync({
      url: `/api/orbit/spaces/${space.id}/resync-subscription`,
      method: "POST",
      errorMessage: "Failed to resync subscription",
    })) as { outcome?: { result?: string } } | null;
    if (result) {
      toast.success(
        `Subscription resynced (${result.outcome?.result ?? "done"})`
      );
    }
  }

  async function handleDelete() {
    await triggerDelete({
      url: `/api/orbit/spaces/${space.id}`,
      method: "DELETE",
      successMessage: "Space deleted",
      errorMessage: "Failed to delete space",
    });
  }

  return (
    <div className="space-y-6">
      {/* Space info */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Credit Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold">
              {space.creditBalance.toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Created
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {format(space.createdAt, "MMM d, yyyy HH:mm")}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs className="space-y-6" {...tabParam}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="cubes">Cubes</TabsTrigger>
          <TabsTrigger value="plan">Plan &amp; Overrides</TabsTrigger>
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="danger">Danger Zone</TabsTrigger>
        </TabsList>

        {/* ─── Overview: top-up credits ────────────────────────────── */}
        <TabsContent className="space-y-6" value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Top Up Credits</CardTitle>
              <CardDescription>
                Add credits to this space&apos;s balance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...topupForm}>
                <form
                  className="flex items-start gap-4"
                  onSubmit={topupForm.handleSubmit(handleTopup)}
                >
                  <FormField
                    control={topupForm.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount</FormLabel>
                        <FormControl>
                          <Input
                            className="w-32"
                            min={0.01}
                            name={field.name}
                            onBlur={field.onBlur}
                            onChange={(e) =>
                              field.onChange(e.target.valueAsNumber || "")
                            }
                            placeholder="10.00"
                            ref={field.ref}
                            step={0.01}
                            type="number"
                            value={field.value ?? ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={topupForm.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>Note (optional)</FormLabel>
                        <FormControl>
                          <Textarea
                            className="min-h-9 resize-none"
                            placeholder="Reason for top-up..."
                            rows={1}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    className="mt-6 h-9"
                    disabled={!topupForm.formState.isValid || toppingUp}
                    type="submit"
                  >
                    {toppingUp && <Spinner className="size-4" />}
                    Add Credits
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Members ──────────────────────────────────────────────── */}
        <TabsContent className="space-y-6" value="members">
          <Card>
            <CardHeader>
              <CardTitle>Members ({members.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {members.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No members.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((m) => (
                      <TableRow
                        className="cursor-pointer"
                        key={m.id}
                        onClick={() => router.push(`/orbit/users/${m.userId}`)}
                      >
                        <TableCell className="font-medium">{m.email}</TableCell>
                        <TableCell>{m.name}</TableCell>
                        <TableCell>
                          {m.isOwner ? (
                            <Badge variant="secondary">Owner</Badge>
                          ) : (
                            "Member"
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(m.joinedAt, "MMM d, yyyy")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Cubes ────────────────────────────────────────────────── */}
        {/* Reuses the same CubesTable as /orbit/cubes — same Sleep/Delete/
            Purge actions — but scoped to THIS space's cubes only (the page
            loads `WHERE spaceId = …`), so an operator cannot accidentally act
            on a cube outside this space. `hideSpaceColumn` drops the redundant
            Space column + Space filter. */}
        <TabsContent className="space-y-6" value="cubes">
          <CubesTable
            cubes={cubes}
            hideSpaceColumn
            servers={[
              ...new Map(
                cubes.map((c) => [c.serverId, c.serverHostname])
              ).entries(),
            ].map(([id, hostname]) => ({ id, hostname }))}
          />
        </TabsContent>

        {/* ─── Plan & Overrides ────────────────────────────────────── */}
        <TabsContent className="space-y-6" value="plan">
          <PlanOverridesCard initial={overrides} plan={plan} space={space} />
        </TabsContent>

        {/* ─── Billing events ──────────────────────────────────────── */}
        <TabsContent className="space-y-6" value="billing">
          <Card>
            <CardHeader>
              <CardTitle>Recent Billing Events</CardTitle>
              <CardDescription>
                Last 50 billing events for this space. Search by type or
                description.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(() => {
                const billingColumns: DataTableColumn<BillingEventRow>[] = [
                  {
                    id: "type",
                    header: "Type",
                    className: "w-[170px]",
                    cell: (e) => (
                      <Badge
                        className={BILLING_EVENT_TYPE_CLASSES[e.type] ?? ""}
                        variant="secondary"
                      >
                        {e.type.replace(/_/g, " ")}
                      </Badge>
                    ),
                  },
                  {
                    id: "amount",
                    header: "Amount",
                    numeric: true,
                    className: "w-[120px]",
                    cell: (e) => {
                      const isDebit = isBillingDebit(e.type);
                      return (
                        <span
                          className={
                            isDebit
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }
                        >
                          {isDebit ? "−" : "+"}${Math.abs(e.amount).toFixed(4)}
                        </span>
                      );
                    },
                  },
                  {
                    id: "description",
                    header: "Description",
                    cell: (e) => (
                      <span className="text-muted-foreground">
                        {e.description ?? "—"}
                      </span>
                    ),
                  },
                  {
                    id: "createdAt",
                    header: "Date",
                    className: "w-[160px]",
                    cell: (e) => (
                      <span className="text-xs text-muted-foreground">
                        {format(e.createdAt, "MMM d, yyyy HH:mm")}
                      </span>
                    ),
                  },
                ];
                return (
                  <DataTable<BillingEventRow>
                    columns={billingColumns}
                    data={billingEvents}
                    emptyDescription="This space hasn't been billed yet."
                    emptyTitle="No billing events"
                    pageSize={10}
                    rowKey={(e) => e.id}
                    searchAccessor={(e) =>
                      `${e.type} ${e.description ?? ""} ${e.amount}`
                    }
                    searchPlaceholder="Search billing events…"
                  />
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Subscription ────────────────────────────────────────── */}
        <TabsContent className="space-y-6" value="subscription">
          <SubscriptionCard
            onResync={handleResync}
            plan={plan}
            resyncing={resyncing}
            subscription={subscription}
          />
          <RecentGrantsCard grants={recentGrants} />
        </TabsContent>

        {/* ─── Danger zone ─────────────────────────────────────────── */}
        <TabsContent className="space-y-6" value="danger">
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
              <CardDescription>
                Force-delete this space and all its Cubes and data.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <div className="font-mono text-lg font-semibold text-destructive tabular-nums">
                    {deletionScope.cubes}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {deletionScope.cubes === 1 ? "Cube" : "Cubes"}
                  </div>
                </div>
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <div className="font-mono text-lg font-semibold text-destructive tabular-nums">
                    {deletionScope.snapshots}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {deletionScope.snapshots === 1 ? "Snapshot" : "Snapshots"}
                  </div>
                </div>
                <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <div className="font-mono text-lg font-semibold text-destructive tabular-nums">
                    {deletionScope.backups}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {deletionScope.backups === 1 ? "Backup" : "Backups"}
                  </div>
                </div>
              </div>
              <AlertDialog
                onOpenChange={(open) => {
                  if (!open) {
                    setDeleteConfirm("");
                  }
                }}
              >
                <AlertDialogTrigger asChild>
                  <Button disabled={deleting} size="sm" variant="destructive">
                    {deleting && <Spinner className="size-4" />}
                    Force Delete Space
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Force delete space?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-3">
                        <p>
                          This will permanently destroy{" "}
                          <strong className="text-foreground">
                            {space.name}
                          </strong>{" "}
                          and everything it owns. This cannot be undone.
                        </p>
                        <ul className="space-y-1 text-sm">
                          <li className="flex items-start gap-2">
                            <span className="font-mono text-destructive tabular-nums">
                              {deletionScope.cubes}
                            </span>
                            <span>
                              {deletionScope.cubes === 1 ? "Cube" : "Cubes"}{" "}
                              torn down (VMs, host disks, networking)
                            </span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="font-mono text-destructive tabular-nums">
                              {deletionScope.snapshots}
                            </span>
                            <span>
                              snapshot object
                              {deletionScope.snapshots === 1 ? "" : "s"} removed
                              from the storage backend
                            </span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="font-mono text-destructive tabular-nums">
                              {deletionScope.backups}
                            </span>
                            <span>
                              backup object
                              {deletionScope.backups === 1 ? "" : "s"} removed
                              from the storage backend
                            </span>
                          </li>
                          <li className="flex items-start gap-2">
                            <span className="text-destructive">•</span>
                            <span>
                              All memberships, invites, custom domains, TCP
                              mappings, audit history
                            </span>
                          </li>
                        </ul>
                        <p>
                          Type{" "}
                          <strong className="text-foreground">
                            {space.name}
                          </strong>{" "}
                          to confirm.
                        </p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <Input
                    autoComplete="off"
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder={space.name}
                    value={deleteConfirm}
                  />
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleting}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={deleteConfirm !== space.name || deleting}
                      onClick={(e) => {
                        e.preventDefault();
                        if (deleteConfirm !== space.name) {
                          return;
                        }
                        handleDelete();
                      }}
                    >
                      {deleting && <Spinner className="size-4" />}
                      Force delete space
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan overrides card
// ---------------------------------------------------------------------------

/**
 * The set of override fields the operator can edit, in display order.
 * Each entry maps to one column on `spaces` + the matching plan field that
 * supplies the "plan default" hint shown next to the input.
 *
 * `kind`:
 *   - `int`: integer input; null = use plan default.
 *   - `usd`: USD numeric input; null = use plan default.
 *   - `bool`: tri-state — true / false / null (null = use plan default).
 */
type OverrideKind = "int" | "usd" | "bool";
type OverrideGroup = "per-cube" | "per-space" | "billing";

interface OverrideRowSpec {
  field: OverrideField;
  group: OverrideGroup;
  kind: OverrideKind;
  label: string;
  planValue: (plan: PlanForOverrides) => number | boolean | null;
}

const OVERRIDE_GROUPS: {
  id: OverrideGroup;
  title: string;
  description: string;
}[] = [
  {
    id: "per-cube",
    title: "Per-Cube limits",
    description: "Ceilings applied to each individual Cube in this space.",
  },
  {
    id: "per-space",
    title: "Per-Space limits",
    description: "Caps applied across the whole space.",
  },
  {
    id: "billing",
    title: "Billing & overage",
    description: "Credit grant, top-up access, and postpaid overage controls.",
  },
];

const OVERRIDE_ROWS: OverrideRowSpec[] = [
  {
    field: "overrideMaxVcpus",
    label: "Max vCPUs per Cube",
    kind: "int",
    group: "per-cube",
    planValue: (p) => p.maxVcpus,
  },
  {
    field: "overrideMaxRamMb",
    label: "Max RAM per Cube (MB)",
    kind: "int",
    group: "per-cube",
    planValue: (p) => p.maxRamMb,
  },
  {
    field: "overrideMaxDiskGb",
    label: "Max disk per Cube (GB)",
    kind: "int",
    group: "per-cube",
    planValue: (p) => p.maxDiskGb,
  },
  {
    field: "overrideMaxConcurrentCubes",
    label: "Max concurrent Cubes",
    kind: "int",
    group: "per-space",
    planValue: (p) => p.maxConcurrentCubes,
  },
  {
    field: "overrideMaxSeats",
    label: "Max team seats",
    kind: "int",
    group: "per-space",
    planValue: (p) => p.maxSeats,
  },
  {
    field: "overrideMaxBackups",
    label: "Max backups",
    kind: "int",
    group: "per-space",
    planValue: (p) => p.maxBackups,
  },
  {
    field: "overrideMaxDomains",
    label: "Max custom domains",
    kind: "int",
    group: "per-space",
    planValue: (p) => p.maxDomains,
  },
  {
    field: "overrideIncludedCreditUsd",
    label: "Included credit per period (USD)",
    kind: "usd",
    group: "billing",
    planValue: (p) => p.includedCreditUsd,
  },
  {
    field: "overrideAllowTopup",
    label: "Allow top-up",
    kind: "bool",
    group: "billing",
    planValue: (p) => p.allowTopup,
  },
  {
    field: "overrideAllowOverage",
    label: "Allow overage",
    kind: "bool",
    group: "billing",
    planValue: (p) => p.allowOverage,
  },
  {
    field: "overrideOverageCapMaxUsd",
    label: "Overage cap max (USD)",
    kind: "usd",
    group: "billing",
    planValue: () => null,
  },
];

/** Local draft state — strings for inputs, booleans for switches, null = clear. */
type DraftValue = string | boolean | null;

type DraftState = Record<OverrideField, DraftValue>;

function valueToDraft(
  value: number | boolean | null,
  kind: OverrideKind
): DraftValue {
  if (value === null) {
    return null;
  }
  if (kind === "bool") {
    return value as boolean;
  }
  return String(value);
}

function initialDraft(values: SpaceOverrideValues): DraftState {
  const out = {} as DraftState;
  for (const row of OVERRIDE_ROWS) {
    out[row.field] = valueToDraft(
      values[row.field as keyof SpaceOverrideValues],
      row.kind
    );
  }
  return out;
}

function activeOverrideCount(values: SpaceOverrideValues): number {
  let n = 0;
  for (const row of OVERRIDE_ROWS) {
    if (values[row.field as keyof SpaceOverrideValues] !== null) {
      n++;
    }
  }
  return n;
}

/** Convert a draft value to the server-action payload for one field. */
function draftToPayload(
  value: DraftValue,
  kind: OverrideKind
): { ok: true; value: number | boolean | null } | { ok: false; error: string } {
  if (value === null || value === "") {
    return { ok: true, value: null };
  }
  if (kind === "bool") {
    if (typeof value !== "boolean") {
      return { ok: false, error: "Invalid boolean" };
    }
    return { ok: true, value };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "Invalid value" };
  }
  const parsed =
    kind === "int" ? Number.parseInt(value, 10) : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: "Not a number" };
  }
  if (kind === "int" && !Number.isInteger(parsed)) {
    return { ok: false, error: "Must be a whole number" };
  }
  if (parsed < 0) {
    return { ok: false, error: "Must be zero or greater" };
  }
  return { ok: true, value: parsed };
}

/** Diff initial vs current draft to compute the set of fields to write. */
function diffDraft(initial: DraftState, current: DraftState): OverrideField[] {
  const changed: OverrideField[] = [];
  for (const row of OVERRIDE_ROWS) {
    const a = initial[row.field];
    const b = current[row.field];
    // Treat "" and null as the same "clear" state for the diff.
    const aNorm = a === "" ? null : a;
    const bNorm = b === "" ? null : b;
    if (aNorm !== bNorm) {
      changed.push(row.field);
    }
  }
  return changed;
}

function PlanOverridesCard({
  space,
  plan,
  initial,
}: {
  space: SpaceProps;
  plan: PlanForOverrides;
  initial: SpaceOverrideValues;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState>(() => initialDraft(initial));
  const [initialState, setInitialState] = useState<DraftState>(() =>
    initialDraft(initial)
  );
  const [savedValues, setSavedValues] = useState<SpaceOverrideValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [sheetOpen, setSheetOpen] = useState(false);
  const activeCount = activeOverrideCount(savedValues);
  const changedFields = diffDraft(initialState, draft);
  const isDirty = changedFields.length > 0;

  function updateDraft(field: OverrideField, value: DraftValue) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  // Quick reference for the summary card — which fields are actually
  // overriding the plan vs. using the plan default.
  const activeFields = OVERRIDE_ROWS.filter(
    (row) => savedValues[row.field as keyof SpaceOverrideValues] !== null
  );

  async function handleSave() {
    setError(null);

    // Validate every changed field client-side before any network call so
    // we never half-apply a save.
    const payloads: Array<{
      field: OverrideField;
      value: number | boolean | null;
    }> = [];
    for (const field of changedFields) {
      const spec = OVERRIDE_ROWS.find((r) => r.field === field);
      if (!spec) {
        continue;
      }
      const parsed = draftToPayload(draft[field], spec.kind);
      if (!parsed.ok) {
        setError(`${spec.label}: ${parsed.error}`);
        return;
      }
      payloads.push({ field, value: parsed.value });
    }

    startTransition(async () => {
      const nextSaved: SpaceOverrideValues = { ...savedValues };
      for (const { field, value } of payloads) {
        const result = await setSpaceOverride(space.id, field, value);
        if ("error" in result) {
          setError(result.error);
          // Persist any partial successes into local state so the operator
          // can see what was committed and retry only the remainder.
          setSavedValues(nextSaved);
          setInitialState(initialDraft(nextSaved));
          router.refresh();
          return;
        }
        // Cast handled at the field-row level — `value` matches the column type.
        (nextSaved as unknown as Record<string, unknown>)[field] = value;
      }
      setSavedValues(nextSaved);
      setInitialState(initialDraft(nextSaved));
      toast.success(
        `Updated ${payloads.length} override${payloads.length === 1 ? "" : "s"}`
      );
      router.refresh();
    });
  }

  function handleClearField(field: OverrideField) {
    updateDraft(field, null);
  }

  function handleSheetOpenChange(next: boolean) {
    if (!next) {
      // Reset any unsaved draft when the sheet closes so re-opening starts
      // from the last persisted state.
      setDraft(initialState);
      setError(null);
    }
    setSheetOpen(next);
  }

  function formatActiveValue(row: OverrideRowSpec): string {
    const value = savedValues[row.field as keyof SpaceOverrideValues];
    if (value === null) {
      return "—";
    }
    if (typeof value === "boolean") {
      return value ? "yes" : "no";
    }
    return String(value);
  }

  function formatPlanValue(row: OverrideRowSpec): string {
    const v = row.planValue(plan);
    if (v === null) {
      return "unlimited / unset";
    }
    if (typeof v === "boolean") {
      return v ? "yes" : "no";
    }
    return String(v);
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Plan overrides</CardTitle>
            <CardDescription>
              Operator-only per-space adjustments to the {plan.name} plan&apos;s
              default limits. Empty means the plan value applies.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={activeCount > 0 ? "default" : "secondary"}>
              {activeCount} active
            </Badge>
            <Button
              onClick={() => setSheetOpen(true)}
              size="sm"
              variant="outline"
            >
              Edit overrides
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {activeFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No overrides set — this space uses every {plan.name} default.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {activeFields.map((row) => (
                <li
                  className="flex flex-wrap items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  key={row.field}
                >
                  <span className="text-foreground">{row.label}</span>
                  <span className="flex items-baseline gap-2 font-mono text-xs tabular-nums">
                    <span className="text-muted-foreground line-through">
                      {formatPlanValue(row)}
                    </span>
                    <span className="text-foreground">
                      {formatActiveValue(row)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Sheet onOpenChange={handleSheetOpenChange} open={sheetOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Edit plan overrides</SheetTitle>
            <SheetDescription>
              Override individual limits on the {plan.name} plan for{" "}
              <strong className="text-foreground">{space.name}</strong>. Leave a
              row blank to use the plan default. All changes are audit-logged.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-4 pb-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {OVERRIDE_GROUPS.map((group) => {
              const rows = OVERRIDE_ROWS.filter((r) => r.group === group.id);
              if (rows.length === 0) {
                return null;
              }
              return (
                <section className="space-y-3" key={group.id}>
                  <div>
                    <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
                      {group.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {group.description}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {rows.map((row) => {
                      const value = draft[row.field];
                      const planDefault = row.planValue(plan);
                      const isActive =
                        savedValues[row.field as keyof SpaceOverrideValues] !==
                        null;
                      return (
                        <OverrideRow
                          disabled={isPending}
                          isActive={isActive}
                          key={row.field}
                          onChange={(v) => updateDraft(row.field, v)}
                          onClear={() => handleClearField(row.field)}
                          planDefault={planDefault}
                          spec={row}
                          value={value}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}

            <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t bg-background px-4 py-3">
              <Button
                disabled={!isDirty || isPending}
                onClick={() => setDraft(initialState)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Discard changes
              </Button>
              <Button
                disabled={!isDirty || isPending}
                onClick={async () => {
                  await handleSave();
                  if (!error) {
                    setSheetOpen(false);
                  }
                }}
                size="sm"
                type="button"
              >
                {isPending && <Spinner className="size-4" />}
                {isDirty
                  ? `Save ${changedFields.length} ${changedFields.length === 1 ? "override" : "overrides"}`
                  : "Save changes"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function OverrideRow({
  spec,
  value,
  planDefault,
  isActive,
  disabled,
  onChange,
  onClear,
}: {
  spec: OverrideRowSpec;
  value: DraftValue;
  planDefault: number | boolean | null;
  isActive: boolean;
  disabled: boolean;
  onChange: (next: DraftValue) => void;
  onClear: () => void;
}) {
  const planHint =
    planDefault === null
      ? "no plan default"
      : typeof planDefault === "boolean"
        ? `plan: ${planDefault ? "yes" : "no"}`
        : `plan: ${planDefault}`;

  const inputId = `override-${spec.field}`;

  return (
    <div
      className={`flex items-center gap-3 rounded-md border p-3 ${
        isActive
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-transparent"
      }`}
    >
      <div className="flex-1">
        <Label className="text-sm font-medium" htmlFor={inputId}>
          {spec.label}
        </Label>
        <p className="text-xs text-muted-foreground">{planHint}</p>
      </div>
      <div className="flex items-center gap-2">
        {spec.kind === "bool" ? (
          <BoolOverrideControl
            disabled={disabled}
            inputId={inputId}
            onChange={onChange}
            value={value}
          />
        ) : (
          <Input
            className="w-32"
            disabled={disabled}
            id={inputId}
            inputMode="numeric"
            min={0}
            onChange={(e) => onChange(e.target.value)}
            placeholder={planDefault === null ? "" : String(planDefault)}
            step={spec.kind === "int" ? 1 : 0.01}
            type="number"
            value={typeof value === "string" ? value : ""}
          />
        )}
        <Button
          disabled={disabled || value === null || value === ""}
          onClick={onClear}
          size="sm"
          type="button"
          variant="ghost"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

function BoolOverrideControl({
  inputId,
  value,
  disabled,
  onChange,
}: {
  inputId: string;
  value: DraftValue;
  disabled: boolean;
  onChange: (next: DraftValue) => void;
}) {
  // Three states: null (use plan), true (override on), false (override off).
  // Render: a switch + a tiny "set" affordance — when null, switch is unchecked
  // and labelled "default"; toggling sets an explicit true/false.
  const isOverridden = typeof value === "boolean";
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={value === true}
        disabled={disabled}
        id={inputId}
        onCheckedChange={(checked) => onChange(checked)}
      />
      <span className="text-xs text-muted-foreground">
        {isOverridden ? (value ? "on" : "off") : "default"}
      </span>
    </div>
  );
}

function SubscriptionCard({
  plan,
  subscription,
  onResync,
  resyncing,
}: {
  plan: PlanForOverrides;
  subscription: SubscriptionInfo;
  onResync: () => void;
  resyncing: boolean;
}) {
  const hasSubscription = Boolean(subscription.providerSubscriptionId);

  if (!hasSubscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>
            This space is on the{" "}
            <span className="font-medium">{plan.name}</span> plan with no
            provider subscription.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const periodEnd = subscription.currentPeriodEnd;
  const periodEndPast = periodEnd ? isPast(periodEnd) : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription</CardTitle>
        <CardDescription>
          Live state mirrored from the payment provider webhook.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Plan</dt>
            <dd className="mt-0.5">
              <Link
                className="text-primary hover:underline"
                href={`/orbit/plans/${plan.id}`}
              >
                {plan.name}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="mt-0.5">
              <Badge variant={subscriptionStatusVariant(subscription.status)}>
                {subscription.status ?? "unknown"}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Period end</dt>
            <dd
              className={
                periodEndPast
                  ? "mt-0.5 text-destructive"
                  : "mt-0.5 text-foreground"
              }
            >
              {periodEnd
                ? `${format(periodEnd, "MMM d, yyyy")} · ${formatDistanceToNow(periodEnd, { addSuffix: true })}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Provider</dt>
            <dd className="mt-0.5 text-foreground">
              {subscription.paymentProvider ?? "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">
              Provider customer id
            </dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <span className="font-mono text-xs">
                {subscription.polarCustomerId ?? "—"}
              </span>
              {subscription.polarCustomerId && (
                <CopyButton
                  stopPropagation={false}
                  value={subscription.polarCustomerId}
                />
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Subscription id</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <span className="font-mono text-xs">
                {subscription.providerSubscriptionId ?? "—"}
              </span>
              {subscription.providerSubscriptionId && (
                <CopyButton
                  stopPropagation={false}
                  value={subscription.providerSubscriptionId}
                />
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Last event</dt>
            <dd className="mt-0.5 text-muted-foreground">
              {subscription.subscriptionEventAt
                ? `${formatDistanceToNow(subscription.subscriptionEventAt, { addSuffix: true })} · ${format(subscription.subscriptionEventAt, "PPpp")}`
                : "—"}
            </dd>
          </div>
        </dl>
        <Button
          disabled={resyncing}
          onClick={onResync}
          size="sm"
          type="button"
          variant="outline"
        >
          {resyncing && <Spinner className="size-4" />}
          Resync subscription
        </Button>
      </CardContent>
    </Card>
  );
}

function RecentGrantsCard({ grants }: { grants: GrantRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent plan-credit grants</CardTitle>
        <CardDescription>
          Included credit granted on subscription activation / renewal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No plan credit has been granted to this space yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Granted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.planName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(g.periodStart, "MMM d")} –{" "}
                    {format(g.periodEnd, "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    ${g.amount.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{g.reason}</Badge>
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={format(g.createdAt, "PPpp")}
                  >
                    {formatDistanceToNow(g.createdAt, { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
