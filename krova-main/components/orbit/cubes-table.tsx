"use client";

import { ArrowUpRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { CubeStatusBadge } from "@/components/cube-status-badge";
import { FilterDropdown } from "@/components/filter-dropdown";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Spinner } from "@/components/ui/spinner";
import type { CubeStatusValue } from "@/db/schema/types";
import { useMutation } from "@/hooks/use-mutation";
import {
  CUBE_STATUS_FILTER_OPTIONS,
  isActiveTransferState,
} from "@/lib/status-display";

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
  transferState?: string | null;
  vcpus: number;
}

interface ServerOption {
  hostname: string;
  id: string;
}

export function CubesTable({
  cubes,
  servers,
  hideSpaceColumn = false,
}: {
  cubes: CubeRow[];
  servers: ServerOption[];
  /**
   * Hide the Space column AND the Space filter — used when the table is
   * already scoped to a single space (e.g. the Orbit space-detail Cubes tab),
   * where every row belongs to the same space so cross-space actions are
   * structurally impossible.
   */
  hideSpaceColumn?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status");
  const [statusFilter, setStatusFilter] = useState<string>(
    initialStatus &&
      CUBE_STATUS_FILTER_OPTIONS.some((o) => o.value === initialStatus)
      ? initialStatus
      : "all"
  );
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [regionFilter, setRegionFilter] = useState<string>("all");
  const [spaceFilter, setSpaceFilter] = useState<string>("all");
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{
    kind: "sleep" | "wake" | "delete" | "purge" | "cancel-transfer";
    cube: { id: string; name: string };
  } | null>(null);
  const { trigger } = useMutation();

  const filtered = cubes.filter((cube) => {
    if (statusFilter !== "all" && cube.status !== statusFilter) {
      return false;
    }
    if (serverFilter !== "all" && cube.serverId !== serverFilter) {
      return false;
    }
    if (regionFilter !== "all" && cube.regionName !== regionFilter) {
      return false;
    }
    if (spaceFilter !== "all" && cube.spaceId !== spaceFilter) {
      return false;
    }
    return true;
  });

  async function handleForceSleep(cubeId: string, cubeName: string) {
    setActionTarget(`sleep-${cubeId}`);
    await trigger({
      url: `/api/orbit/cubes/${cubeId}/force-stop`,
      method: "POST",
      successMessage: `Force-slept ${cubeName}`,
      errorMessage: "Failed to force sleep",
    });
    setActionTarget(null);
  }

  async function handleForceWake(cubeId: string, cubeName: string) {
    setActionTarget(`wake-${cubeId}`);
    await trigger({
      url: `/api/orbit/cubes/${cubeId}/wake`,
      method: "POST",
      successMessage: `Started ${cubeName}`,
      errorMessage: "Failed to start",
    });
    setActionTarget(null);
  }

  async function handleForceDelete(cubeId: string, cubeName: string) {
    setActionTarget(`delete-${cubeId}`);
    await trigger({
      url: `/api/orbit/cubes/${cubeId}/force-delete`,
      method: "POST",
      successMessage: `Force-deleted ${cubeName}`,
      errorMessage: "Failed to force delete",
    });
    setActionTarget(null);
  }

  async function handleCancelTransfer(cubeId: string, cubeName: string) {
    setActionTarget(`cancel-transfer-${cubeId}`);
    await trigger({
      url: `/api/orbit/cubes/${cubeId}/transfer/cancel`,
      method: "POST",
      successMessage: `Transfer cancellation requested for ${cubeName}`,
      errorMessage: "Failed to cancel transfer",
    });
    setActionTarget(null);
  }

  async function handlePurge(cubeId: string, cubeName: string) {
    setActionTarget(`purge-${cubeId}`);
    await trigger({
      url: `/api/orbit/cubes/${cubeId}/purge`,
      method: "POST",
      successMessage: `Permanently purged ${cubeName}`,
      errorMessage: "Failed to purge",
    });
    setActionTarget(null);
  }

  const uniqueRegions = [
    ...new Set(cubes.map((k) => k.regionName).filter(Boolean)),
  ];

  const serverOptions = [
    { value: "all", label: "All servers" },
    ...servers.map((s) => ({ value: s.id, label: s.hostname })),
  ];

  const regionOptions = [
    { value: "all", label: "All regions" },
    ...uniqueRegions.map((name) => ({ value: name, label: name })),
  ];

  // Distinct spaces present in the data, for the Space filter (platform-wide
  // list only — omitted when hideSpaceColumn is set).
  const spaceOptions = [
    { value: "all", label: "All spaces" },
    ...[...new Map(cubes.map((c) => [c.spaceId, c.spaceName])).entries()].map(
      ([id, name]) => ({ value: id, label: name })
    ),
  ];

  const hasActiveFilters =
    statusFilter !== "all" ||
    serverFilter !== "all" ||
    regionFilter !== "all" ||
    spaceFilter !== "all";

  const confirmKind = confirmTarget?.kind;
  const confirmCube = confirmTarget?.cube;
  let confirmTitle: string;
  let confirmDescription: React.ReactNode;
  let confirmLabel: string;
  let confirmDestructive: boolean;
  switch (confirmKind) {
    case "sleep":
      confirmTitle = "Force sleep Cube?";
      confirmDescription = (
        <p>
          This will immediately put <strong>{confirmCube?.name}</strong> to
          sleep without graceful shutdown.
        </p>
      );
      confirmLabel = "Force Sleep";
      confirmDestructive = false;
      break;
    case "wake":
      confirmTitle = "Start Cube?";
      confirmDescription = (
        <p>
          This will wake <strong>{confirmCube?.name}</strong> and resume hourly
          billing. The space's plan limits and credit balance are NOT checked
          (admin override) — a zero-balance Cube will be auto-slept again on the
          next billing tick.
        </p>
      );
      confirmLabel = "Start";
      confirmDestructive = false;
      break;
    case "delete":
      confirmTitle = "Force delete Cube?";
      confirmDescription = (
        <p>
          This will permanently destroy <strong>{confirmCube?.name}</strong> and
          remove all associated data. This cannot be undone.
        </p>
      );
      confirmLabel = "Force Delete";
      confirmDestructive = true;
      break;
    case "purge":
      confirmTitle = "Permanently purge Cube?";
      confirmDescription = (
        <p>
          Hard-deletes the row for <strong>{confirmCube?.name}</strong> and
          erases all associated lifecycle, audit, and job logs. Billing events
          and backup records are preserved (cube reference set to NULL). Use
          this only when you no longer need the forensic trail. This cannot be
          undone.
        </p>
      );
      confirmLabel = "Purge Permanently";
      confirmDestructive = true;
      break;
    case "cancel-transfer":
      confirmTitle = "Cancel transfer?";
      confirmDescription = (
        <p>
          This aborts the in-progress transfer of{" "}
          <strong>{confirmCube?.name}</strong> and cleans up partial state on
          the destination server. If the source was paused for cutover it is
          woken automatically; the transfer state resets to <code>failed</code>{" "}
          so you can retry.
        </p>
      );
      confirmLabel = "Cancel Transfer";
      confirmDestructive = true;
      break;
    default:
      confirmTitle = "";
      confirmDescription = null;
      confirmLabel = "Confirm";
      confirmDestructive = true;
  }

  function handleConfirm() {
    if (!confirmTarget) {
      return;
    }
    const { kind, cube } = confirmTarget;
    setConfirmTarget(null);
    if (kind === "sleep") {
      void handleForceSleep(cube.id, cube.name);
    } else if (kind === "wake") {
      void handleForceWake(cube.id, cube.name);
    } else if (kind === "cancel-transfer") {
      void handleCancelTransfer(cube.id, cube.name);
    } else if (kind === "delete") {
      void handleForceDelete(cube.id, cube.name);
    } else {
      void handlePurge(cube.id, cube.name);
    }
  }

  return (
    <>
      <ConfirmActionDialog
        confirmLabel={confirmLabel}
        description={confirmDescription}
        destructive={confirmDestructive}
        onConfirm={handleConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmTarget(null);
          }
        }}
        open={confirmTarget !== null}
        title={confirmTitle}
      />
      <DataTable
        columns={[
          {
            id: "name",
            header: "Name",
            className: "font-medium",
            cell: (cube) => (
              <Link
                className="group inline-flex items-center gap-1 decoration-foreground/40 decoration-1 underline-offset-4 hover:underline"
                href={`/orbit/cubes/${cube.id}`}
                onClick={(e) => e.stopPropagation()}
              >
                {cube.name}
                <ArrowUpRightIcon
                  className="size-3 -translate-x-0.5 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-50"
                  weight="bold"
                />
              </Link>
            ),
          },
          ...(hideSpaceColumn
            ? []
            : [
                {
                  id: "space",
                  header: "Space",
                  className: "text-muted-foreground",
                  cell: (cube: CubeRow) => cube.spaceName,
                },
              ]),
          {
            id: "server",
            header: "Server",
            className: "text-muted-foreground",
            cell: (cube) => cube.serverHostname,
          },
          {
            id: "status",
            header: "Status",
            cell: (cube) => (
              <CubeStatusBadge
                status={cube.status}
                transferState={cube.transferState}
              />
            ),
          },
          {
            id: "size",
            header: "vCPU / RAM",
            cell: (cube) => `${cube.vcpus} vCPU / ${cube.ramMb} MB`,
          },
          {
            id: "region",
            header: "Region",
            className: "text-muted-foreground",
            cell: (cube) => cube.regionName,
          },
          {
            id: "actions",
            header: "Actions",
            cell: (cube) => {
              // During an active cross-server transfer the cube keeps its
              // running/sleeping status, but Sleep/Start/Delete would all
              // disrupt the in-flight rootfs copy — hide them and offer only
              // Cancel Transfer (the admin escape hatch).
              const transferActive = isActiveTransferState(cube.transferState);
              const transferCancelling = cube.transferState === "cancelling";
              const canStop = !transferActive && cube.status === "running";
              const canWake = !transferActive && cube.status === "sleeping";
              const canDelete = !transferActive && cube.status !== "deleted";
              const canPurge = cube.status === "deleted";
              return (
                // biome-ignore lint/a11y/noNoninteractiveElementInteractions: stop row-click propagation so buttons don't trigger the table-row navigation
                // biome-ignore lint/a11y/useSemanticElements: <fieldset> would introduce form semantics we don't want; a plain div wrapper is correct here
                <div
                  aria-label="Cube actions"
                  className="flex gap-1"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="group"
                >
                  {transferActive && (
                    <Button
                      disabled={
                        transferCancelling ||
                        actionTarget === `cancel-transfer-${cube.id}`
                      }
                      onClick={() =>
                        setConfirmTarget({
                          kind: "cancel-transfer",
                          cube: { id: cube.id, name: cube.name },
                        })
                      }
                      size="xs"
                      variant="destructive"
                    >
                      {(transferCancelling ||
                        actionTarget === `cancel-transfer-${cube.id}`) && (
                        <Spinner className="size-3" />
                      )}
                      {transferCancelling ? "Cancelling…" : "Cancel transfer"}
                    </Button>
                  )}
                  {canStop && (
                    <Button
                      disabled={actionTarget === `sleep-${cube.id}`}
                      onClick={() =>
                        setConfirmTarget({
                          kind: "sleep",
                          cube: { id: cube.id, name: cube.name },
                        })
                      }
                      size="xs"
                      variant="outline"
                    >
                      {actionTarget === `sleep-${cube.id}` && (
                        <Spinner className="size-3" />
                      )}
                      Sleep
                    </Button>
                  )}
                  {canWake && (
                    <Button
                      disabled={actionTarget === `wake-${cube.id}`}
                      onClick={() =>
                        setConfirmTarget({
                          kind: "wake",
                          cube: { id: cube.id, name: cube.name },
                        })
                      }
                      size="xs"
                      variant="outline"
                    >
                      {actionTarget === `wake-${cube.id}` && (
                        <Spinner className="size-3" />
                      )}
                      Start
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      disabled={actionTarget === `delete-${cube.id}`}
                      onClick={() =>
                        setConfirmTarget({
                          kind: "delete",
                          cube: { id: cube.id, name: cube.name },
                        })
                      }
                      size="xs"
                      variant="destructive"
                    >
                      {actionTarget === `delete-${cube.id}` && (
                        <Spinner className="size-3" />
                      )}
                      Delete
                    </Button>
                  )}
                  {canPurge && (
                    <Button
                      disabled={actionTarget === `purge-${cube.id}`}
                      onClick={() =>
                        setConfirmTarget({
                          kind: "purge",
                          cube: { id: cube.id, name: cube.name },
                        })
                      }
                      size="xs"
                      variant="destructive"
                    >
                      {actionTarget === `purge-${cube.id}` && (
                        <Spinner className="size-3" />
                      )}
                      Purge
                    </Button>
                  )}
                </div>
              );
            },
          },
        ]}
        data={filtered}
        emptyDescription={
          hasActiveFilters
            ? "Try adjusting your filters."
            : "No Cubes exist on the platform yet."
        }
        emptyTitle="No Cubes found"
        onRowClick={(cube) => router.push(`/orbit/cubes/${cube.id}`)}
        rowKey={(cube) => cube.id}
        searchAccessor={(cube) =>
          `${cube.name} ${cube.spaceName} ${cube.serverHostname} ${cube.regionName}`
        }
        searchPlaceholder="Search cubes..."
        toolbarRight={
          <>
            <FilterDropdown
              label="Status"
              onChange={setStatusFilter}
              options={CUBE_STATUS_FILTER_OPTIONS}
              value={statusFilter}
            />
            {!hideSpaceColumn && (
              <FilterDropdown
                className="w-45"
                label="Space"
                onChange={setSpaceFilter}
                options={spaceOptions}
                value={spaceFilter}
              />
            )}
            <FilterDropdown
              className="w-45"
              label="Server"
              onChange={setServerFilter}
              options={serverOptions}
              value={serverFilter}
            />
            <FilterDropdown
              label="Region"
              onChange={setRegionFilter}
              options={regionOptions}
              value={regionFilter}
            />
          </>
        }
      />
    </>
  );
}
