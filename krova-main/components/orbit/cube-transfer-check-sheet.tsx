"use client";

import {
  ArrowRightIcon,
  CaretDownIcon,
  CheckCircleIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { Fragment, useState, useTransition } from "react";
import useSWR from "swr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { fetcher } from "@/lib/fetcher";

interface TransferTarget {
  capacity: {
    cpu: { allocated: number; max: number };
    ram: { allocated: number; max: number };
    disk: { allocated: number; max: number };
  };
  id: string;
  name: string;
  region: string;
}

interface CheckResult {
  checks: {
    serverReady: {
      ok: boolean;
      status: string;
      setupPhase: string;
      sameRegion: boolean;
    };
    capacity: {
      ok: boolean;
      cpu: { needed: number; available: number; max: number };
      ram: { needed: number; available: number; max: number };
      disk: { needed: number; available: number; max: number };
    };
    ports: {
      conflictCount: number;
      mappings: Array<{
        purpose: "ssh" | "tcp";
        currentPort: number;
        cubePort: number;
        conflict: boolean;
        resolvedPort: number;
      }>;
    };
    domains: {
      conflictCount: number;
      verified: Array<{
        domain: string;
        cubePort: number | null;
        conflict: boolean;
      }>;
    };
  };
  destinationServer: { id: string; name: string; publicIp: string };
}

interface CubeProps {
  id: string;
  name: string;
}

export function CubeTransferCheckSheet({
  cube,
  open,
  onOpenChange,
}: {
  cube: CubeProps;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [, startTransition] = useTransition();
  const [checkUrl, setCheckUrl] = useState<string | null>(null);

  const { data: targets, isLoading: targetsLoading } = useSWR<{
    servers: TransferTarget[];
  }>(open ? `/api/orbit/cubes/${cube.id}/transfer-targets` : null, fetcher);

  const {
    data: result,
    isLoading: checking,
    error: checkError,
  } = useSWR<CheckResult>(checkUrl, fetcher);

  const serverList = targets?.servers ?? [];
  const selected = serverList.find((s) => s.id === selectedId);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSelectedId("");
      setCheckUrl(null);
    }
    onOpenChange(next);
  }

  function runCheck() {
    if (!selectedId) {
      return;
    }
    startTransition(() => {
      setCheckUrl(
        `/api/orbit/cubes/${cube.id}/transfer-check?destinationServerId=${selectedId}`
      );
    });
  }

  const canRunCheck = !!selectedId && !checking;
  const hasResult = !!result && !checking;

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Transfer compatibility check</SheetTitle>
          <SheetDescription>
            Analyse what would happen if <strong>{cube.name}</strong> were
            transferred to another server. No changes are made.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          {/* Server selector */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Destination server</p>
            {targetsLoading ? (
              <Button
                className="w-full justify-between font-normal"
                disabled
                type="button"
                variant="outline"
              >
                <span className="flex items-center gap-2">
                  <Spinner className="size-3" />
                  Loading servers…
                </span>
              </Button>
            ) : serverList.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                No eligible servers in this region.
              </div>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="w-full justify-between font-normal"
                    type="button"
                    variant="outline"
                  >
                    <span className="truncate">
                      {selected ? selected.name : "Choose a server"}
                    </span>
                    <CaretDownIcon className="size-4 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                  <DropdownMenuRadioGroup
                    onValueChange={(v) => {
                      setSelectedId(v);
                      setCheckUrl(null);
                    }}
                    value={selectedId}
                  >
                    {serverList.map((s) => (
                      <Fragment key={s.id}>
                        <DropdownMenuRadioItem
                          className="flex flex-col items-start gap-1 py-2"
                          value={s.id}
                        >
                          <span className="font-medium">{s.name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            CPU {s.capacity.cpu.allocated}/{s.capacity.cpu.max}{" "}
                            · RAM {(s.capacity.ram.allocated / 1024).toFixed(1)}
                            /{(s.capacity.ram.max / 1024).toFixed(1)} GB · Disk{" "}
                            {s.capacity.disk.allocated}/{s.capacity.disk.max} GB
                          </span>
                        </DropdownMenuRadioItem>
                      </Fragment>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <Button
            className="w-full"
            disabled={!canRunCheck}
            onClick={runCheck}
            type="button"
          >
            {checking && <Spinner className="size-4" />}
            {checking ? "Analysing…" : "Run check"}
          </Button>

          {checkError && (
            <Alert variant="destructive">
              <AlertDescription>
                {checkError instanceof Error
                  ? checkError.message
                  : "Check failed — try again"}
              </AlertDescription>
            </Alert>
          )}

          {/* Results */}
          {hasResult && <CheckResults result={result} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CheckResults({ result }: { result: CheckResult }) {
  const { serverReady, capacity, ports, domains } = result.checks;
  const overallOk =
    serverReady.ok && capacity.ok && domains.conflictCount === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b pb-2">
        {overallOk ? (
          <CheckCircleIcon className="size-5 text-green-500" weight="fill" />
        ) : (
          <XCircleIcon className="size-5 text-destructive" weight="fill" />
        )}
        <span className="text-sm font-medium">
          {overallOk
            ? "Transfer can proceed"
            : "Issues must be resolved before transferring"}
        </span>
      </div>

      {/* Server readiness */}
      <CheckRow
        detail={
          serverReady.ok ? (
            <span className="text-muted-foreground">Active and ready</span>
          ) : (
            <ul className="space-y-0.5 text-muted-foreground">
              {!serverReady.sameRegion && <li>Different region</li>}
              {serverReady.status !== "active" && (
                <li>Status: {serverReady.status}</li>
              )}
              {serverReady.setupPhase !== "ready" && (
                <li>Setup phase: {serverReady.setupPhase}</li>
              )}
            </ul>
          )
        }
        label="Server readiness"
        ok={serverReady.ok}
      />

      {/* Capacity */}
      <CheckRow
        detail={
          <div className="space-y-1 text-xs text-muted-foreground tabular-nums">
            <CapacityLine
              available={capacity.cpu.available}
              label="CPU"
              needed={capacity.cpu.needed}
              unit="vCPU"
            />
            <CapacityLine
              available={capacity.ram.available}
              label="RAM"
              needed={capacity.ram.needed}
              unit="MB"
            />
            <CapacityLine
              available={capacity.disk.available}
              label="Disk"
              needed={capacity.disk.needed}
              unit="GB"
            />
          </div>
        }
        label="Capacity"
        ok={capacity.ok}
      />

      {/* Ports */}
      <CheckRow
        badge={
          ports.conflictCount > 0
            ? `${ports.conflictCount} conflict${ports.conflictCount > 1 ? "s" : ""} — auto-reassigned`
            : ports.mappings.length === 0
              ? "No port mappings"
              : "No conflicts"
        }
        detail={
          ports.mappings.length === 0 ? null : (
            <div className="space-y-1">
              {ports.mappings.map((m) => (
                <div
                  className="flex items-center gap-2 text-xs"
                  key={`${m.purpose}-${m.currentPort}`}
                >
                  <Badge className="shrink-0 text-[10px]" variant="outline">
                    {m.purpose.toUpperCase()}
                  </Badge>
                  {m.conflict ? (
                    <>
                      <span className="text-muted-foreground tabular-nums line-through">
                        :{m.currentPort}
                      </span>
                      <ArrowRightIcon className="size-3 text-muted-foreground" />
                      <span className="font-medium text-amber-600 tabular-nums dark:text-amber-400">
                        :{m.resolvedPort}
                      </span>
                      <span className="text-muted-foreground">
                        → cube:{m.cubePort}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground tabular-nums">
                      :{m.currentPort} → cube:{m.cubePort}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )
        }
        label="TCP / SSH ports"
        ok={true}
        warn={ports.conflictCount > 0}
      />

      {/* Domains */}
      <CheckRow
        badge={
          domains.verified.length === 0
            ? "No custom domains"
            : domains.conflictCount > 0
              ? `${domains.conflictCount} conflict${domains.conflictCount > 1 ? "s" : ""}`
              : undefined
        }
        detail={
          domains.verified.length === 0 ? null : (
            <div className="space-y-2">
              {domains.conflictCount > 0 && (
                <p className="text-xs text-destructive">
                  The following domains are already routed on the destination
                  server by another cube — remove them before transferring.
                </p>
              )}
              <div className="space-y-1">
                {domains.verified
                  .filter((d) => d.conflict)
                  .map((d) => (
                    <div
                      className="flex items-start gap-2 text-xs"
                      key={d.domain}
                    >
                      <XCircleIcon
                        className="mt-0.5 size-3.5 shrink-0 text-destructive"
                        weight="fill"
                      />
                      <span className="text-destructive">{d.domain}</span>
                    </div>
                  ))}
                {domains.conflictCount === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {domains.verified.length} verified domain
                    {domains.verified.length > 1 ? "s" : ""} — no conflicts on
                    destination
                  </p>
                )}
              </div>
            </div>
          )
        }
        label="Custom domains"
        ok={domains.conflictCount === 0}
      />
    </div>
  );
}

function CheckRow({
  ok,
  warn,
  label,
  badge,
  detail,
}: {
  ok: boolean;
  warn?: boolean;
  label: string;
  badge?: string;
  detail: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        {ok && !warn ? (
          <CheckCircleIcon
            className="size-4 shrink-0 text-green-500"
            weight="fill"
          />
        ) : warn ? (
          <WarningIcon
            className="size-4 shrink-0 text-amber-500"
            weight="fill"
          />
        ) : (
          <XCircleIcon
            className="size-4 shrink-0 text-destructive"
            weight="fill"
          />
        )}
        <span className="text-sm font-medium">{label}</span>
        {badge && (
          <Badge
            className="ml-auto text-[10px]"
            variant={ok ? (warn ? "outline" : "secondary") : "destructive"}
          >
            {badge}
          </Badge>
        )}
      </div>
      {detail && <div className="pl-6">{detail}</div>}
    </div>
  );
}

function CapacityLine({
  label,
  needed,
  available,
  unit,
}: {
  label: string;
  needed: number;
  available: number;
  unit: string;
}) {
  const ok = needed <= available;
  return (
    <div className="flex items-center gap-2">
      <span className="w-8">{label}</span>
      <span className={ok ? "text-foreground" : "font-medium text-destructive"}>
        needs {needed} {unit}
      </span>
      <span>·</span>
      <span className={ok ? "" : "text-destructive"}>
        {available} {unit} free
      </span>
    </div>
  );
}
