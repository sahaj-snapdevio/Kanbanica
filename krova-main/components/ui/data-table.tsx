"use client"

import * as React from "react"
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  DEFAULT_PAGE_SIZE_OPTIONS,
  TablePagination,
} from "@/components/ui/table-pagination"

/**
 * Generic DataTable. Composes the search input, custom filter/action slot,
 * the `<Table>` row markup, and the standardised pagination bar.
 *
 * Layout (platform-wide spec):
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ [search...                  ]            [filters] [buttons]        │
 *   ├─────────────────────────────────────────────────────────────────────┤
 *   │ ... table rows ...                                                  │
 *   ├─────────────────────────────────────────────────────────────────────┤
 *   │ Page X of Y  Rows per page [10 ▾]        «Prev [3] [4] [5] Next»    │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * - Columns are declarative: `{ id, header, cell: (row) => ReactNode }`.
 * - Default page size is 10 (the per-page selector exposes 10/25/50/100).
 * - Search is client-side when `searchAccessor` is passed; controlled when
 *   `searchValue` + `onSearchChange` are passed.
 * - Pagination is client-side by default; pass `pagination` +
 *   `onPageChange` (+ optional `onPageSizeChange`) for server-side mode.
 * - Filters + action buttons live in the `toolbarRight` slot.
 */

export interface DataTableColumn<T> {
  id: string
  header: React.ReactNode
  cell: (row: T, index: number) => React.ReactNode
  /** Tailwind class applied to both TH and TD for this column (e.g. width, alignment). */
  className?: string
  /** Right-align + monospace tabular numbers — convenience for numeric columns. */
  numeric?: boolean
}

export interface DataTablePagination {
  page: number
  pageSize: number
  total: number
}

export interface DataTableProps<T> {
  data: T[]
  columns: DataTableColumn<T>[]
  /** Unique row identifier — used for React keys. */
  rowKey: (row: T, index: number) => string
  /** Make rows clickable. */
  onRowClick?: (row: T) => void

  /** Search — client-side mode: pass an accessor that returns a string per row. */
  searchAccessor?: (row: T) => string
  /** Search — controlled mode: pass searchValue + onSearchChange. */
  searchValue?: string
  onSearchChange?: (next: string) => void
  searchPlaceholder?: string

  /** Filters + action buttons rendered top-right. */
  toolbarRight?: React.ReactNode

  /** Initial page size for client-side pagination (default 10). 0 disables pagination. */
  pageSize?: number
  /** Per-page options shown in the dropdown. Default [10, 25, 50, 100] — max
   *  allowed value is 100 per UX spec. Set to an empty array to hide the
   *  selector entirely. */
  pageSizeOptions?: readonly number[]
  /** Server-side pagination — pass current page + pageSize + total count. */
  pagination?: DataTablePagination
  /** Called when the user clicks a page number / prev / next. */
  onPageChange?: (next: number) => void
  /** Called when the user picks a new page size in the per-page dropdown.
   *  Required for server-side mode if `pageSizeOptions` is non-empty —
   *  without it the per-page selector is hidden in server-side mode. */
  onPageSizeChange?: (next: number) => void

  /** Empty state — falls back to a generic "No results" block when omitted. */
  empty?: React.ReactNode
  emptyTitle?: string
  emptyDescription?: string

  /** Loading state — render skeleton rows when true. */
  loading?: boolean
  loadingRows?: number

  className?: string
}

const DEFAULT_PAGE_SIZE = 10

function DataTableSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <MagnifyingGlassIcon
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Search..."}
        className="pl-8"
      />
      {value && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
        >
          <XIcon className="size-3.5" />
        </Button>
      )}
    </div>
  )
}

