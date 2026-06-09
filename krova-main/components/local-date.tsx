"use client";

import { format, formatDistanceToNow } from "date-fns";

interface LocalDateProps {
  /**
   * The date to render. Accepts an ISO 8601 string, a `Date`, or an epoch
   * number. `null` / `undefined` / unparseable values render as `"—"`.
   */
  iso: string | Date | number | null | undefined;
  /**
   * Display mode:
   *   - "absolute" (default) — "MMM d, yyyy HH:mm"
   *   - "relative" — "3 days ago", with the full absolute timestamp in the
   *     tooltip (so hovering reveals the exact moment).
   *   - "date" — "MMM d, yyyy" (no time component).
   */
  mode?: "absolute" | "relative" | "date";
}

/**
 * Renders a timestamp in the BROWSER's local timezone. Per CLAUDE.md Rule 25
 * (store UTC, display local), every customer- and operator-facing timestamp
 * MUST go through this component instead of an inline `format()` /
 * `toLocaleString()` call, because those run in the server's timezone (UTC)
 * during SSR and silently mislead users in any other timezone.
 *
 * `suppressHydrationWarning` is intentional: SSR emits the UTC representation
 * and hydration replaces it with the local one — that mismatch is the whole
 * point of this component, not a bug. The `<time dateTime>` wrapper keeps
 * the markup semantically correct + copy-paste-friendly.
 */
export function LocalDate({ iso, mode = "absolute" }: LocalDateProps) {
  if (iso == null) {
    return <>—</>;
  }
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return <>—</>;
  }
  const isoString = d.toISOString();

  if (mode === "relative") {
    return (
      <time
        dateTime={isoString}
        suppressHydrationWarning
        title={format(d, "PPpp")}
      >
        {formatDistanceToNow(d, { addSuffix: true })}
      </time>
    );
  }
  if (mode === "date") {
    return (
      <time dateTime={isoString} suppressHydrationWarning>
        {format(d, "MMM d, yyyy")}
      </time>
    );
  }
  return (
    <time dateTime={isoString} suppressHydrationWarning>
      {format(d, "MMM d, yyyy HH:mm")}
    </time>
  );
}
