"use client";

import {
  CaretDownIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  CodeIcon,
  CubeIcon,
  CurrencyDollarIcon,
  DownloadSimpleIcon,
  FunnelIcon,
  GlobeIcon,
  KeyIcon,
  LightningIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { fetcher } from "@/lib/fetcher";

interface AuditLog {
  action: string;
  actorEmail: string | null;
  actorId: string | null;
  actorName: string | null;
  actorType: string;
  category: string;
  createdAt: string;
  description: string | null;
  entityId: string | null;
  entityType: string;
  id: string;
  keyPrefix: string | null;
  metadata: Record<string, unknown> | null;
  source: string;
  spaceId: string;
}

interface AuditLogsResponse {
  data: AuditLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface AuditLogViewerProps {
  spaceId: string;
}

const categoryIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  auth: ShieldCheckIcon,
  cube: CubeIcon,
  space: UsersIcon,
  member: UserIcon,
  invite: UsersIcon,
  billing: CurrencyDollarIcon,
  domain: GlobeIcon,
  tcp_mapping: GlobeIcon,
  ssh_key: KeyIcon,
  app: CodeIcon,
  server: ShieldCheckIcon,
  platform: ShieldCheckIcon,
  webhook: LightningIcon,
};

const sourceColors: Record<string, string> = {
  web: "bg-secondary text-secondary-foreground",
  api: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  worker: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  system: "bg-muted text-muted-foreground",
};

const CATEGORIES = [
  "auth",
  "cube",
  "space",
  "member",
  "invite",
  "billing",
  "domain",
  "tcp_mapping",
  "ssh_key",
  "app",
  "server",
  "platform",
  "webhook",
];

const SOURCES = ["web", "api", "worker", "system"];

function buildUrl(spaceId: string, params: URLSearchParams): string {
  const query = params.toString();
  return `/api/spaces/${spaceId}/audit-logs${query ? `?${query}` : ""}`;
}

export function AuditLogViewer({ spaceId }: AuditLogViewerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const limit = Math.min(
    100,
    Math.max(1, Number(searchParams.get("limit") ?? "10"))
  );
  const category = searchParams.get("category") ?? "";
  const source = searchParams.get("source") ?? "";

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      // Reset to page 1 on filter change
      if (key !== "page") {
        next.delete("page");
      }
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [searchParams, pathname, router]
  );

  const goPage = useCallback(
    (newPage: number) => {
      setParam("page", String(newPage));
    },
    [setParam]
  );

  const setLimit = useCallback(
    (newLimit: number) => {
      // Per-page change always resets to page 1 so the user does not land
      // past the new last page.
      const next = new URLSearchParams(searchParams);
      next.set("limit", String(newLimit));
      next.delete("page");
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [searchParams, pathname, router]
  );

  const url = buildUrl(
    spaceId,
    new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...(category ? { category } : {}),
      ...(source ? { source } : {}),
    })
  );

  const { data, error, isLoading } = useSWR<AuditLogsResponse>(url, fetcher);

  const pagination = data?.pagination;

  const [search, setSearch] = useState("");

  // useMemo wraps the filter so `logs` is referentially stable when the
  // server response and search are unchanged. We pull `allLogs` from `data`
  // inside the memo (not at the top of the closure) so its reference can
  // only change when SWR hands us new data, satisfying exhaustive-deps.
  const logs = useMemo(() => {
    const allLogs = data?.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return allLogs;
    }
    return allLogs.filter((l) =>
      [
        l.action,
        l.description ?? "",
        l.actorEmail ?? "",
        l.actorName ?? "",
        l.entityType,
        l.entityId ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [data, search]);

  const hasActiveFilters = category || source || search;

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
      "entityType",
      "entityId",
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
        l.entityType,
        l.entityId,
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
    a.download = `audit-logs-${spaceId}-page-${page}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-8 text-center text-sm text-destructive">
        Failed to load audit logs.
      </p>
    );
  }

  return (
    <DataTable
      columns={[
        {
          id: "icon",
          header: "",
          className: "w-10",
          cell: (log) => {
            const Icon =
              categoryIcons[log.category] ?? ClockCounterClockwiseIcon;
            return <Icon className="size-4 text-muted-foreground" />;
          },
        },
        {
          id: "action",
          header: "Action",
          cell: (log) => (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{log.action}</span>
              <Badge className="text-[10px]" variant="secondary">
                {log.category}
              </Badge>
            </div>
          ),
        },
        {
          id: "description",
          header: "Description",
          className: "max-w-xs",
          cell: (log) => (
            <p className="truncate text-xs text-muted-foreground">
              {log.description ?? log.action}
            </p>
          ),
        },
        {
          id: "actor",
          header: "Actor",
          cell: (log) => (
            <div className="text-xs">
              {log.actorName ? (
                <span className="font-medium">{log.actorName}</span>
              ) : (
                <span className="text-muted-foreground">System</span>
              )}
              {log.keyPrefix && (
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                  ({log.keyPrefix}****)
                </span>
              )}
            </div>
          ),
        },
        {
          id: "source",
          header: "Source",
          cell: (log) => (
            <Badge
              className={`text-[10px] ${sourceColors[log.source] ?? ""}`}
              variant="secondary"
            >
              {log.source}
            </Badge>
          ),
        },
        {
          id: "when",
          header: "When",
          className: "text-right whitespace-nowrap",
          cell: (log) => (
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(log.createdAt), {
                addSuffix: true,
              })}
            </span>
          ),
        },
      ]}
      data={logs}
      emptyDescription={
        hasActiveFilters
          ? "Try adjusting your filters."
          : "Audit log entries will appear here as actions happen in this space."
      }
      emptyTitle="No audit logs found"
      onPageChange={goPage}
      onPageSizeChange={setLimit}
      onSearchChange={setSearch}
      pagination={
        pagination
          ? { page, pageSize: limit, total: pagination.total }
          : undefined
      }
      rowKey={(log) => log.id}
      searchPlaceholder="Search action / actor / entity…"
      searchValue={search}
      toolbarRight={
        <>
          <div className="flex items-center gap-1.5">
            <FunnelIcon className="size-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              Filters
            </span>
          </div>
          <CategoryDropdown
            onChange={(v) => setParam("category", v === "all" ? "" : v)}
            value={category}
          />
          <SourceDropdown
            onChange={(v) => setParam("source", v === "all" ? "" : v)}
            value={source}
          />
          {hasActiveFilters && (
            <Button
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              onClick={() => {
                setSearch("");
                const next = new URLSearchParams();
                router.push(`${pathname}?${next.toString()}`, {
                  scroll: false,
                });
              }}
              size="sm"
              variant="ghost"
            >
              <XIcon className="size-3" />
              Clear
            </Button>
          )}
          <Button
            disabled={logs.length === 0}
            onClick={handleExportCsv}
            size="sm"
            title="Download current page as CSV"
            variant="outline"
          >
            <DownloadSimpleIcon className="size-4" />
            Export CSV
          </Button>
        </>
      }
    />
  );
}

function CategoryDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = value ? value.replace(/_/g, " ") : "All categories";

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-8 w-36 justify-between text-xs"
          size="sm"
          variant="outline"
        >
          {label}
          <CaretDownIcon className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        <DropdownMenuItem
          className="text-xs"
          onClick={() => {
            onChange("all");
            setOpen(false);
          }}
        >
          {!value && <CheckIcon className="mr-1.5 size-3" />}
          All categories
        </DropdownMenuItem>
        {CATEGORIES.map((c) => (
          <DropdownMenuItem
            className="text-xs capitalize"
            key={c}
            onClick={() => {
              onChange(c);
              setOpen(false);
            }}
          >
            {value === c && <CheckIcon className="mr-1.5 size-3" />}
            {c.replace(/_/g, " ")}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SourceDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = value ? value : "All sources";

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger asChild>
        <Button
          className="h-8 w-32 justify-between text-xs"
          size="sm"
          variant="outline"
        >
          {label}
          <CaretDownIcon className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-32">
        <DropdownMenuItem
          className="text-xs"
          onClick={() => {
            onChange("all");
            setOpen(false);
          }}
        >
          {!value && <CheckIcon className="mr-1.5 size-3" />}
          All sources
        </DropdownMenuItem>
        {SOURCES.map((s) => (
          <DropdownMenuItem
            className="text-xs capitalize"
            key={s}
            onClick={() => {
              onChange(s);
              setOpen(false);
            }}
          >
            {value === s && <CheckIcon className="mr-1.5 size-3" />}
            {s}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
