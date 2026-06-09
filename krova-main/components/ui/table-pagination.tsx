"use client"

import * as React from "react"
import { CaretDownIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { cn } from "@/lib/utils"

/**
 * Standardised pagination bar — used by `<DataTable>` and by custom tables
 * that prefer to keep their own row markup. Layout (per platform spec):
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │  Page X of Y    Rows per page [10 ▾]      «Prev  [3] [4] [5]  Next» │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * - Bottom-LEFT  : "Page X of Y" + per-page dropdown (10/25/50/100, max 100).
 * - Bottom-RIGHT : Previous + a 3-page sliding window centered on the current
 *                  page + Next. No first/last/ellipsis — just the three
 *                  closest pages around current.
 *
 * Always controlled — caller owns page + pageSize state. The per-page
 * selector is hidden when `pageSizeOptions` is empty or when no
 * `onPageSizeChange` handler is provided.
 */

export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

export interface TablePaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (next: number) => void
  onPageSizeChange?: (next: number) => void
  pageSizeOptions?: readonly number[]
  className?: string
}

/**
 * 3-page sliding window of visible page numbers, centered on `current`
 * when possible. For `totalPages <= 3` returns all pages.
 *
 * Examples:
 *   current=1,  total=10 → [1, 2, 3]
 *   current=2,  total=10 → [1, 2, 3]
 *   current=5,  total=10 → [4, 5, 6]
 *   current=10, total=10 → [8, 9, 10]
 *   current=1,  total=2  → [1, 2]
 */
export function paginationRange(
  current: number,
  totalPages: number
): number[] {
  if (totalPages <= 3) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  let start = current - 1
  let end = current + 1
  if (start < 1) {
    start = 1
    end = 3
  }
  if (end > totalPages) {
    end = totalPages
    start = totalPages - 2
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

function PageSizeSelect({
  value,
  options,
  onChange,
}: {
  value: number
  options: readonly number[]
  onChange: (next: number) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Rows per page"
          variant="outline"
          size="sm"
          className="h-8 w-20 justify-between font-normal"
        >
          <span className="font-mono tabular-nums">{value}</span>
          <CaretDownIcon className="size-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-20">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt}
            onSelect={() => onChange(opt)}
            className="font-mono tabular-nums"
          >
            {opt}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  className,
}: TablePaginationProps) {
  if (total <= 0 || pageSize <= 0) return null

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const showPageSizeSelector =
    pageSizeOptions.length > 0 && onPageSizeChange !== undefined

  const handlePageClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    next: number
  ) => {
    e.preventDefault()
    if (next === page) return
    onPageChange(Math.max(1, Math.min(pageCount, next)))
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      {/* Bottom-left: "Page X of Y" + per-page selector */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <p>
          {"Page "}
          <span className="font-mono tabular-nums">{page}</span>
          {" of "}
          <span className="font-mono tabular-nums">{pageCount}</span>
        </p>
        {showPageSizeSelector && (
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <PageSizeSelect
              value={pageSize}
              options={pageSizeOptions}
              onChange={onPageSizeChange}
            />
          </div>
        )}
      </div>
      {/* Bottom-right: Prev + 3-page numeric window + Next */}
      {pageCount > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                aria-disabled={page <= 1}
                className={
                  page <= 1 ? "pointer-events-none opacity-50" : undefined
                }
                onClick={(e) => handlePageClick(e, page - 1)}
              />
            </PaginationItem>
            {paginationRange(page, pageCount).map((item) => (
              <PaginationItem key={item}>
                <PaginationLink
                  href="#"
                  isActive={item === page}
                  onClick={(e) => handlePageClick(e, item)}
                >
                  {item}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href="#"
                aria-disabled={page >= pageCount}
                className={
                  page >= pageCount
                    ? "pointer-events-none opacity-50"
                    : undefined
                }
                onClick={(e) => handlePageClick(e, page + 1)}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  )
}
