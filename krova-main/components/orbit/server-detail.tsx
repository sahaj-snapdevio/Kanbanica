"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { CubeStatusBadge } from "@/components/cube-status-badge";
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
import {
  DescriptionList,
  DescriptionListItem,
} from "@/components/ui/description-list";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  SheetTrigger,
} from "@/components/ui/sheet";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsageBar } from "@/components/usage-bar";
import type { CubeStatusValue } from "@/db/schema/types";
import { useMutation } from "@/hooks/use-mutation";
import { useTabParam } from "@/hooks/use-tab-param";
import { serverCpuRamCapacity } from "@/lib/server/cpu-ram-capacity";
import { serverConnectDomain } from "@/lib/server/server-hostnames";
import { SERVER_STATUS_CLASSES, type ServerStatus } from "@/lib/status-display";
import { cn } from "@/lib/utils";

interface RegionOption {
  id: string;
  name: string;
}

interface SshKeyOption {
  id: string;
  name: string;
}

interface ServerProps {
  allocatedCpus: number;
  allocatedDiskGb: number;
  allocatedRamMb: number;
  createdAt: Date;
  diskMeasuredAt: Date | null;
  hostname: string;
  id: string;
  maxCpuOvercommit: number;
  maxRamOvercommit: number;
  overheadDiskGb: number;
  publicIp: string;
  regionId: string | null;
  regionName: string;
  sshKeyId: string;
  sshPort: number;
  status: ServerStatus;
  totalCpus: number;
  totalDiskGb: number;
  totalRamMb: number;
}

interface CubeRow {
  createdAt: Date;
  diskLimitGb: number;
  id: string;
  name: string;
  ramMb: number;
  spaceName: string;
  status: CubeStatusValue;
  transferState?: string | null;
  vcpus: number;
}

const TAB_VALUES = [
  "overview",
  "cubes",
  "logs",
  "settings",
  "setup",
  "danger",
] as const;

