"use client";

import {
  ArchiveIcon,
  ArrowSquareOutIcon,
  CubeIcon,
  DownloadIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteBackup } from "@/app/actions/backups";
import { BackupDownloadSheet } from "@/components/backup-download-sheet";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { IMAGE_OPTIONS } from "@/config/platform";
import { usePusherChannel, usePusherEvent } from "@/hooks/use-pusher";
import { formatBytes } from "@/lib/format";
import { backupStatusVariant, capitalizeStatus } from "@/lib/status-display";
import { cn } from "@/lib/utils";

interface BackupConfig {
  diskLimitGb: number;
  domainMappings: { domain: string; port: number }[];
  imageId: string;
  ramMb: number;
  regionId: string;
  regionName: string;
  tcpMappings: { cubePort: number; label: string | null }[];
  vcpus: number;
}

interface BackupItem {
  completedAt: string | null;
  config: BackupConfig;
  createdAt: string;
  diskSizeGb: number;
  id: string;
  name: string;
  originalCubeId: string;
  originalCubeName: string;
  redeployedCubeId: string | null;
  sizeBytes: number | null;
  status: "pending" | "creating" | "complete" | "failed";
  storageCostPerHour: number;
}

interface BackupListProps {
  backups: BackupItem[];
  canCreate: boolean;
  canManage: boolean;
  spaceId: string;
}

function formatRam(mb: number) {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  }
  return `${mb} MB`;
}

