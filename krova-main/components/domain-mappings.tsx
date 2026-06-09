"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  BroomIcon,
  CopyIcon,
  GlobeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TerminalIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { ResourceStatusBadge } from "@/components/resource-status-badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { CLOUDFLARE_CNAME_TARGET } from "@/config/platform";
import { useMutation } from "@/hooks/use-mutation";
import { usePusherChannel, usePusherEvent } from "@/hooks/use-pusher";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

interface DomainMapping {
  cloudflareStatus: string | null;
  createdAt: string;
  cubeId: string;
  domain: string;
  id: string;
  port: number | null;
  status: "pending" | "active" | "stopping";
  updatedAt: string;
}

interface DomainMappingsProps {
  canManage: boolean;
  cubeId: string;
  cubeStatus?: string;
  mappings: DomainMapping[];
  spaceId: string;
}

const domainSchema = z.object({
  domain: z.string().min(1, "Domain is required"),
  port: z
    .string()
    .min(1, "Port is required")
    .regex(/^\d+$/, "Port must contain numbers only")
    .refine((value) => {
      const port = Number(value);
      return Number.isInteger(port) && port >= 1 && port <= 65_535;
    }, "Port must be between 1 and 65535"),
});

type DomainFormValues = z.infer<typeof domainSchema>;

