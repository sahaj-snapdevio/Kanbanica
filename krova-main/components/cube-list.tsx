"use client";

import {
  CheckIcon,
  CubeIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { CubeTableRow } from "@/components/cube-table-row";
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
import { Input } from "@/components/ui/input";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/ui/page-header";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import type { CubeStatusValue } from "@/db/schema/types";
import { useSpaceCubeStatuses } from "@/hooks/use-space-cube-statuses";
import { CUBE_STATUS_FILTER_OPTIONS } from "@/lib/status-display";
import { cn } from "@/lib/utils";

interface CubeData {
  costPerHour: number;
  createdAt: string;
  customDomain: { domain: string; cloudflareStatus: string | null } | null;
  id: string;
  name: string;
  ramMb: number;
  region: string;
  serverDomain: string;
  status: CubeStatusValue;
  transferState?: string | null;
  vcpus: number;
}

interface CubeListProps {
  actions?: React.ReactNode;
  cubes: CubeData[];
  spaceId: string;
}

export function CubeList({ cubes, spaceId, actions }: CubeListProps) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const liveStatuses = useSpaceCubeStatuses(spaceId);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return cubes.filter((cube) => {
      if (statusFilter !== "all") {
        const live = liveStatuses[cube.id] ?? cube.status;
        if (live !== statusFilter) {
          return false;
        }
      }
      if (needle) {
        const haystack = [
          cube.name,
          cube.region,
          cube.customDomain?.domain ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) {
          return false;
        }
      }
      return true;
    });
  }, [cubes, statusFilter, liveStatuses, search]);

  // Reset to page 1 when filters/search/pageSize change. "Adjust state during
  // render" pattern (CLAUDE.md Rule 29) — avoids the useEffect set-state lint.
  const resetKey = `${statusFilter}|${search}|${pageSize}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setPage(1);
  }

  const pageWindow = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const activeStatusLabel = CUBE_STATUS_FILTER_OPTIONS.find(
    (o) => o.value === statusFilter
  );

  return (
    <div className="space-y-4">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Cubes</PageHeaderTitle>
          <PageHeaderDescription>
            Spin up a cube and manage its lifecycle.
          </PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          <div className="relative w-full sm:w-64">
            <MagnifyingGlassIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="pl-8"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cubes…"
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <FunnelIcon className="size-4" />
                {activeStatusLabel?.label ?? "All statuses"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {CUBE_STATUS_FILTER_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                >
                  <span>{opt.label}</span>
                  {opt.value === statusFilter && (
                    <CheckIcon className={cn("ml-auto size-4")} />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {actions}
        </PageHeaderActions>
      </PageHeader>

      {filtered.length === 0 ? (
        <Empty className="min-h-50 rounded-lg border">
          <EmptyHeader>
            <EmptyMedia>
              <CubeIcon className="size-10 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>No matching items</EmptyTitle>
            <EmptyDescription>
              No cubes match the selected filters.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Resources</TableHead>
                  <TableHead>Cost/hr</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageWindow.map((cube) => (
                  <CubeTableRow
                    cube={cube}
                    key={cube.id}
                    liveStatus={liveStatuses[cube.id]}
                    spaceId={spaceId}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          <TablePagination
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            page={page}
            pageSize={pageSize}
            total={filtered.length}
          />
        </>
      )}
    </div>
  );
}
