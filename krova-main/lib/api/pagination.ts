/**
 * Shared pagination utilities for API routes.
 *
 * Extracts page/limit from URL search params with bounds checking,
 * and builds a standard pagination response object.
 */

const DEFAULT_MAX_PAGE_SIZE = 100;
// Default page size = 10 across the platform — matches the UI DataTable
// default. Callers may override via `defaultPageSize` or via the `limit`
// query param (bounded by DEFAULT_MAX_PAGE_SIZE).
const DEFAULT_PAGE_SIZE = 10;

export type PaginationParams = {
  page: number;
  limit: number;
  offset: number;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

/**
 * Parse pagination params from a URL's search params.
 * Returns { page, limit, offset } with sane defaults and bounds.
 */
export function parsePagination(
  url: URL,
  options?: { maxPageSize?: number; defaultPageSize?: number }
): PaginationParams {
  const maxPageSize = options?.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE;
  const defaultPageSize = options?.defaultPageSize ?? DEFAULT_PAGE_SIZE;

  const page = Math.max(
    1,
    Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1
  );
  const limit = Math.min(
    maxPageSize,
    Math.max(
      1,
      Number.parseInt(
        url.searchParams.get("limit") ?? String(defaultPageSize),
        10
      ) || defaultPageSize
    )
  );
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Build a standard pagination metadata object for API responses.
 */
export function paginationMeta(
  total: number,
  params: Pick<PaginationParams, "page" | "limit">
): PaginationMeta {
  return {
    page: params.page,
    limit: params.limit,
    total,
    totalPages: Math.ceil(total / params.limit),
  };
}