export function BackupList({
  backups,
  spaceId,
  canManage,
  canCreate,
}: BackupListProps) {
  const router = useRouter();

  // Listen on the space channel for cube lifecycle events — backup status
  // transitions (creating → complete / failed) are broadcast via
  // triggerCubeLifecycleEvent which also fires on private-space-{spaceId}.
  // This keeps the backup list fresh without polling.
  const channel = usePusherChannel(`private-space-${spaceId}`);
  usePusherEvent(
    channel,
    "lifecycle.update",
    useCallback(
      (data: unknown) => {
        const event = data as { backupId?: string; type?: string };
        if (event.backupId || event.type?.startsWith("backup.")) {
          router.refresh();
        }
      },
      [router]
    )
  );

  const [downloadBackup, setDownloadBackup] = useState<BackupItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupItem | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    BackupItem["status"] | "all"
  >("all");
  const [isPending, startTransition] = useTransition();

  const filtered =
    statusFilter === "all"
      ? backups
      : backups.filter((b) => b.status === statusFilter);

  function handleDelete() {
    if (!deleteTarget) {
      return;
    }
    const target = deleteTarget;
    startTransition(async () => {
      const result = await deleteBackup(spaceId, target.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Backup "${target.name}" deletion initiated`);
      setDeleteTarget(null);
      setConfirmName("");
      router.refresh();
    });
  }

  const columns: DataTableColumn<BackupItem>[] = [
    {
      id: "name",
      header: "Name",
      cell: (b) => (
        <div className="flex min-w-0 items-center gap-2">
          <ArchiveIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{b.name}</span>
              {b.redeployedCubeId && (
                <Badge
                  className="border-blue-500/20 bg-blue-500/10 text-xs text-blue-700 dark:text-blue-400"
                  variant="outline"
                >
                  Redeployed
                </Badge>
              )}
            </div>
            <Link
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              href={`/${spaceId}/cubes/${b.originalCubeId}`}
            >
              {b.originalCubeName}
            </Link>
          </div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      className: "w-[110px]",
      cell: (b) => (
        <Badge className="text-xs" variant={backupStatusVariant(b.status)}>
          {capitalizeStatus(b.status)}
        </Badge>
      ),
    },
    {
      id: "resources",
      header: "Resources",
      className: "w-[170px]",
      cell: (b) => (
        <div className="space-y-0.5 text-xs">
          <div className="font-mono text-foreground tabular-nums">
            {b.config.vcpus} vCPU · {formatRam(b.config.ramMb)} ·{" "}
            {b.config.diskLimitGb} GB
          </div>
          <div className="text-muted-foreground">
            {IMAGE_OPTIONS.find((o) => o.value === b.config.imageId)?.label ??
              b.config.imageId}{" "}
            · {b.config.regionName}
          </div>
        </div>
      ),
    },
    {
      id: "size",
      header: "Size",
      numeric: true,
      className: "w-[90px]",
      cell: (b) => formatBytes(b.sizeBytes),
    },
    {
      id: "cost",
      header: "Storage cost",
      numeric: true,
      className: "w-[130px]",
      cell: (b) => {
        if (b.status !== "complete" || b.storageCostPerHour <= 0) {
          return "—";
        }
        return (
          <span title={`$${b.storageCostPerHour.toFixed(4)}/hour`}>
            ${(b.storageCostPerHour * 730).toFixed(2)}/mo
          </span>
        );
      },
    },
    {
      id: "exposure",
      header: "Routing",
      className: "w-[110px]",
      cell: (b) => {
        const domainCount = b.config.domainMappings.length;
        const tcpCount = b.config.tcpMappings.length;
        if (domainCount === 0 && tcpCount === 0) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        const tip = [
          domainCount > 0
            ? b.config.domainMappings.map((d) => d.domain).join(", ")
            : null,
          tcpCount > 0 ? `${tcpCount} TCP` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <div className="space-y-0.5 text-xs" title={tip}>
            {domainCount > 0 && (
              <div>
                {domainCount} {domainCount === 1 ? "domain" : "domains"}
              </div>
            )}
            {tcpCount > 0 && (
              <div className="text-muted-foreground">
                {tcpCount} TCP {tcpCount === 1 ? "port" : "ports"}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: "created",
      header: "Created",
      className: "w-[120px]",
      cell: (b) => (
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}
        </span>
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "w-[220px] text-right",
      cell: (b) => (
        <div className="flex items-center justify-end gap-2">
          {b.redeployedCubeId && (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/${spaceId}/cubes/${b.redeployedCubeId}`}>
                <ArrowSquareOutIcon className="size-4" />
                View
              </Link>
            </Button>
          )}
          {b.status === "complete" && (
            <Button
              onClick={() => setDownloadBackup(b)}
              size="sm"
              title="Download as .cube archive"
              variant="ghost"
            >
              <DownloadIcon className="size-4" />
              Download
            </Button>
          )}
          {canCreate && b.status === "complete" && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/${spaceId}/backups/${b.id}/redeploy`}>
                <CubeIcon className="size-4" />
                Redeploy
              </Link>
            </Button>
          )}
          {canManage && (b.status === "complete" || b.status === "failed") && (
            <Button
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setDeleteTarget(b);
                setConfirmName("");
              }}
              size="sm"
              variant="ghost"
            >
              <TrashIcon className="size-4" />
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable<BackupItem>
        columns={columns}
        data={filtered}
        emptyDescription="Create a backup of a Cube and it will appear here."
        emptyTitle="No backups"
        pageSize={10}
        rowKey={(b) => b.id}
        searchAccessor={(b) =>
          `${b.name} ${b.originalCubeName} ${b.config.regionName}`
        }
        searchPlaceholder="Search backups…"
        toolbarRight={
          <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5 text-xs">
            {(
              [
                ["all", "All"],
                ["complete", "Complete"],
                ["creating", "Creating"],
                ["failed", "Failed"],
              ] as const
            ).map(([value, label]) => (
              <button
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition",
                  statusFilter === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={value}
                onClick={() =>
                  setStatusFilter(value as BackupItem["status"] | "all")
                }
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {downloadBackup && (
        <BackupDownloadSheet
          backupId={downloadBackup.id}
          backupName={downloadBackup.name}
          onOpenChange={(open) => {
            if (!open) {
              setDownloadBackup(null);
            }
          }}
          open={!!downloadBackup}
          spaceId={spaceId}
        />
      )}

      <ConfirmDestructiveDialog
        busy={isPending}
        confirmLabel="Delete Backup"
        confirmText={deleteTarget?.name ?? ""}
        confirmValue={confirmName}
        description={
          <p>
            This will permanently delete this backup and its stored data. This
            action cannot be undone. Type{" "}
            <strong className="text-foreground">{deleteTarget?.name}</strong> to
            confirm.
          </p>
        }
        onConfirm={handleDelete}
        onConfirmValueChange={setConfirmName}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setConfirmName("");
          }
        }}
        open={!!deleteTarget}
        title="Delete Backup"
      />
    </>
  );
}
