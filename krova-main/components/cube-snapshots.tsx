"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArchiveIcon,
  CameraIcon,
  ClockCounterClockwiseIcon,
  DownloadSimpleIcon,
  InfoIcon,
  PushPinIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  createSnapshot,
  deleteSnapshot,
  exportSnapshot,
  pinAutoSnapshot,
  promoteSnapshotToBackup,
  restoreSnapshot,
} from "@/app/actions/snapshots";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { LocalDate } from "@/components/local-date";
import { SnapshotCloneSheet } from "@/components/snapshot-clone-sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { Badge } from "@/components/ui/badge";
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
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePusherChannel, usePusherEvent } from "@/hooks/use-pusher";
import { formatBytes } from "@/lib/format";
import { capitalizeStatus, snapshotStatusVariant } from "@/lib/status-display";

const createSnapshotSchema = z.object({
  name: z.string().trim().min(1, "Snapshot name is required"),
});

type CreateSnapshotValues = z.infer<typeof createSnapshotSchema>;

interface Snapshot {
  completedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByEmail: string | null;
  id: string;
  kind: "auto" | "manual";
  name: string;
  sizeBytes: number | null;
  status: "pending" | "creating" | "complete" | "restoring" | "failed";
}

interface CubeSnapshotsProps {
  canManage: boolean;
  cubeDiskGb: number;
  cubeId: string;
  cubeRamMb: number;
  cubeStatus: string;
  cubeVcpus: number;
  /** Region + plan limits feed the "Clone to new cube" sheet. NULL = clone
   *  button hidden (page hasn't loaded regions or plan yet). */
  planLimits: {
    maxDiskGb: number;
    maxRamMb: number;
    maxVcpus: number;
    planName: string;
  } | null;
  regions: { id: string; name: string }[];
  snapshots: Snapshot[];
  spaceId: string;
}