export function DataTable<T>({
  data,
  columns,
  rowKey,
  onRowClick,
  searchAccessor,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  toolbarRight,
  pageSize: pageSizeProp = DEFAULT_PAGE_SIZE,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  pagination,
  onPageChange,
  onPageSizeChange,
  empty,
  emptyTitle,
  emptyDescription,
  loading,
  loadingRows = 5,
  className,
}: DataTableProps<T>) {
  // Internal search state used only when the caller did not pass a controlled
  // searchValue. searchAccessor opts the table into client-side filtering.
  const [internalSearch, setInternalSearch] = React.useState("")
  const search = searchValue ?? internalSearch
  const setSearch = onSearchChange ?? setInternalSearch
  const searchEnabled = !!searchAccessor || onSearchChange !== undefined

  // Internal page state used only when the caller did not pass a controlled
  // pagination prop. pageSize > 0 opts the table into client-side pagination.
  const [internalPage, setInternalPage] = React.useState(1)
  const [internalPageSize, setInternalPageSize] =
    React.useState<number>(pageSizeProp)
  const page = pagination?.page ?? internalPage
  const setPage = onPageChange ?? setInternalPage
  const effectivePageSize = pagination?.pageSize ?? internalPageSize

  // Reset the page when the search input changes the filtered working set.
  // "Adjust state during render" (CLAUDE.md Rule 29) instead of useEffect.
  const [prevSearch, setPrevSearch] = React.useState(internalSearch)
  if (internalSearch !== prevSearch) {
    setPrevSearch(internalSearch)
    setInternalPage(1)
  }

  // Reset the page when the per-page size changes (client-side only).
  const [prevPageSize, setPrevPageSize] = React.useState(internalPageSize)
  if (internalPageSize !== prevPageSize) {
    setPrevPageSize(internalPageSize)
    setInternalPage(1)
  }

  // Client-side filter.
  const filteredData = React.useMemo(() => {
    if (!searchAccessor || !search.trim()) return data
    const needle = search.trim().toLowerCase()
    return data.filter((row) =>
      searchAccessor(row).toLowerCase().includes(needle)
    )
  }, [data, searchAccessor, search])

  // Client-side page-window.
  const pageWindow = React.useMemo(() => {
    // Server-side mode — caller is responsible for paging. But if the
    // server over-fetched (e.g. initial-render data length > pageSize), do
    // a defensive client-side slice so the rendered row count never
    // contradicts the pagination bar. A warn fires once per render so the
    // misconfigured caller surfaces in dev.
    if (pagination) {
      if (
        pagination.pageSize > 0 &&
        filteredData.length > pagination.pageSize
      ) {
        if (typeof console !== "undefined") {
          console.warn(
            `<DataTable /> in server-pagination mode received ${filteredData.length} rows but pageSize=${pagination.pageSize}. Truncating client-side. Have the data source paginate.`,
          )
        }
        return filteredData.slice(0, pagination.pageSize)
      }
      return filteredData
    }
    if (!effectivePageSize) return filteredData
    const start = (page - 1) * effectivePageSize
    return filteredData.slice(start, start + effectivePageSize)
  }, [filteredData, page, effectivePageSize, pagination])

  const total = pagination?.total ?? filteredData.length
  const showPagination = effectivePageSize > 0 && total > 0

  const setPageSize = onPageSizeChange ?? setInternalPageSize
  // Server-side mode: hide the per-page selector if the caller did not
  // provide `onPageSizeChange` (no point silently no-op-ing a click).
  // Client-side mode: always allow the selector.
  const pageSizeHandler =
    pagination && !onPageSizeChange ? undefined : setPageSize

  const showToolbar = !!toolbarRight || searchEnabled

  return (
    <div className={cn("space-y-3", className)}>
      {showToolbar && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Top-left: search */}
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {searchEnabled && (
              <DataTableSearch
                value={search}
                onChange={setSearch}
                placeholder={searchPlaceholder}
              />
            )}
          </div>
          {/* Top-right: filters + action buttons */}
          {toolbarRight && (
            <div className="flex flex-wrap items-center gap-2">
              {toolbarRight}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.id} className={c.className}>
                    {c.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: loadingRows }, (_, i) => i).map((i) => (
                <TableRow key={`skeleton-${i}`}>
                  {columns.map((c) => (
                    <TableCell key={c.id} className={c.className}>
                      <div className="h-3 w-full max-w-32 animate-pulse rounded bg-muted/60" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : pageWindow.length === 0 ? (
        (empty ?? (
          <div className="rounded-md border">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MagnifyingGlassIcon />
                </EmptyMedia>
                <EmptyTitle>{emptyTitle ?? "No results"}</EmptyTitle>
                <EmptyDescription>
                  {emptyDescription ??
                    (search
                      ? "Try a different search term."
                      : "Nothing here yet.")}
                </EmptyDescription>
              </EmptyHeader>
              {search && (
                <EmptyContent>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSearch("")}
                  >
                    Clear search
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          </div>
        ))
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead
                    key={c.id}
                    className={cn(
                      c.numeric && "text-right font-mono tabular-nums",
                      c.className
                    )}
                  >
                    {c.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageWindow.map((row, index) => (
                <TableRow
                  key={rowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? "cursor-pointer" : undefined}
                >
                  {columns.map((c) => (
                    <TableCell
                      key={c.id}
                      className={cn(
                        c.numeric && "text-right font-mono tabular-nums",
                        c.className
                      )}
                    >
                      {c.cell(row, index)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {showPagination && (
        <TablePagination
          page={page}
          pageSize={effectivePageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={pageSizeHandler}
          pageSizeOptions={pageSizeOptions}
        />
      )}
    </div>
  )
}
