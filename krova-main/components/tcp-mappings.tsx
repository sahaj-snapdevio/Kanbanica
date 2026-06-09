"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  DatabaseIcon,
  MagnifyingGlassIcon,
  PlugIcon,
  PlusIcon,
  TerminalIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { TcpLogViewer } from "@/components/tcp-log-viewer";
import { TcpMappingCard } from "@/components/tcp-mapping-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useMutation } from "@/hooks/use-mutation";
import { usePusherChannel, usePusherEvent } from "@/hooks/use-pusher";
import { cn } from "@/lib/utils";

export interface WhitelistedIp {
  cidr: string;
  id: string;
}

export interface TcpMapping {
  createdAt: string;
  cubeId: string;
  cubePort: number;
  hostPort: number;
  id: string;
  isSsh: boolean;
  label: string | null;
  status: "pending" | "active" | "stopping" | "failed" | "disabled";
  updatedAt: string;
  whitelistedIps: WhitelistedIp[];
}

interface TcpMappingsProps {
  canManage: boolean;
  cubeId: string;
  cubeStatus?: string;
  mappings: TcpMapping[];
  serverDomain: string;
  spaceId: string;
}

const tcpMappingSchema = z.object({
  cubePort: z
    .number()
    .int()
    .min(1, "Port must be between 1 and 65535")
    .max(65_535, "Port must be between 1 and 65535"),
  label: z.string().optional(),
  whitelistIps: z.string().optional(),
});

type TcpMappingFormValues = z.infer<typeof tcpMappingSchema>;

