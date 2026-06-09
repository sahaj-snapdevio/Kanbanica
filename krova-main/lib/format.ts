/**
 * Display formatters shared across the UI. Keep PURE: no DOM, no React, no
 * server-side imports — these run in client components, server components,
 * and email renderers alike.
 */

/**
 * Format a byte count for human display. Returns the em-dash placeholder
 * `"—"` for `null`/`undefined`/`0` so callers can drop `?? "—"` ceremony.
 *
 * Uses binary (1024-based) units. Decimal places scale per unit so KB
 * doesn't show distracting fractions while GB stays precise.
 *
 *   formatBytes(512)         → "512 B"
 *   formatBytes(2048)        → "2.0 KB"
 *   formatBytes(5_242_880)   → "5.0 MB"
 *   formatBytes(2_147_483_648) → "2.00 GB"
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Format a USD value from a `numeric(12,4)` DB string or a JS number.
 * Strips trailing-zero decimals so `"10.0000"` renders as `"10"` and
 * `"10.5000"` renders as `"10.5"`. Caps display at the requested precision
 * (default 2dp) so a stray fraction never shows up as `"10.555"`.
 *
 * Returns `"0"` for non-finite inputs so call sites don't render `"NaN"`.
 *
 * Use `precision: "balance"` (2dp) for prices, balances, totals — the
 * customer-facing default. Use `precision: "rate"` (4dp) for per-hour
 * usage rates where the small fractions actually matter.
 */
export function fmtUsd(
  value: string | number,
  opts: { precision?: "balance" | "rate" } = {}
): string {
  const n = typeof value === "string" ? Number.parseFloat(value) : value;
  if (!Number.isFinite(n)) {
    return "0";
  }
  if (Number.isInteger(n)) {
    return String(n);
  }
  const dp = opts.precision === "rate" ? 4 : 2;
  return n.toFixed(dp).replace(/\.?0+$/, "");
}