export function CubeSnapshots({
  cubeId,
  spaceId,
  cubeStatus,
  snapshots,
  canManage,
  cubeVcpus,
  cubeRamMb,
  cubeDiskGb,
  planLimits,
  regions,
}: CubeSnapshotsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<Snapshot | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Snapshot | null>(null);
  const [cloneTargetId, setCloneTargetId] = useState<string | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<Snapshot | null>(null);
  const [promoteName, setPromoteName] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "auto" | "manual">(
    "all"
  );
  const [search, setSearch] = useState("");
  const canClone = canManage && planLimits !== null && regions.length > 0;

  // Snapshot count by kind — surfaced in tab labels so the customer sees how
  // many auto vs manual they have without clicking through.
  const autoCount = snapshots.filter((s) => s.kind === "auto").length;
  const manualCount = snapshots.filter((s) => s.kind === "manual").length;
  const query = search.trim().toLowerCase();
  const filteredSnapshots = snapshots.filter((s) => {
    if (kindFilter !== "all" && s.kind !== kindFilter) {
      return false;
    }
    if (
      query &&
      !`${s.name} ${s.createdByEmail ?? ""}`.toLowerCase().includes(query)
    ) {
      return false;
    }
    return true;
  });

  const form = useForm<CreateSnapshotValues>({
    resolver: zodResolver(createSnapshotSchema),
    defaultValues: { name: "" },
    mode: "onChange",
  });

  // Listen for real-time snapshot status updates from the worker
  const channel = usePusherChannel(`private-cube-${cubeId}`);
  usePusherEvent(
    channel,
    "lifecycle.update",
    useCallback(
      (data: unknown) => {
        const event = data as { snapshotId?: string };
        if (event.snapshotId) {
          router.refresh();
        }
      },
      [router]
    )
  );

  const canCreate =
    (cubeStatus === "running" || cubeStatus === "sleeping") && canManage;
  const canRestore =
    (cubeStatus === "running" || cubeStatus === "sleeping") && canManage;

  async function handleCreate(values: CreateSnapshotValues) {
    const result = await createSnapshot(spaceId, cubeId, values.name);
    if ("error" in result) {
      form.setError("root", { message: result.error });
      return;
    }
    toast.success("Snapshot is being created in the background");
    setSheetOpen(false);
    form.reset({ name: "" });
    router.refresh();
  }

  function handleSheetOpenChange(open: boolean) {
    setSheetOpen(open);
    if (!open) {
      form.reset({ name: "" });
    }
  }

  function handleRestoreConfirm() {
    if (!restoreTarget) {
      return;
    }
    const target = restoreTarget;
    startTransition(async () => {
      const result = await restoreSnapshot(spaceId, cubeId, target.id);
      setRestoreTarget(null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Restore started. The Cube will restart with snapshot "${target.name}".`
      );
      router.refresh();
    });
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) {
      return;
    }
    const target = deleteTarget;
    startTransition(async () => {
      const result = await deleteSnapshot(spaceId, cubeId, target.id);
      setDeleteTarget(null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Snapshot "${target.name}" is being deleted`);
      router.refresh();
    });
  }

  function handleRetryFailed(snapshot: Snapshot) {
    startTransition(async () => {
      const result = await createSnapshot(spaceId, cubeId, snapshot.name);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // Clear the old failed note now that a fresh attempt is queued.
      await deleteSnapshot(spaceId, cubeId, snapshot.id).catch(() => {});
      toast.success(`Retrying snapshot "${snapshot.name}"…`);
      router.refresh();
    });
  }

  function handleExport(snapshot: Snapshot) {
    startTransition(async () => {
      const result = await exportSnapshot(spaceId, cubeId, snapshot.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Preparing "${snapshot.name}" for download — we'll email a link shortly.`
      );
      router.refresh();
    });
  }

  function handlePin(snapshot: Snapshot) {
    startTransition(async () => {
      const result = await pinAutoSnapshot(spaceId, cubeId, snapshot.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Pinned "${snapshot.name}" — now a manual snapshot.`);
      router.refresh();
    });
  }

  function handlePromoteConfirm() {
    const target = promoteTarget;
    if (!target) {
      return;
    }
    startTransition(async () => {
      const name = promoteName.trim() || `${target.name} (backup)`;
      const result = await promoteSnapshotToBackup(
        spaceId,
        cubeId,
        target.id,
        name
      );
      setPromoteTarget(null);
      setPromoteName("");
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Promoting "${target.name}" to a backup. It will appear in the Backups page when ready.`
      );
      router.refresh();
    });
  }

  // Actions shown at the TOP of an expanded accordion row. Same gating as the
  // old table's action column; rendered inline (no array) so each conditional
  // button needs no key. A snapshot with no available action (in-progress, or
  // a complete auto snapshot the viewer can't manage) shows a muted note.
  function renderSnapshotActions(s: Snapshot) {
    const isComplete = s.status === "complete";
    // Delete is allowed on failed snapshots regardless of kind so operators
    // can clear out broken auto-snapshots that would otherwise be permanent
    // UI clutter.
    const canDeleteRow =
      canManage &&
      ((isComplete && s.kind === "manual") || s.status === "failed");
    const hasAnyAction =
      (isComplete && (canRestore || canManage || canClone)) || canDeleteRow;

    if (!hasAnyAction) {
      return (
        <p className="text-xs text-muted-foreground">
          {s.status === "pending" || s.status === "creating"
            ? "Snapshot in progress — actions appear once it completes."
            : "No actions available for this snapshot."}
        </p>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-2">
        {canRestore && isComplete && (
          <Button
            disabled={isPending}
            onClick={() => setRestoreTarget(s)}
            size="sm"
            variant="ghost"
          >
            <ClockCounterClockwiseIcon className="size-4" />
            Restore
          </Button>
        )}
        {canManage && isComplete && (
          <Button
            disabled={isPending}
            onClick={() => handleExport(s)}
            size="sm"
            variant="ghost"
          >
            <DownloadSimpleIcon className="size-4" />
            Download
          </Button>
        )}
        {canClone && isComplete && (
          <Button
            disabled={isPending}
            onClick={() => setCloneTargetId(s.id)}
            size="sm"
            variant="ghost"
          >
            <CameraIcon className="size-4" />
            Clone
          </Button>
        )}
        {canManage && s.kind === "auto" && isComplete && (
          <Button
            disabled={isPending}
            onClick={() => handlePin(s)}
            size="sm"
            variant="ghost"
          >
            <PushPinIcon className="size-4" />
            Pin
          </Button>
        )}
        {canManage && isComplete && (
          <Button
            disabled={isPending}
            onClick={() => {
              setPromoteName(`${s.name} (backup)`);
              setPromoteTarget(s);
            }}
            size="sm"
            variant="ghost"
          >
            <ArchiveIcon className="size-4" />
            Save as Backup
          </Button>
        )}
        {canManage && s.status === "failed" && (
          <Button
            disabled={isPending || !canCreate}
            onClick={() => handleRetryFailed(s)}
            size="sm"
            variant="ghost"
          >
            <CameraIcon className="size-4" />
            Retry
          </Button>
        )}
        {canDeleteRow && (
          <Button
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={isPending}
            onClick={() => setDeleteTarget(s)}
            size="sm"
            variant="ghost"
          >
            <TrashIcon className="size-4" />
            Delete
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Snapshots</div>
        {canCreate && (
          <div className="flex items-center gap-2">
            <Sheet onOpenChange={handleSheetOpenChange} open={sheetOpen}>
              <SheetTrigger asChild>
                <Button disabled={isPending} size="sm">
                  <CameraIcon className="mr-1.5 size-4" />
                  Create Snapshot
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Create snapshot</SheetTitle>
                  <SheetDescription>
                    A live snapshot of the current disk state. Saved to cloud
                    storage. The Cube keeps running during the snapshot.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-4 px-4 pb-4">
                  <Form {...form}>
                    <form
                      className="space-y-4"
                      onSubmit={form.handleSubmit(handleCreate)}
                    >
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
                            <FormLabel>Snapshot Name</FormLabel>
                            <FormControl>
                              <Input
                                autoFocus
                                placeholder="e.g. before-update"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        className="w-full"
                        disabled={
                          !form.formState.isValid || form.formState.isSubmitting
                        }
                        type="submit"
                      >
                        {form.formState.isSubmitting && (
                          <Spinner className="mr-2 size-4" />
                        )}
                        Create Snapshot
                      </Button>
                    </form>
                  </Form>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup
          className="w-fit"
          onValueChange={(value) => {
            // Radix returns "" when the active item is clicked again; clamp
            // back to "all" so the list never empties unexpectedly.
            if (value === "all" || value === "auto" || value === "manual") {
              setKindFilter(value);
            } else if (value === "") {
              setKindFilter("all");
            }
          }}
          type="single"
          value={kindFilter}
          variant="outline"
        >
          <ToggleGroupItem value="all">
            All ({snapshots.length})
          </ToggleGroupItem>
          <ToggleGroupItem value="auto">Auto ({autoCount})</ToggleGroupItem>
          <ToggleGroupItem value="manual">
            Manual ({manualCount})
          </ToggleGroupItem>
        </ToggleGroup>
        <Input
          className="sm:max-w-xs"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search snapshots…"
          value={search}
        />
      </div>

      {filteredSnapshots.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center">
          <p className="text-sm font-medium">
            {kindFilter === "auto"
              ? "No auto snapshots yet"
              : kindFilter === "manual"
                ? "No manual snapshots yet"
                : "No snapshots yet"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {query
              ? "No snapshots match your search."
              : kindFilter === "auto"
                ? "Auto snapshots are scheduled by your plan — none captured yet."
                : "Create one to save the current disk state."}
          </p>
        </div>
      ) : (
        <Accordion className="rounded-md border" collapsible type="single">
          {filteredSnapshots.map((s) => (
            <AccordionItem
              className="px-3 last:border-b-0"
              key={s.id}
              value={s.id}
            >
              <AccordionTrigger className="items-center gap-3 hover:no-underline">
                <span className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 pr-2">
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  <Badge
                    className="text-[10px]"
                    variant={s.kind === "auto" ? "outline" : "secondary"}
                  >
                    {s.kind === "auto" ? "Auto" : "Manual"}
                  </Badge>
                  <Badge
                    className="text-[10px]"
                    variant={snapshotStatusVariant(s.status)}
                  >
                    {capitalizeStatus(s.status)}
                  </Badge>
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {s.kind === "auto"
                      ? "System"
                      : (s.createdByEmail ?? "Unknown")}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    <LocalDate iso={s.createdAt} mode="relative" />
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                {renderSnapshotActions(s)}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
                  <div className="flex items-center gap-1.5">
                    <dt className="inline-flex items-center gap-1 text-muted-foreground">
                      Added
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            aria-label="What does Added mean?"
                            className="inline-flex text-muted-foreground"
                            type="button"
                          >
                            <InfoIcon className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-left font-normal normal-case">
                          Snapshots are incremental. This is the deduplicated
                          new data this snapshot added — the first snapshot
                          uploads the whole cube, later ones only what changed
                          since the previous snapshots.
                        </TooltipContent>
                      </Tooltip>
                    </dt>
                    <dd className="font-medium">{formatBytes(s.sizeBytes)}</dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt className="text-muted-foreground">Created by</dt>
                    <dd className="font-medium">
                      {s.kind === "auto"
                        ? "System"
                        : (s.createdByEmail ?? "Unknown")}
                    </dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt className="text-muted-foreground">Created</dt>
                    <dd className="font-medium">
                      <LocalDate iso={s.createdAt} />
                    </dd>
                  </div>
                </dl>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      <ConfirmActionDialog
        busy={isPending}
        confirmLabel="Restore"
        description={
          <p>
            This will stop the Cube, replace the disk with snapshot{" "}
            <strong className="text-foreground">{restoreTarget?.name}</strong>,
            and restart it. Any data written since the snapshot was taken will
            be lost.
          </p>
        }
        destructive={false}
        onConfirm={handleRestoreConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreTarget(null);
          }
        }}
        open={!!restoreTarget}
        title="Restore Snapshot"
      />

      <ConfirmActionDialog
        busy={isPending}
        confirmLabel="Delete"
        description={
          <p>
            Permanently delete snapshot{" "}
            <strong className="text-foreground">{deleteTarget?.name}</strong>?
            This cannot be undone.
          </p>
        }
        onConfirm={handleDeleteConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        open={!!deleteTarget}
        title="Delete Snapshot"
      />

      {planLimits && (
        <SnapshotCloneSheet
          cubeId={cubeId}
          onOpenChange={(open) => !open && setCloneTargetId(null)}
          open={cloneTargetId !== null}
          planLimits={planLimits}
          regions={regions}
          snapshotId={cloneTargetId ?? ""}
          sourceCube={{
            vcpus: cubeVcpus,
            ramMb: cubeRamMb,
            diskLimitGb: cubeDiskGb,
          }}
          spaceId={spaceId}
        />
      )}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !isPending) {
            setPromoteTarget(null);
            setPromoteName("");
          }
        }}
        open={!!promoteTarget}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save snapshot as Backup</AlertDialogTitle>
            <AlertDialogDescription>
              Promotes <strong>{promoteTarget?.name}</strong> into a
              redeployable backup. Backups survive cube deletion and are billed
              per-GB-month.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            onChange={(e) => setPromoteName(e.target.value)}
            placeholder="Backup name"
            value={promoteName}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || promoteName.trim().length === 0}
              onClick={(e) => {
                e.preventDefault();
                handlePromoteConfirm();
              }}
            >
              {isPending && <Spinner className="size-4" />}
              Save as Backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
