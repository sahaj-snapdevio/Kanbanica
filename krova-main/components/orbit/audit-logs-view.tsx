"use client";

import {
  CaretDownIcon,
  ChartBarIcon,
  ClockCounterClockwiseIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { format } from "date-fns";
import { Fragment, useState } from "react";
import useSWR from "swr";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { useMutation } from "@/hooks/use-mutation";
import { fetcher } from "@/lib/fetcher";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditLogRow {
  action: string;
  actorEmail: string | null;
  actorId: string | null;
  actorType: string;
  category: string;
  createdAt: string;
  description: string | null;
  entityId: string | null;
  entityType: string;
  id: string;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  source: string;
  spaceId: string | null;
  userAgent: string | null;
}

interface Pagination {
  limit: number;
  page: number;
  total: number;
  totalPages: number;
}

interface StatsData {
  byAction: { action: string; count: number }[];
  byActorType: { actorType: string; count: number }[];
  byCategory: { category: string; count: number }[];
  bySource: { source: string; count: number }[];
  topActors: { actorId: string; actorEmail: string; count: number }[];
  topSpaces: { spaceId: string; count: number }[];
  total: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_OPTIONS = [
  "all",
  "auth",
  "space",
  "member",
  "invite",
  "cube",
  "app",
  "domain",
  "tcp_mapping",
  "ssh_key",
  "billing",
  "server",
  "platform",
  "webhook",
] as const;

const ACTOR_TYPE_OPTIONS = ["all", "user", "admin", "system"] as const;
const SOURCE_OPTIONS = ["all", "web", "api", "worker", "system"] as const;

const categoryColors: Record<string, string> = {
  auth: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  space: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
  member: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
  invite: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  cube: "bg-green-500/10 text-green-700 dark:text-green-400",
  app: "bg-teal-500/10 text-teal-700 dark:text-teal-400",
  domain: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  tcp_mapping: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  ssh_key: "bg-red-500/10 text-red-700 dark:text-red-400",
  billing: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  server: "bg-slate-500/10 text-slate-700 dark:text-slate-400",
  platform: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  webhook: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LogsResponse {
  data: AuditLogRow[];
  pagination: Pagination;
}

const EMPTY_PAGINATION: Pagination = {
  page: 1,
  limit: 50,
  total: 0,
  totalPages: 0,
};

export function AuditLogsView() {
  const [statsOpen, setStatsOpen] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [actorEmail, setActorEmail] = useState("");
  const [category, setCategory] = useState("all");
  const [actorType, setActorType] = useState("all");
  const [source, setSource] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  // Platform-wide pagination: default 10 rows per page; selector exposes
  // 10/25/50/100. Per-page change resets to page 1.
  const [pageSize, setPageSize] = useState(10);

  // Reset page to 1 when filters change — adjust state during render
  // (React's recommended pattern instead of setState in useEffect)
  const filtersKey = `${search}|${actorEmail}|${category}|${actorType}|${source}|${from}|${to}`;
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (prevFiltersKey !== filtersKey) {
    setPrevFiltersKey(filtersKey);
    setPage(1);
  }
  const [prevPageSize, setPrevPageSize] = useState(pageSize);
  if (prevPageSize !== pageSize) {
    setPrevPageSize(pageSize);
    setPage(1);
  }

  // Truncation
  const [truncateFrom, setTruncateFrom] = useState("");
  const [truncateTo, setTruncateTo] = useState("");
  const { trigger: truncateTrigger, isMutating: isTruncating } = useMutation();

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const logsParams = new URLSearchParams();
  logsParams.set("page", String(page));
  logsParams.set("limit", String(pageSize));
  if (search) {
    logsParams.set("search", search);
  }
  if (actorEmail) {
    logsParams.set("actorEmail", actorEmail);
  }
  if (category !== "all") {
    logsParams.set("category", category);
  }
  if (actorType !== "all") {
    logsParams.set("actorType", actorType);
  }
  if (source !== "all") {
    logsParams.set("source", source);
  }
  if (from) {
    logsParams.set("from", new Date(from).toISOString());
  }
  if (to) {
    logsParams.set("to", new Date(to).toISOString());
  }

  const {
    data: logsData,
    isLoading: loading,
    mutate: refetchLogs,
  } = useSWR<LogsResponse>(
    `/api/orbit/audit-logs?${logsParams.toString()}`,
    fetcher
  );

  const logs = logsData?.data ?? [];
  const pagination = logsData?.pagination ?? EMPTY_PAGINATION;

  const statsParams = new URLSearchParams();
  if (from) {
    statsParams.set("from", new Date(from).toISOString());
  }
  if (to) {
    statsParams.set("to", new Date(to).toISOString());
  }

  const { data: stats, isLoading: statsLoading } = useSWR<StatsData>(
    statsOpen ? `/api/orbit/audit-logs/stats?${statsParams.toString()}` : null,
    fetcher
  );

  async function handleTruncate() {
    await truncateTrigger({
      url: "/api/orbit/audit-logs/truncate",
      method: "POST",
      body: {
        from: truncateFrom ? new Date(truncateFrom).toISOString() : undefined,
        to: truncateTo ? new Date(truncateTo).toISOString() : undefined,
      },
      successMessage: "Audit logs truncated successfully",
      errorMessage: "Failed to truncate audit logs",
    });
    setTruncateFrom("");
    setTruncateTo("");
    refetchLogs();
  }

  const hasFilters =
    search ||
    actorEmail ||
    category !== "all" ||
    actorType !== "all" ||
    source !== "all" ||
    from ||
    to;

  function clearFilters() {
    setSearch("");
    setActorEmail("");
    setCategory("all");
    setActorType("all");
    setSource("all");
    setFrom("");
    setTo("");
    setPage(1);
  }

  function escapeCsv(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }
    const str = typeof value === "string" ? value : JSON.stringify(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function handleExportCsv() {
    if (logs.length === 0) {
      return;
    }
    const header = [
      "createdAt",
      "action",
      "category",
      "actorType",
      "actorEmail",
      "actorId",
      "entityType",
      "entityId",
      "spaceId",
      "source",
      "description",
      "metadata",
    ];
    const rows = logs.map((l) =>
      [
        l.createdAt,
        l.action,
        l.category,
        l.actorType,
        l.actorEmail,
        l.actorId,
        l.entityType,
        l.entityId,
        l.spaceId,
        l.source,
        l.description,
        l.metadata,
      ]
        .map(escapeCsv)
        .join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orbit-audit-logs-page-${page}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Filters Row */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Search */}
        <div className="relative w-64">
          <MagnifyingGlassIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search descriptions..."
            value={search}
          />
        </div>

        {/* Category filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="w-40 justify-between font-normal"
              variant="outline"
            >
              {category === "all"
                ? "All categories"
                : category.replace("_", " ")}
              <CaretDownIcon className="size-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-40">
            {CATEGORY_OPTIONS.map((opt, i) => (
              <Fragment key={opt}>
                {i === 1 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => setCategory(opt)}>
                  {opt === "all" ? "All categories" : opt.replace("_", " ")}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Actor type filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="w-36 justify-between font-normal"
              variant="outline"
            >
              {actorType === "all" ? "All actors" : actorType}
              <CaretDownIcon className="size-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-36">
            {ACTOR_TYPE_OPTIONS.map((opt, i) => (
              <Fragment key={opt}>
                {i === 1 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => setActorType(opt)}>
                  {opt === "all" ? "All actors" : opt}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Actor email — partial match on actor_email */}
        <Input
          autoComplete="off"
          className="w-56"
          onChange={(e) => setActorEmail(e.target.value)}
          placeholder="Filter by actor email…"
          spellCheck={false}
          value={actorEmail}
        />

        {/* Source filter */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="w-32 justify-between font-normal"
              variant="outline"
            >
              {source === "all" ? "All sources" : source}
              <CaretDownIcon className="size-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-32">
            {SOURCE_OPTIONS.map((opt, i) => (
              <Fragment key={opt}>
                {i === 1 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => setSource(opt)}>
                  {opt === "all" ? "All sources" : opt}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Date range */}
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input
              className="w-36"
              onChange={(e) => setFrom(e.target.value)}
              type="date"
              value={from}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              className="w-36"
              onChange={(e) => setTo(e.target.value)}
              type="date"
              value={to}
            />
          </div>
        </div>

        {hasFilters && (
          <Button onClick={clearFilters} size="sm" variant="ghost">
            <FunnelIcon className="mr-1 size-4" />
            Clear
          </Button>
        )}
      </div>

      {/* Actions bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {pagination.total.toLocaleString()} log
          {pagination.total === 1 ? "" : "s"} found
        </p>
        <div className="flex gap-2">
          <Button
            disabled={logs.length === 0}
            onClick={handleExportCsv}
            size="sm"
            title="Download current page as CSV"
            variant="outline"
          >
            Export CSV
          </Button>
          {/* Stats sheet */}
          <Sheet onOpenChange={setStatsOpen} open={statsOpen}>
            <SheetTrigger asChild>
              <Button
                onClick={() => setStatsOpen(true)}
                size="sm"
                variant="outline"
              >
                <ChartBarIcon className="mr-1 size-4" />
                Stats
              </Button>
            </SheetTrigger>
            <SheetContent className="overflow-y-auto sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Audit Log Statistics</SheetTitle>
                <SheetDescription>
                  Overview of audit log activity and breakdowns.
                </SheetDescription>
              </SheetHeader>
              {statsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner className="size-6" />
                </div>
              ) : stats ? (
                <div className="space-y-5 px-4 pb-4">
                  <p className="text-sm text-muted-foreground">
                    Total logs: <strong>{stats.total.toLocaleString()}</strong>
                    {from || to
                      ? ` (filtered ${from ? `from ${from}` : ""}${from && to ? " " : ""}${to ? `to ${to}` : ""})`
                      : ""}
                  </p>

                  {/* By category */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      By Category
                    </h4>
                    <div className="space-y-1 rounded-md border p-3">
                      {stats.byCategory.map((r) => (
                        <div
                          className="flex items-center justify-between text-sm"
                          key={r.category}
                        >
                          <span className="capitalize">
                            {r.category.replace("_", " ")}
                          </span>
                          <span className="font-mono text-muted-foreground">
                            {r.count.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* By actor type */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      By Actor Type
                    </h4>
                    <div className="space-y-1 rounded-md border p-3">
                      {stats.byActorType.map((r) => (
                        <div
                          className="flex items-center justify-between text-sm"
                          key={r.actorType}
                        >
                          <span className="capitalize">{r.actorType}</span>
                          <span className="font-mono text-muted-foreground">
                            {r.count.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Top actions */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Top Actions
                    </h4>
                    <div className="space-y-1 rounded-md border p-3">
                      {stats.byAction.slice(0, 10).map((r) => (
                        <div
                          className="flex items-center justify-between text-sm"
                          key={r.action}
                        >
                          <span className="font-mono text-xs">{r.action}</span>
                          <span className="font-mono text-muted-foreground">
                            {r.count.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Top users */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Most Active Users
                    </h4>
                    <div className="space-y-1 rounded-md border p-3">
                      {stats.topActors.map((r) => (
                        <div
                          className="flex items-center justify-between text-sm"
                          key={r.actorId}
                        >
                          <span className="truncate">
                            {r.actorEmail ?? r.actorId}
                          </span>
                          <span className="ml-2 shrink-0 font-mono text-muted-foreground">
                            {r.count.toLocaleString()}
                          </span>
                        </div>
                      ))}
                      {stats.topActors.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No user actions yet
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </SheetContent>
          </Sheet>

          {/* Truncate sheet */}
          <Sheet>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline">
                <TrashIcon className="mr-1 size-4" />
                Truncate
              </Button>
            </SheetTrigger>
            <SheetContent className="sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Truncate Audit Logs</SheetTitle>
                <SheetDescription>
                  Permanently delete logs within a date range.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-4">
                <p className="text-sm text-muted-foreground">
                  Permanently delete audit logs within a date range. This action
                  cannot be undone.
                </p>
                <div className="space-y-2">
                  <Label>From</Label>
                  <Input
                    onChange={(e) => setTruncateFrom(e.target.value)}
                    type="datetime-local"
                    value={truncateFrom}
                  />
                </div>
                <div className="space-y-2">
                  <Label>To</Label>
                  <Input
                    onChange={(e) => setTruncateTo(e.target.value)}
                    type="datetime-local"
                    value={truncateTo}
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        className="flex-1"
                        disabled={
                          isTruncating || (!truncateFrom && !truncateTo)
                        }
                        variant="destructive"
                      >
                        {isTruncating && <Spinner className="mr-1 size-4" />}
                        Delete Logs
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Truncate audit logs?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently deletes audit logs{" "}
                          {truncateFrom
                            ? `from ${format(new Date(truncateFrom), "MMM d, yyyy HH:mm")}`
                            : "from the beginning"}{" "}
                          {truncateTo
                            ? `up to ${format(new Date(truncateTo), "MMM d, yyyy HH:mm")}`
                            : "up to now"}
                          . This destroys the forensic trail for that period and
                          cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="text-destructive-foreground bg-destructive hover:bg-destructive/90"
                          onClick={handleTruncate}
                        >
                          Delete Logs
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : logs.length === 0 ? (
        <Empty>
          <EmptyMedia variant="icon">
            <ClockCounterClockwiseIcon className="size-5" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No audit logs found</EmptyTitle>
            <EmptyDescription>
              {hasFilters
                ? "Try adjusting your filters."
                : "No audit logs have been recorded yet."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <Fragment key={log.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() =>
                        setExpandedId(expandedId === log.id ? null : log.id)
                      }
                    >
                      <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {format(
                          new Date(log.createdAt),
                          "MMM d, yyyy HH:mm:ss"
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium">
                        {log.action}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`text-xs ${categoryColors[log.category] ?? ""}`}
                          variant="secondary"
                        >
                          {log.category.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-sm">
                        {log.actorEmail ?? log.actorType}
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-sm text-muted-foreground">
                        {log.description ?? "-"}
                      </TableCell>
                      <TableCell>
                        <Badge className="text-xs" variant="outline">
                          {log.source}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {expandedId === log.id && (
                      <TableRow>
                        <TableCell className="bg-muted/30 p-4" colSpan={6}>
                          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
                            <div>
                              <span className="text-muted-foreground">
                                Entity:{" "}
                              </span>
                              <span className="font-mono">
                                {log.entityType}
                                {log.entityId ? `:${log.entityId}` : ""}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                Space:{" "}
                              </span>
                              <span className="font-mono">
                                {log.spaceId ?? "-"}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                Actor ID:{" "}
                              </span>
                              <span className="font-mono">
                                {log.actorId ?? "-"}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">
                                IP:{" "}
                              </span>
                              <span className="font-mono">
                                {log.ipAddress ?? "-"}
                              </span>
                            </div>
                            <div className="col-span-2">
                              <span className="text-muted-foreground">
                                User Agent:{" "}
                              </span>
                              <span className="text-xs break-all">
                                {log.userAgent ?? "-"}
                              </span>
                            </div>
                            {log.metadata && (
                              <div className="col-span-full">
                                <span className="text-muted-foreground">
                                  Metadata:{" "}
                                </span>
                                <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
                                  {JSON.stringify(log.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          <TablePagination
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            page={page}
            pageSize={pageSize}
            total={pagination.total}
          />
        </>
      )}
    </div>
  );
}