export function DomainMappings({
  mappings,
  cubeId,
  spaceId,
  canManage,
  cubeStatus,
}: DomainMappingsProps) {
  const isDisabled = cubeStatus === "deleted" || cubeStatus === "stopping";
  const effectiveCanManage = canManage && !isDisabled;
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const { trigger, isMutating } = useMutation();
  const [addOpen, setAddOpen] = useState(false);
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [logsOpenFor, setLogsOpenFor] = useState<DomainMapping | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DomainMapping | null>(null);
  const [query, setQuery] = useState("");
  const { trigger: triggerPurge } = useMutation({ revalidate: false });
  const [purgeTarget, setPurgeTarget] = useState<DomainMapping | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);

  const addForm = useForm<DomainFormValues>({
    resolver: zodResolver(domainSchema),
    defaultValues: { domain: "", port: "80" },
    mode: "onChange",
  });

  const channel = usePusherChannel(`private-cube-${cubeId}`);
  usePusherEvent(
    channel,
    "domain.update",
    useCallback(
      (data: unknown) => {
        const event = data as { mappingId: string; status: string };
        if (event.status === "removed" || event.status === "active") {
          router.refresh();
        }
      },
      [router]
    )
  );
  usePusherEvent(
    channel,
    "domain.cache-purged",
    useCallback((data: unknown) => {
      const event = data as {
        domain: string;
        status: string;
        error?: string;
      };
      if (event.status === "success") {
        toast.success(`Cache cleared for ${event.domain}`);
      } else {
        toast.error(
          `Cache clear failed for ${event.domain}${event.error ? `: ${event.error}` : ""}`
        );
      }
    }, [])
  );

  const activeMappings = mappings.filter((m) => !removedIds.has(m.id));

  async function handleAdd(values: DomainFormValues) {
    const result = await trigger({
      url: `/api/spaces/${spaceId}/cubes/${cubeId}/domains`,
      method: "POST",
      body: { domain: values.domain.trim(), port: Number(values.port) },
      successMessage: "Domain mapping added",
      errorMessage: "Failed to add domain",
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

  async function handleRemoveConfirm() {
    if (!deleteTarget) {
      return;
    }
    const target = deleteTarget;
    setRemovedIds((prev) => new Set(prev).add(target.id));
    setDeleteTarget(null);
    const result = await trigger({
      url: `/api/spaces/${spaceId}/cubes/${cubeId}/domains/${target.id}`,
      method: "DELETE",
      successMessage: "Domain mapping removed",
      errorMessage: "Failed to remove domain",
    });
    if (result === null) {
      setRemovedIds((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
    }
  }

  async function handlePurgeConfirm() {
    if (!purgeTarget) {
      return;
    }
    const target = purgeTarget;
    setPurgeTarget(null);
    setPurgingId(target.id);
    const result = await triggerPurge({
      url: `/api/spaces/${spaceId}/cubes/${cubeId}/domains/${target.id}/purge-cache`,
      method: "POST",
      errorMessage: "Failed to clear cache",
    });
    setPurgingId(null);
    // 202 → enqueued; the worker confirms success/failure via the
    // `domain.cache-purged` Pusher event above. A 429 / error was already
    // surfaced as a toast by useMutation (result === null).
    if (result !== null) {
      toast.info(`Clearing cache for ${target.domain}…`);
    }
  }

  const filtered = activeMappings.filter((m) =>
    m.domain.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <GlobeIcon className="size-5" />
            Domain Mappings
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Map custom domains to web apps, APIs, and sites. Managed TLS + DDoS
            protection via Cloudflare.
          </p>
        </div>
        {effectiveCanManage && (
          <Sheet onOpenChange={handleAddOpenChange} open={addOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline">
                <PlusIcon className="size-4" />
                Add Domain
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Add domain</SheetTitle>
                <SheetDescription>
                  Map a custom domain to a web app, API, or site on this Cube.
                </SheetDescription>
              </SheetHeader>
              <Form {...addForm}>
                <form
                  className="space-y-4 px-4 pb-4"
                  onSubmit={addForm.handleSubmit(handleAdd)}
                >
                  <FormField
                    control={addForm.control}
                    name="domain"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Domain</FormLabel>
                        <FormControl>
                          <Input
                            disabled={isMutating}
                            placeholder="app.example.com"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addForm.control}
                    name="port"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Port</FormLabel>
                        <FormControl>
                          <Input
                            disabled={isMutating}
                            inputMode="numeric"
                            maxLength={5}
                            pattern="[0-9]*"
                            placeholder="80"
                            type="text"
                            {...field}
                            onChange={(e) => {
                              field.onChange(e.target.value.replace(/\D/g, ""));
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                    <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <WarningIcon
                        className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                        weight="fill"
                      />
                      Next steps after you click Add
                    </p>
                    <ol className="space-y-2 text-xs text-muted-foreground">
                      <li className="flex gap-2.5">
                        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground/10 font-mono text-[10px] font-semibold text-foreground">
                          1
                        </span>
                        <span>
                          Create a <strong>CNAME</strong> record at your DNS
                          provider that points this hostname to{" "}
                          <code className="font-mono text-foreground">
                            {CLOUDFLARE_CNAME_TARGET}
                          </code>
                          .
                        </span>
                      </li>
                      <li className="flex gap-2.5">
                        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-500/15 font-mono text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                          2
                        </span>
                        <span>
                          <strong>If your DNS is on Cloudflare</strong>, set
                          that record to <strong>DNS only</strong> (grey cloud),{" "}
                          <em>not</em> Proxied — proxying breaks certificate
                          issuance.
                        </span>
                      </li>
                      <li className="flex gap-2.5">
                        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                          3
                        </span>
                        <span>
                          Cloudflare issues + renews HTTPS automatically —
                          usually within a minute of CNAME propagation.
                        </span>
                      </li>
                    </ol>
                  </div>
                  <Button
                    className="w-full"
                    disabled={!addForm.formState.isValid || isMutating}
                    type="submit"
                  >
                    {isMutating && <Spinner className="size-4" />}
                    Add Domain
                  </Button>
                </form>
              </Form>
            </SheetContent>
          </Sheet>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {activeMappings.length > 0 && (
          <div className="relative">
            <MagnifyingGlassIcon className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search domains…"
              value={query}
            />
          </div>
        )}
        {filtered.length === 0 ? (
          <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            {activeMappings.length === 0
              ? "Add a custom domain to route traffic to this Cube."
              : "No domains match your search."}
          </p>
        ) : (
          <Accordion className="rounded-md border" collapsible type="single">
            {filtered.map((m) => (
              <AccordionItem
                className="px-3 last:border-b-0"
                key={m.id}
                value={m.id}
              >
                <AccordionTrigger className="items-center gap-3 hover:no-underline">
                  <span className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 pr-2">
                    <span className="truncate font-mono text-sm font-medium">
                      {m.domain}
                    </span>
                    <ResourceStatusBadge status={m.status} />
                    {m.cloudflareStatus === "active" && (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                        HTTPS live
                      </span>
                    )}
                    {m.cloudflareStatus && m.cloudflareStatus !== "active" && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        Securing TLS
                      </span>
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {m.status === "active" && (
                      <Button
                        onClick={() =>
                          window.open(
                            `https://${m.domain}`,
                            "_blank",
                            "noopener,noreferrer"
                          )
                        }
                        size="sm"
                        variant="outline"
                      >
                        <ArrowSquareOutIcon className="size-4" />
                        Open
                      </Button>
                    )}
                    {m.status === "active" && (
                      <Button
                        onClick={() => setLogsOpenFor(m)}
                        size="sm"
                        variant="outline"
                      >
                        <TerminalIcon className="size-4" />
                        Logs
                      </Button>
                    )}
                    {(m.status === "pending" || m.status === "stopping") && (
                      <Button
                        disabled={isRefreshing}
                        onClick={() => startRefresh(() => router.refresh())}
                        size="sm"
                        variant="outline"
                      >
                        <ArrowClockwiseIcon
                          className={cn(
                            "size-4",
                            isRefreshing && "animate-spin"
                          )}
                        />
                        Refresh status
                      </Button>
                    )}
                    {effectiveCanManage &&
                      m.status === "active" &&
                      m.cloudflareStatus === "active" && (
                        <Button
                          disabled={purgingId === m.id}
                          onClick={() => setPurgeTarget(m)}
                          size="sm"
                          variant="outline"
                        >
                          {purgingId === m.id ? (
                            <Spinner className="size-4" />
                          ) : (
                            <BroomIcon className="size-4" />
                          )}
                          Clear cache
                        </Button>
                      )}
                    {effectiveCanManage && (
                      <Button
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={isMutating}
                        onClick={() => setDeleteTarget(m)}
                        size="sm"
                        variant="ghost"
                      >
                        <TrashIcon className="size-4" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
                    <div className="flex items-center gap-1.5">
                      <dt className="text-muted-foreground">Port</dt>
                      <dd className="font-medium">{m.port ?? "—"}</dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <dt className="text-muted-foreground">
                        TLS / Cloudflare
                      </dt>
                      <dd className="font-medium">
                        {m.cloudflareStatus === "active"
                          ? "HTTPS live"
                          : (m.cloudflareStatus ?? "—")}
                      </dd>
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <dt className="shrink-0 text-muted-foreground">
                        CNAME target
                      </dt>
                      <dd className="flex min-w-0 items-center gap-1">
                        <code className="truncate font-mono">
                          {CLOUDFLARE_CNAME_TARGET}
                        </code>
                        <Button
                          aria-label="Copy CNAME to clipboard"
                          onClick={() =>
                            copyToClipboard(CLOUDFLARE_CNAME_TARGET)
                          }
                          size="icon-xs"
                          variant="ghost"
                        >
                          <CopyIcon className="size-3" />
                        </Button>
                      </dd>
                    </div>
                  </dl>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
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
              Live access logs
            </SheetTitle>
            <SheetDescription>
              Real-time HTTP access log from Caddy for{" "}
              <code className="font-mono">{logsOpenFor?.domain}</code>.
            </SheetDescription>
          </SheetHeader>
          {logsOpenFor && (
            <div className="px-4 pb-4">
              <DomainLogViewer
                cubeId={cubeId}
                domain={logsOpenFor.domain}
                mappingId={logsOpenFor.id}
                spaceId={spaceId}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmActionDialog
        confirmLabel="Remove"
        description={
          <p>
            Remove{" "}
            <strong className="text-foreground">{deleteTarget?.domain}</strong>{" "}
            from this Cube? Traffic will stop being routed to this domain.
          </p>
        }
        onConfirm={handleRemoveConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        open={!!deleteTarget}
        title="Remove Domain Mapping"
      />

      <ConfirmActionDialog
        confirmLabel="Clear cache"
        description={
          <p>
            Clear the Cloudflare edge cache for{" "}
            <strong className="text-foreground">{purgeTarget?.domain}</strong>?
            Visitors get fresh content on their next request. This affects only
            this domain — no other domain's cache is touched.
          </p>
        }
        destructive={false}
        onConfirm={handlePurgeConfirm}
        onOpenChange={(open) => {
          if (!open) {
            setPurgeTarget(null);
          }
        }}
        open={!!purgeTarget}
        title="Clear cache"
      />
    </Card>
  );
}

function DomainLogViewer({
  spaceId,
  cubeId,
  mappingId,
  domain,
}: {
  spaceId: string;
  cubeId: string;
  mappingId: string;
  domain: string;
}) {
  const [lines, setLines] = useState<{ id: number; content: string }[]>([]);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const lineIdRef = useRef(0);

  useEffect(() => {
    const es = new EventSource(
      `/api/spaces/${spaceId}/cubes/${cubeId}/domains/${mappingId}/logs`
    );
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error) {
          setError(data.error);
          setConnected(false);
          es.close();
        } else if (data.line) {
          setLines((prev) => {
            const next = [
              ...prev,
              { id: ++lineIdRef.current, content: data.line as string },
            ];
            return next.length > 500 ? next.slice(-500) : next;
          });
        }
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [spaceId, cubeId, mappingId]);

  // Auto-scroll on every new line. We read `lineCount` inside the effect (not
  // just in the dep array) so the React Compiler rule doesn't flag it as
  // superfluous.
  const lineCount = lines.length;
  useEffect(() => {
    if (lineCount > 0 && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lineCount]);

  return (
    <div className="mt-4 rounded-md border bg-muted/30">
      <div className="flex items-center justify-between border-b p-2 text-xs">
        <span className="text-muted-foreground">{domain}</span>
        {connected ? (
          <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            Streaming
          </span>
        ) : (
          <span className="text-muted-foreground">Disconnected</span>
        )}
      </div>
      {error && (
        <p className="border-b p-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div
        className="max-h-[60vh] overflow-y-auto bg-background p-2 font-mono text-[11px] leading-relaxed"
        ref={containerRef}
      >
        {lines.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground">
            {connected ? "Waiting for requests..." : "Disconnected"}
          </p>
        ) : (
          lines.map((line) => {
            let parsed: {
              status?: number;
              request?: { method?: string; uri?: string; remote_ip?: string };
              duration?: number;
            } | null = null;
            try {
              parsed = JSON.parse(line.content);
            } catch {
              // raw line
            }

            if (parsed?.request?.method) {
              const status = parsed.status ?? 0;
              const statusColor =
                status >= 500
                  ? "text-red-500"
                  : status >= 400
                    ? "text-yellow-600 dark:text-yellow-400"
                    : "text-emerald-600 dark:text-emerald-400";
              return (
                <div className="flex gap-2" key={line.id}>
                  <span className={statusColor}>{status}</span>
                  <span className="text-blue-600 dark:text-blue-400">
                    {parsed.request.method}
                  </span>
                  <span className="flex-1 truncate">{parsed.request.uri}</span>
                  {parsed.duration != null && (
                    <span className="text-muted-foreground">
                      {(parsed.duration * 1000).toFixed(0)}ms
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {parsed.request.remote_ip}
                  </span>
                </div>
              );
            }

            return (
              <div className="whitespace-pre-wrap" key={line.id}>
                {line.content}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