export function TcpMappings({
  mappings,
  cubeId,
  spaceId,
  serverDomain,
  canManage,
  cubeStatus,
}: TcpMappingsProps) {
  const isDisabled = cubeStatus === "deleted" || cubeStatus === "stopping";
  const effectiveCanManage = canManage && !isDisabled;
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const { trigger, isMutating } = useMutation();
  const [addOpen, setAddOpen] = useState(false);
  const [editingWhitelist, setEditingWhitelist] = useState<string | null>(null);
  const [whitelistInput, setWhitelistInput] = useState("");
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [logsOpenFor, setLogsOpenFor] = useState<TcpMapping | null>(null);
  const [editingSshPort, setEditingSshPort] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "disabled" | "ssh"
  >("all");
  // Empty default — gets overwritten by `setNewSshPort(String(port))` when
  // the user clicks Edit (preloads the CURRENT cubePort, never resets to 22).
  // The initial "" never shows in the UI because the form is only rendered
  // when editingSshPort !== null, which only happens after the click handler.
  const [newSshPort, setNewSshPort] = useState("");
  const [sshPortError, setSshPortError] = useState<string | null>(null);

  const addForm = useForm<TcpMappingFormValues>({
    resolver: zodResolver(tcpMappingSchema),
    defaultValues: {
      label: "",
      whitelistIps: "",
    },
    mode: "onChange",
  });

  const watchWhitelistIps = useWatch({
    control: addForm.control,
    name: "whitelistIps",
  });

  // Listen for real-time TCP mapping updates from the worker
  const channel = usePusherChannel(`private-cube-${cubeId}`);
  usePusherEvent(
    channel,
    "tcp-mapping.update",
    useCallback(
      (data: unknown) => {
        const event = data as { mappingId: string; status: string };
        if (
          event.status === "removed" ||
          event.status === "active" ||
          event.status === "disabled"
        ) {
          router.refresh();
        }
      },
      [router]
    )
  );

  const visibleMappings = mappings.filter((m) => {
    if (removedIds.has(m.id)) {
      return false;
    }
    if (statusFilter === "active" && m.status !== "active") {
      return false;
    }
    if (statusFilter === "disabled" && m.status !== "disabled") {
      return false;
    }
    if (statusFilter === "ssh" && !m.isSsh) {
      return false;
    }
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      const haystack = [
        String(m.cubePort),
        String(m.hostPort),
        m.label ?? "",
        m.isSsh ? "ssh" : "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) {
        return false;
      }
    }
    return true;
  });
  const totalCount = mappings.filter((m) => !removedIds.has(m.id)).length;

  async function handleAdd(values: TcpMappingFormValues) {
    const whitelistedIps = (values.whitelistIps ?? "")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const result = await trigger({
      url: `/api/spaces/${spaceId}/cubes/${cubeId}/tcp-mappings`,
      method: "POST",
      body: {
        cubePort: values.cubePort,
        label: values.label?.trim() || null,
        whitelistedIps,
      },
      successMessage: "TCP port mapping added",
      errorMessage: "Failed to add TCP port mapping",
    });

    if (result !== null) {
      addForm.reset();
      setAddOpen(false);
    }
  }

  function handleAddOpenChange(open: boolean) {
    setAddOpen(open);
    if (!open) {
      addForm.reset();
    }
  }

  async function handleRemove(mappingId: string) {
    // Optimistically remove from UI immediately
    setRemovedIds((prev) => new Set(prev).add(mappingId));
    const result = await trigger({
      url: `/api/spaces/${spaceId}/cubes/${cubeId}/tcp-mappings/${mappingId}`,
      method: "DELETE",
      successMessage: "TCP port mapping removed",
      errorMessage: "Failed to remove TCP port mapping",
    });
    if (result === null) {
      // API call failed — restore the item
      setRemovedIds((prev) => {
        const next = new Set(prev);
        next.delete(mappingId);
        return next;
      });
    }
  }

  async function handleUpdateWhitelist(mappingId: string) {
    const whitelistedIps = whitelistInput
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const result = await trigger({
      url: `/api/spaces/${spaceId}/cubes/${cubeId}/tcp-mappings/${mappingId}/whitelist`,
      method: "PUT",
      body: { whitelistedIps },
      successMessage: "Whitelist updated",
      errorMessage: "Failed to update whitelist",
    });

    if (result !== null) {
      setEditingWhitelist(null);
      setWhitelistInput("");
    }
  }

  async function handleToggleSshExposure(mappingId: string, enabled: boolean) {
    await trigger({
      url: `/api/spaces/${spaceId}/cubes/${cubeId}/tcp-mappings/${mappingId}/exposure`,
      method: "POST",
      body: { enabled },
      successMessage: enabled ? "Enabling SSH…" : "Disabling SSH…",
      errorMessage: enabled ? "Failed to enable SSH" : "Failed to disable SSH",
    });
  }

  async function handleUpdateSshPort(_mappingId: string) {
    const port = Number.parseInt(newSshPort, 10);
    if (!port || port < 1 || port > 65_535) {
      setSshPortError("Port must be between 1 and 65535");
      return;
    }
    setSshPortError(null);
    // The SSH port has its own endpoint — no mapping id in the URL because
    // every cube has exactly one SSH mapping. The `_mappingId` arg is kept
    // here so this handler's signature matches the other handlers
    // (`handleRemove`, `handleUpdateWhitelist`, …) but is intentionally
    // unused.
    const result = await trigger({
      url: `/api/spaces/${spaceId}/cubes/${cubeId}/ssh-port`,
      method: "PUT",
      body: { cubePort: port },
      successMessage: `SSH port updated to ${port}`,
      errorMessage: "Failed to update SSH port",
    });
    if (result !== null) {
      setEditingSshPort(null);
      setNewSshPort("");
      router.refresh();
    }
  }

  function startEditWhitelist(mapping: TcpMapping) {
    setEditingWhitelist(mapping.id);
    setWhitelistInput(mapping.whitelistedIps.map((w) => w.cidr).join("\n"));
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-lg">
          <PlugIcon className="size-5" />
          TCP Port Mappings
        </CardTitle>
        {effectiveCanManage && (
          <Sheet onOpenChange={handleAddOpenChange} open={addOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline">
                <PlusIcon className="size-4" />
                Add Mapping
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Add TCP port mapping</SheetTitle>
                <SheetDescription>
                  Expose a raw TCP port on this Cube — for databases, caches,
                  and other non-HTTP services.
                </SheetDescription>
              </SheetHeader>
              <Form {...addForm}>
                <form
                  className="space-y-4 px-4 pb-4"
                  onSubmit={addForm.handleSubmit(handleAdd)}
                >
                  <FormField
                    control={addForm.control}
                    name="cubePort"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cube Port</FormLabel>
                        <FormControl>
                          <Input
                            disabled={isMutating}
                            max={65_535}
                            min={1}
                            name={field.name}
                            onBlur={field.onBlur}
                            onChange={(e) =>
                              field.onChange(e.target.valueAsNumber || "")
                            }
                            placeholder="e.g. 3306, 5432, 6379"
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
                    control={addForm.control}
                    name="label"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Label
                          <span className="ml-1.5 text-muted-foreground">
                            optional
                          </span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            disabled={isMutating}
                            placeholder="e.g. MySQL, Postgres, Redis"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addForm.control}
                    name="whitelistIps"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          IP Whitelist
                          <span className="ml-1.5 text-muted-foreground">
                            optional
                          </span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            disabled={isMutating}
                            placeholder="e.g. 203.0.113.0/24, 198.51.100.5"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Separate multiple entries with a comma or a new line.
                          Accepts single IPs and CIDR blocks.
                        </FormDescription>
                        {!watchWhitelistIps?.trim() && (
                          <p className="flex items-center gap-1.5 text-xs text-yellow-600 dark:text-yellow-400">
                            <WarningIcon className="size-3.5 shrink-0" />
                            Without a whitelist, this port will be publicly
                            accessible.
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    className="w-full"
                    disabled={!addForm.formState.isValid || isMutating}
                    type="submit"
                  >
                    {isMutating && <Spinner className="size-4" />}
                    Add Mapping
                  </Button>
                </form>
              </Form>
            </SheetContent>
          </Sheet>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
          <DatabaseIcon className="mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="space-y-1 text-xs text-blue-800 dark:text-blue-300">
            <p className="font-medium">
              For databases, caches, and raw TCP services
            </p>
            <p className="text-blue-700 dark:text-blue-400">
              Expose ports like MySQL (3306), Postgres (5432), or Redis (6379)
              directly over TCP. Connect using tools like{" "}
              <code className="font-mono">mysql</code>,{" "}
              <code className="font-mono">psql</code>, or{" "}
              <code className="font-mono">redis-cli</code> — not a browser. For
              web apps, use Domain Mappings instead.
            </p>
          </div>
        </div>

        {totalCount > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <MagnifyingGlassIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-8"
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by port or label…"
                value={search}
              />
              {search && (
                <Button
                  aria-label="Clear search"
                  className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
                  onClick={() => setSearch("")}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <XIcon className="size-3.5" />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5 text-xs">
              {(
                [
                  ["all", "All"],
                  ["active", "Active"],
                  ["disabled", "Disabled"],
                  ["ssh", "SSH"],
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
                  onClick={() => setStatusFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {visibleMappings.length === 0 ? (
          <p className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
            {totalCount === 0
              ? "No TCP port mappings configured."
              : search || statusFilter !== "all"
                ? "No mappings match the current filter."
                : "No TCP port mappings configured."}
          </p>
        ) : (
          <div className="space-y-3">
            {visibleMappings.map((mapping) => (
              <TcpMappingCard
                canManage={effectiveCanManage}
                isEditingSshPort={editingSshPort === mapping.id}
                isEditingWhitelist={editingWhitelist === mapping.id}
                isMutating={isMutating}
                isRefreshing={isRefreshing}
                key={mapping.id}
                mapping={mapping}
                newSshPort={newSshPort}
                onCancelEditSshPort={() => {
                  setEditingSshPort(null);
                  setNewSshPort("");
                  setSshPortError(null);
                }}
                onCancelEditWhitelist={() => {
                  setEditingWhitelist(null);
                  setWhitelistInput("");
                }}
                onNewSshPortChange={(value) => {
                  setNewSshPort(value);
                  setSshPortError(null);
                }}
                onOpenLogs={setLogsOpenFor}
                onRefresh={() => startRefresh(() => router.refresh())}
                onRemove={handleRemove}
                onSaveSshPort={handleUpdateSshPort}
                onSaveWhitelist={handleUpdateWhitelist}
                onStartEditSshPort={(id, port) => {
                  setEditingSshPort(id);
                  setNewSshPort(String(port));
                  setSshPortError(null);
                }}
                onStartEditWhitelist={startEditWhitelist}
                onToggleSshExposure={handleToggleSshExposure}
                onWhitelistInputChange={setWhitelistInput}
                serverDomain={serverDomain}
                sshPortError={sshPortError}
                whitelistInput={whitelistInput}
              />
            ))}
          </div>
        )}
      </CardContent>

      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            setLogsOpenFor(null);
          }
        }}
        open={!!logsOpenFor}
      >
        <SheetContent className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <TerminalIcon className="size-4" />
              Live TCP activity
            </SheetTitle>
            <SheetDescription>
              Real-time tcpdump on host port{" "}
              <code className="font-mono">{logsOpenFor?.hostPort}</code>
              {logsOpenFor?.label ? ` — ${logsOpenFor.label}` : ""}.
            </SheetDescription>
          </SheetHeader>
          {logsOpenFor && (
            <div className="px-4 pb-4">
              <TcpLogViewer
                cubeId={cubeId}
                hostPort={logsOpenFor.hostPort}
                mappingId={logsOpenFor.id}
                spaceId={spaceId}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
