"use client";

import {
  CaretDownIcon,
  CheckIcon,
  PlugIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { CubeStatusBadge } from "@/components/cube-status-badge";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import type { CubeStatusValue } from "@/db/schema/types";
import { cn } from "@/lib/utils";

interface PortRow {
  cubeId: string | null;
  cubeName: string | null;
  cubeStatus: CubeStatusValue | null;
  id: string;
  port: number;
  purpose: string;
  serverHostname: string;
  serverId: string;
  spaceName: string | null;
  status: string;
  tcpMappingStatus: string | null;
}

interface ServerSummary {
  allocated: number;
  available: number;
  reserved: number;
  serverHostname: string;
  serverId: string;
  total: number;
}

const purposeStyles: Record<string, string> = {
  SSH: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  Allocated: "bg-gray-500/10 text-gray-600 dark:text-gray-400",
};

export function PortsTable({
  ports,
  serverSummaries,
}: {
  ports: PortRow[];
  serverSummaries: ServerSummary[];
}) {
  const router2 = useRouter();
  const [freeTarget, setFreeTarget] = useState<PortRow | null>(null);
  const [freeingId, setFreeingId] = useState<string | null>(null);
  const [, startFreeTransition] = useTransition();

  function handleConfirmFree() {
    if (!freeTarget) {
      return;
    }
    const target = freeTarget;
    setFreeingId(target.id);
    setFreeTarget(null);
    startFreeTransition(async () => {
      try {
        const res = await fetch(`/api/orbit/ports/${target.id}`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? "Failed to free port");
          return;
        }
        toast.success(`Port ${target.port} freed`);
        router2.refresh();
      } finally {
        setFreeingId(null);
      }
    });
  }
  const router = useRouter();
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [purposeFilter, setPurposeFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const serverNames = [...new Set(ports.map((p) => p.serverHostname))].sort();

  const filtered = ports
    .filter((p) => serverFilter === "all" || p.serverHostname === serverFilter)
    .filter((p) => {
      if (purposeFilter === "all") {
        return true;
      }
      if (purposeFilter === "ssh") {
        return p.purpose === "SSH";
      }
      if (purposeFilter === "tcp") {
        return p.purpose.startsWith("TCP:");
      }
      if (purposeFilter === "other") {
        return p.purpose === "Allocated";
      }
      return true;
    })
    .sort((a, b) => a.port - b.port);

  // Reset to page 1 when filters/pageSize change
  const resetKey = `${serverFilter}|${purposeFilter}|${pageSize}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setPage(1);
  }

  const pageWindow = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  return (
    <div className="space-y-6">
      {/* Pool capacity — explicitly grouped section with its own header so
          the chips read as a coherent block rather than floating above the
          filters. Capacity warnings (red/amber) call out servers that are
          nearing pool exhaustion. */}
      {serverSummaries.length > 0 && (
        <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Pool capacity</h2>
              <p className="text-xs text-muted-foreground">
                TCP host-port allocation per server. The platform allocates host
                ports from each server&apos;s configured range.
              </p>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {serverSummaries.length}{" "}
              {serverSummaries.length === 1 ? "server" : "servers"}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {serverSummaries.map((s) => {
              const used = s.allocated + s.reserved;
              const usedPct =
                s.total > 0 ? Math.round((used / s.total) * 100) : 0;
              const warn =
                usedPct > 90 ? "danger" : usedPct > 70 ? "warn" : null;
              return (
                <div
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2",
                    warn === "danger" && "border-red-500/30 bg-red-500/5",
                    warn === "warn" && "border-amber-500/30 bg-amber-500/5"
                  )}
                  key={s.serverId}
                  title={
                    warn === "danger"
                      ? "Near capacity — new TCP allocations will start failing"
                      : warn === "warn"
                        ? "More than 70% of host-port pool used"
                        : undefined
                  }
                >
                  <div className="min-w-0 space-y-1">
                    <span className="block truncate text-sm font-medium">
                      {s.serverHostname}
                    </span>
                    <Progress
                      className={cn(
                        "h-1.5 w-full max-w-32",
                        warn === "danger"
                          ? "*:data-[slot=progress-indicator]:bg-red-500"
                          : warn === "warn"
                            ? "*:data-[slot=progress-indicator]:bg-yellow-500"
                            : ""
                      )}
                      value={usedPct}
                    />
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-xs tabular-nums",
                      warn === "danger"
                        ? "text-red-700 dark:text-red-400"
                        : warn === "warn"
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-muted-foreground"
                    )}
                  >
                    {used}/{s.total}
                    <span className="ml-1">({usedPct}%)</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="h-8 w-36 justify-between text-xs font-normal"
              type="button"
              variant="outline"
            >
              {serverFilter === "all" ? "All servers" : serverFilter}
              <CaretDownIcon className="size-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-36">
            <DropdownMenuItem onClick={() => setServerFilter("all")}>
              <span>All servers</span>
              {serverFilter === "all" && (
                <CheckIcon className="ml-auto size-4" />
              )}
            </DropdownMenuItem>
            {serverNames.map((name) => (
              <DropdownMenuItem
                key={name}
                onClick={() => setServerFilter(name)}
              >
                <span>{name}</span>
                {serverFilter === name && (
                  <CheckIcon className="ml-auto size-4" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="h-8 w-36 justify-between text-xs font-normal"
              type="button"
              variant="outline"
            >
              {purposeFilter === "all"
                ? "All purposes"
                : purposeFilter === "ssh"
                  ? "SSH"
                  : purposeFilter === "tcp"
                    ? "TCP Mappings"
                    : "Other"}
              <CaretDownIcon className="size-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-36">
            {[
              { value: "all", label: "All purposes" },
              { value: "ssh", label: "SSH" },
              { value: "tcp", label: "TCP Mappings" },
              { value: "other", label: "Other" },
            ].map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onClick={() => setPurposeFilter(opt.value)}
              >
                <span>{opt.label}</span>
                {purposeFilter === opt.value && (
                  <CheckIcon className="ml-auto size-4" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-xs text-muted-foreground tabular-nums">
          {filtered.length} port{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyMedia>
            <PlugIcon className="size-8" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No allocated ports</EmptyTitle>
            <EmptyDescription>
              {serverFilter !== "all" || purposeFilter !== "all"
                ? "Try adjusting your filters."
                : "No ports have been allocated yet."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host Port</TableHead>
                <TableHead>Server</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Cube</TableHead>
                <TableHead>Space</TableHead>
                <TableHead>Cube Status</TableHead>
                <TableHead>Port Status</TableHead>
                <TableHead className="w-20 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageWindow.map((p) => (
                <TableRow
                  className={p.cubeId ? "cursor-pointer" : undefined}
                  key={p.id}
                  onClick={
                    p.cubeId
                      ? () => router.push(`/orbit/cubes/${p.cubeId}`)
                      : undefined
                  }
                >
                  <TableCell className="font-mono text-sm font-medium">
                    {p.port}
                  </TableCell>
                  <TableCell className="text-sm">{p.serverHostname}</TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        "border-0 text-xs",
                        p.purpose === "SSH"
                          ? purposeStyles.SSH
                          : p.purpose.startsWith("TCP:")
                            ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                            : purposeStyles.Allocated
                      )}
                      variant="secondary"
                    >
                      {p.purpose}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.cubeName ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.spaceName ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {p.cubeStatus ? (
                      <CubeStatusBadge status={p.cubeStatus} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        "border-0 text-xs",
                        p.status === "allocated"
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                      )}
                      variant="secondary"
                    >
                      {p.status}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!p.cubeId && (
                      <Button
                        aria-label="Free orphaned port"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={freeingId === p.id}
                        onClick={() => setFreeTarget(p)}
                        size="icon-sm"
                        title="Free orphaned port allocation"
                        variant="ghost"
                      >
                        {freeingId === p.id ? (
                          <Spinner className="size-3.5" />
                        ) : (
                          <TrashIcon className="size-3.5" />
                        )}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t p-2">
            <TablePagination
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              page={page}
              pageSize={pageSize}
              total={filtered.length}
            />
          </div>
        </div>
      )}

      <ConfirmActionDialog
        confirmLabel="Free port"
        description={
          <p>
            Removes the allocation row for port{" "}
            <span className="font-mono text-foreground">
              {freeTarget?.port}
            </span>{" "}
            on{" "}
            <strong className="text-foreground">
              {freeTarget?.serverHostname}
            </strong>
            . The port will become available for future allocations. Safe only
            when the owning cube is already gone — the API will refuse if the
            port still references a non-deleted cube.
          </p>
        }
        onConfirm={handleConfirmFree}
        onOpenChange={(open) => {
          if (!open) {
            setFreeTarget(null);
          }
        }}
        open={!!freeTarget}
        title="Free orphaned port?"
      />
    </div>
  );
}