export function ServerDetail({
  server,
  cubes,
  setupSlot,
  activitySlot,
  defaultTab = "overview",
}: {
  server: ServerProps;
  cubes: CubeRow[];
  /** Initial open tab — the page opens "setup" for a not-yet-ready server. */
  defaultTab?: string;
  /**
   * Server-rendered pieces composed by the page and slotted into tabs:
   * the phased-setup card (pre-ready) and the always-on job-log Activity
   * stream. Passing them as nodes keeps their server-side data fetching in
   * the page while this client shell owns the tab layout.
   */
  setupSlot?: React.ReactNode;
  activitySlot?: React.ReactNode;
}) {
  const router = useRouter();
  // `defaultTab` (e.g. "setup" for a not-yet-ready server) is the fallback when
  // the URL carries no `?tab=` — a deep-linked / refreshed tab still wins.
  const tabParam = useTabParam(TAB_VALUES, defaultTab);
  const [cpuOvercommit, setCpuOvercommit] = useState(
    String(server.maxCpuOvercommit)
  );
  const [ramOvercommit, setRamOvercommit] = useState(
    String(server.maxRamOvercommit)
  );
  const { trigger: triggerToggle, isMutating: togglingStatus } = useMutation();
  const { trigger: triggerOvercommit, isMutating: savingOvercommit } =
    useMutation();
  // Skip the hook's default refresh on this page — see space-detail.tsx
  // for the rationale (avoids 404 flash before the push).
  const { trigger: triggerDelete, isMutating: deleting } = useMutation({
    revalidate: false,
    onSuccess: () => {
      router.push("/orbit/servers");
      router.refresh();
    },
  });

  // Pagination state for the cubes-on-server table.
  const [cubesPage, setCubesPage] = useState(1);
  const [cubesPageSize, setCubesPageSize] = useState(10);
  const cubesPageWindow = useMemo(() => {
    const start = (cubesPage - 1) * cubesPageSize;
    return cubes.slice(start, start + cubesPageSize);
  }, [cubes, cubesPage, cubesPageSize]);
  const [prevCubesPageSize, setPrevCubesPageSize] = useState(cubesPageSize);
  if (prevCubesPageSize !== cubesPageSize) {
    setPrevCubesPageSize(cubesPageSize);
    setCubesPage(1);
  }

  // Live logs state
  const [logsConnected, setLogsConnected] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const { maxCpu: effectiveCpu, maxRam: effectiveRam } =
    serverCpuRamCapacity(server);

  // Auto-scroll log container
  // biome-ignore lint/correctness/useExhaustiveDependencies: logLines is the intended trigger for auto-scroll on stream updates
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logLines]);

  const connectLogs = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setLogsError(null);
    setLogLines([]);
    setLogsConnected(true);

    const es = new EventSource(`/api/orbit/servers/${server.id}/logs`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          setLogsError(data.error);
          setLogsConnected(false);
          es.close();
        } else if (data.line) {
          setLogLines((prev) => {
            const next = [...prev, data.line];
            // Keep last 2000 lines to prevent memory issues
            return next.length > 2000 ? next.slice(-2000) : next;
          });
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setLogsConnected(false);
      es.close();
    };
  }, [server.id]);

  const disconnectLogs = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setLogsConnected(false);
  }, []);

  // Cleanup on unmount
  useEffect(
    () => () => {
      eventSourceRef.current?.close();
    },
    []
  );

  async function handleToggleStatus() {
    // A server is either "active" (in the allocation pool) or "inactive"
    // (out of the pool — existing Cubes keep running). One toggle, two states.
    const newStatus = server.status === "active" ? "inactive" : "active";
    await triggerToggle({
      url: `/api/orbit/servers/${server.id}`,
      method: "PATCH",
      body: { status: newStatus },
      successMessage: `Server set to ${newStatus}`,
      errorMessage: "Failed to update status",
    });
  }

  async function handleSaveOvercommit() {
    await triggerOvercommit({
      url: `/api/orbit/servers/${server.id}`,
      method: "PATCH",
      body: {
        maxCpuOvercommit: Number.parseFloat(cpuOvercommit),
        maxRamOvercommit: Number.parseFloat(ramOvercommit),
      },
      successMessage: "Overcommit ratios updated",
      errorMessage: "Failed to update",
    });
  }

  async function handleDelete() {
    await triggerDelete({
      url: `/api/orbit/servers/${server.id}`,
      method: "DELETE",
      successMessage: "Server removed",
      errorMessage: "Failed to delete server",
    });
  }

  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const isActive = server.status === "active";

  return (
    <Tabs className="space-y-6" {...tabParam}>
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="cubes">Cubes</TabsTrigger>
        <TabsTrigger value="logs">Logs</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
        <TabsTrigger value="setup">Setup</TabsTrigger>
        <TabsTrigger value="danger">Danger Zone</TabsTrigger>
      </TabsList>

      {/* Overview — server info, status, and live resource utilization */}
      <TabsContent className="space-y-6" value="overview">
        {/* Server info — two-column layout */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Server Info</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList>
                <DescriptionListItem label="Domain" numeric={false}>
                  <a
                    className="inline-flex items-center gap-1 font-mono transition-colors hover:text-foreground"
                    href={`https://${serverConnectDomain(server.hostname)}`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {serverConnectDomain(server.hostname)}
                    <ArrowSquareOutIcon className="size-3.5" />
                  </a>
                </DescriptionListItem>
                <DescriptionListItem label="Public IP">
                  {server.publicIp}
                </DescriptionListItem>
                <DescriptionListItem label="Region" numeric={false}>
                  {server.regionName}
                </DescriptionListItem>
                <DescriptionListItem label="SSH Port">
                  {server.sshPort}
                </DescriptionListItem>
                <DescriptionListItem label="Created" numeric={false}>
                  {format(server.createdAt, "MMM d, yyyy HH:mm")}
                </DescriptionListItem>
              </DescriptionList>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <Badge
                    className={cn(
                      "border-0 capitalize",
                      SERVER_STATUS_CLASSES[server.status]
                    )}
                    variant="secondary"
                  >
                    {server.status}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    {isActive
                      ? "Accepting new Cube allocations."
                      : "Not accepting new allocations. Cubes already on this server keep running — move or delete them before removing the server."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <AlertDialog
                    onOpenChange={setStatusDialogOpen}
                    open={statusDialogOpen}
                  >
                    <AlertDialogTrigger asChild>
                      <Button
                        disabled={togglingStatus}
                        size="sm"
                        variant={isActive ? "outline" : "default"}
                      >
                        {togglingStatus && <Spinner className="size-4" />}
                        {isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {isActive ? "Deactivate" : "Activate"} Server
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {isActive
                            ? `Deactivating "${server.hostname}" takes it out of the allocation pool — no new Cubes will be scheduled here. Cubes already running keep running; transfer or delete them before removing the server.`
                            : `Activating "${server.hostname}" will allow new Cubes to be allocated to this server.`}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={async () => {
                            await handleToggleStatus();
                            setStatusDialogOpen(false);
                          }}
                        >
                          {isActive ? "Deactivate" : "Activate"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Resource utilization */}
        <Card>
          <CardHeader>
            <CardTitle>Resource Utilization</CardTitle>
            <CardDescription>
              Current resource allocation against effective capacity (with
              overcommit).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <UsageBar
                label="CPU (vCPUs)"
                total={effectiveCpu}
                used={server.allocatedCpus}
              />
              <UsageBar
                label="RAM (MB)"
                total={effectiveRam}
                used={server.allocatedRamMb}
              />
              <UsageBar
                label="Disk (GB)"
                total={Math.max(0, server.totalDiskGb - server.overheadDiskGb)}
                used={server.allocatedDiskGb}
              />
            </div>
            <div className="grid grid-cols-3 gap-4 border-t pt-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Physical CPU</p>
                <p className="text-sm font-medium">{server.totalCpus} vCPUs</p>
                <p className="text-xs text-muted-foreground">
                  Effective: {effectiveCpu} ({server.maxCpuOvercommit}x)
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Physical RAM</p>
                <p className="text-sm font-medium">{server.totalRamMb} MB</p>
                <p className="text-xs text-muted-foreground">
                  Effective: {effectiveRam} MB ({server.maxRamOvercommit}x)
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Physical Disk</p>
                <p className="text-sm font-medium">{server.totalDiskGb} GB</p>
                <p className="text-xs text-muted-foreground">
                  Effective:{" "}
                  {Math.max(0, server.totalDiskGb - server.overheadDiskGb)} GB
                  {server.diskMeasuredAt
                    ? ` (overhead ${server.overheadDiskGb} GB)`
                    : " (overhead not yet measured)"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Logs — live SSH journal + admin job activity */}
      <TabsContent className="space-y-6" value="logs">
        {/* Live Server Logs */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Server Logs</CardTitle>
                <CardDescription>
                  Live process logs from the server via SSH (journalctl).
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {logsConnected && (
                  <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                    <span className="size-2 animate-pulse rounded-full bg-green-500" />
                    Connected
                  </span>
                )}
                {logsConnected ? (
                  <Button onClick={disconnectLogs} size="sm" variant="outline">
                    Disconnect
                  </Button>
                ) : (
                  <Button onClick={connectLogs} size="sm" variant="outline">
                    {logLines.length > 0 ? "Reconnect" : "Connect"}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {logsError && (
              <div className="mb-3 text-sm text-red-600 dark:text-red-400">
                Connection error: {logsError}
              </div>
            )}
            {logLines.length > 0 ? (
              <div
                className="max-h-125 overflow-y-auto rounded-md border bg-muted/50 p-4 font-mono text-xs leading-relaxed"
                ref={logContainerRef}
              >
                {logLines.map((line, i) => (
                  <div
                    className={cn(
                      "whitespace-pre-wrap",
                      line.includes("[stderr]") &&
                        "text-yellow-600 dark:text-yellow-400",
                      line.includes("error") && "text-red-500"
                    )}
                    // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only with no stable id
                    key={i}
                  >
                    {line}
                  </div>
                ))}
                {logsConnected && (
                  <div className="mt-2 flex items-center gap-2 text-muted-foreground">
                    <Spinner className="size-3" />
                    <span>Streaming...</span>
                  </div>
                )}
              </div>
            ) : logsConnected ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Spinner className="size-4" />
                <span className="text-sm">Connecting to server...</span>
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Click &quot;Connect&quot; to start streaming live server logs.
              </p>
            )}
          </CardContent>
        </Card>

        {activitySlot}
      </TabsContent>

      {/* Settings — overcommit ratios */}
      <TabsContent className="space-y-6" value="settings">
        {/* Overcommit settings */}
        <Card>
          <CardHeader>
            <CardTitle>Overcommit Ratios</CardTitle>
            <CardDescription>
              Configure how much CPU and RAM can be overprovisioned on this
              server.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="cpuOc">CPU Overcommit</Label>
                <Input
                  className="w-32"
                  id="cpuOc"
                  min={1}
                  onChange={(e) => setCpuOvercommit(e.target.value)}
                  step={0.1}
                  type="number"
                  value={cpuOvercommit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ramOc">RAM Overcommit</Label>
                <Input
                  className="w-32"
                  id="ramOc"
                  min={1}
                  onChange={(e) => setRamOvercommit(e.target.value)}
                  step={0.1}
                  type="number"
                  value={ramOvercommit}
                />
              </div>
              <Button
                disabled={savingOvercommit}
                onClick={handleSaveOvercommit}
              >
                {savingOvercommit && <Spinner className="size-4" />}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Cubes — all cubes that have lived on this server */}
      <TabsContent className="space-y-6" value="cubes">
        {/* Cubes on this server */}
        <Card>
          <CardHeader>
            <CardTitle>
              Cubes ({cubes.filter((c) => c.status !== "deleted").length} active
              {cubes.length ===
              cubes.filter((c) => c.status !== "deleted").length
                ? ""
                : `, ${cubes.length} total`}
              )
            </CardTitle>
            <CardDescription>
              All Cubes that have lived on this server. Deleted Cubes are kept
              for forensic context but no longer count against the server.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cubes.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No Cubes on this server.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Space</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>vCPUs</TableHead>
                    <TableHead>RAM (MB)</TableHead>
                    <TableHead>Disk (GB)</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cubesPageWindow.map((cube) => (
                    <TableRow
                      className="cursor-pointer"
                      key={cube.id}
                      onClick={() => router.push(`/orbit/cubes/${cube.id}`)}
                    >
                      <TableCell className="font-medium">{cube.name}</TableCell>
                      <TableCell>{cube.spaceName}</TableCell>
                      <TableCell>
                        <CubeStatusBadge
                          status={cube.status}
                          transferState={cube.transferState}
                        />
                      </TableCell>
                      <TableCell>{cube.vcpus}</TableCell>
                      <TableCell>{cube.ramMb}</TableCell>
                      <TableCell>{cube.diskLimitGb}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(cube.createdAt, "MMM d, yyyy")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {cubes.length > 0 && (
              <div className="mt-3">
                <TablePagination
                  onPageChange={setCubesPage}
                  onPageSizeChange={setCubesPageSize}
                  page={cubesPage}
                  pageSize={cubesPageSize}
                  total={cubes.length}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      {/* Setup — phased setup (pre-ready); once ready, an explicit Activate gate */}
      <TabsContent className="space-y-6" value="setup">
        {setupSlot}
        {!setupSlot &&
          (isActive ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                This server is fully set up and active.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-4 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  Setup is complete. This server is <strong>ready</strong> but{" "}
                  <strong>not yet active</strong> — activate it to add it to the
                  allocation pool so Cubes can be scheduled here.
                </p>
                <Button
                  disabled={togglingStatus}
                  onClick={handleToggleStatus}
                  size="sm"
                >
                  {togglingStatus && <Spinner className="size-4" />}
                  Activate server
                </Button>
              </CardContent>
            </Card>
          ))}
      </TabsContent>

      {/* Danger — remove server */}
      <TabsContent className="space-y-6" value="danger">
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
            <CardDescription>
              Permanently remove this server. This action cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  disabled={
                    cubes.filter((c) => c.status !== "deleted").length > 0 ||
                    deleting
                  }
                  size="sm"
                  variant="destructive"
                >
                  {deleting && <Spinner className="size-4" />}
                  {cubes.filter((c) => c.status !== "deleted").length > 0
                    ? "Remove active Cubes first"
                    : "Remove Server"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove server?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the server record for{" "}
                    <strong>{server.hostname}</strong>. This action cannot be
                    undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

const editServerSchema = z.object({
  publicIp: z.string().trim().min(1, "Public IP is required"),
  regionId: z.string().min(1, "Region is required"),
  sshPort: z
    .number({ error: "SSH port is required" })
    .int("Must be a whole number")
    .min(1, "Must be between 1 and 65535")
    .max(65_535, "Must be between 1 and 65535"),
  sshKeyId: z.string().min(1, "SSH key is required"),
});

type EditServerValues = z.infer<typeof editServerSchema>;

export function EditServerSheet({
  server,
  regions,
  sshKeys,
}: {
  server: ServerProps;
  regions: RegionOption[];
  sshKeys: SshKeyOption[];
}) {
  const [open, setOpen] = useState(false);
  const { trigger, isMutating } = useMutation();

  const defaultValues: EditServerValues = {
    publicIp: server.publicIp,
    regionId: server.regionId ?? "",
    sshPort: server.sshPort,
    sshKeyId: server.sshKeyId,
  };

  const form = useForm<EditServerValues>({
    resolver: zodResolver(editServerSchema),
    defaultValues,
    mode: "onChange",
  });

  const {
    formState: { isValid, isDirty },
  } = form;

  const watchedRegionId = useWatch({ control: form.control, name: "regionId" });
  const watchedSshKeyId = useWatch({ control: form.control, name: "sshKeyId" });
  const selectedRegionName =
    regions.find((r) => r.id === watchedRegionId)?.name ?? "Select region";
  const selectedSshKeyName =
    sshKeys.find((k) => k.id === watchedSshKeyId)?.name ?? "Select SSH key";

  async function handleSubmit(values: EditServerValues) {
    const data = await trigger({
      url: `/api/orbit/servers/${server.id}`,
      method: "PATCH",
      body: {
        publicIp: values.publicIp,
        regionId: values.regionId,
        sshPort: values.sshPort,
        sshKeyId: values.sshKeyId,
      },
      successMessage: "Server updated.",
      errorMessage: "Failed to update server",
    });
    if (data === null) {
      form.setError("root", { message: "Failed to update server" });
    } else {
      setOpen(false);
    }
  }

  return (
    <Sheet
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          form.reset(defaultValues);
        }
      }}
      open={open}
    >
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <PencilSimpleIcon className="size-4" />
          Edit Server
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Server</SheetTitle>
          <SheetDescription>Update server configuration.</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            className="space-y-4 px-4 pb-4"
            onSubmit={form.handleSubmit(handleSubmit)}
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
              name="publicIp"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Public IP</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="regionId"
              render={() => (
                <FormItem>
                  <FormLabel>Region</FormLabel>
                  <FormControl>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          className="w-full justify-between font-normal"
                          type="button"
                          variant="outline"
                        >
                          {selectedRegionName}
                          <CaretDownIcon className="size-4 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                        {regions.map((r) => (
                          <DropdownMenuItem
                            key={r.id}
                            onClick={() =>
                              form.setValue("regionId", r.id, {
                                shouldValidate: true,
                                shouldDirty: true,
                              })
                            }
                          >
                            <span className="flex-1">{r.name}</span>
                            {r.id === watchedRegionId && (
                              <CheckIcon className="size-4 text-primary" />
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sshPort"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SSH Port</FormLabel>
                  <FormControl>
                    <Input
                      max={65_535}
                      min={1}
                      name={field.name}
                      onBlur={field.onBlur}
                      onChange={(e) =>
                        field.onChange(e.target.valueAsNumber || "")
                      }
                      ref={field.ref}
                      type="number"
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sshKeyId"
              render={() => (
                <FormItem>
                  <FormLabel>SSH Key</FormLabel>
                  <FormControl>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          className="w-full justify-between font-normal"
                          type="button"
                          variant="outline"
                        >
                          {selectedSshKeyName}
                          <CaretDownIcon className="size-4 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width)">
                        {sshKeys.map((k) => (
                          <DropdownMenuItem
                            key={k.id}
                            onClick={() =>
                              form.setValue("sshKeyId", k.id, {
                                shouldValidate: true,
                                shouldDirty: true,
                              })
                            }
                          >
                            <span className="flex-1">{k.name}</span>
                            {k.id === watchedSshKeyId && (
                              <CheckIcon className="size-4 text-primary" />
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Hardware totals are auto-detected during bootstrap (Rule 35) —
                shown for reference, not editable. */}
            <div className="space-y-2">
              <Label>Hardware (auto-detected)</Label>
              <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/30 p-3">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">CPUs</p>
                  <p className="text-sm font-medium">{server.totalCpus}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">RAM (MB)</p>
                  <p className="text-sm font-medium">{server.totalRamMb}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Disk (GB)</p>
                  <p className="text-sm font-medium">{server.totalDiskGb}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Detected from the host during bootstrap. Not editable.
              </p>
            </div>

            <Button
              className="w-full"
              disabled={!isValid || !isDirty || isMutating}
              type="submit"
            >
              {isMutating && <Spinner className="size-4" />}
              Save Changes
            </Button>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
