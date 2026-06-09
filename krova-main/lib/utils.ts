import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Resolve after `ms` milliseconds. Shared so the
 * `new Promise((resolve) => setTimeout(resolve, ms))` idiom isn't re-spelled
 * in every poll/retry loop.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Convert a user-facing cube name into a valid RFC-1123 hostname label:
 * lowercase, only [a-z0-9-], no leading/trailing hyphen, max 63 chars.
 *
 * Falls back to `cube-<id prefix>` when the name has no usable characters
 * (e.g. a name that is entirely emoji or punctuation). CUID2 ids are lowercase
 * alphanumeric, so the fallback is always itself a valid label.
 */
export function slugifyHostname(name: string, fallbackId: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 63)
    .replace(/-+$/, "")
  return slug || `cube-${fallbackId.slice(0, 8).toLowerCase()}`
}

/**
 * Render a long provider id (Polar customer ids, subscription ids, etc.) in
 * a compact `prefix…suffix` form for table cells. Strings ≤14 chars are
 * returned unchanged; null/undefined renders as the em-dash placeholder so
 * the call site can drop `value ?? "—"` ceremony.
 */
export function truncateId(id: string | null | undefined): string {
  if (!id) {
    return "—"
  }
  if (id.length <= 14) {
    return id
  }
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}
