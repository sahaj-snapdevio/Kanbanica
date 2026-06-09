"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * URL-synced active-tab state for the shadcn/radix `<Tabs>` primitive.
 *
 * Spread the returned object onto `<Tabs {...tabParam}>` to make a tab group
 * controlled by a search param (default `tab`). The active tab is read from
 * the URL so a refresh or a deep-link lands on the same tab instead of
 * snapping back to the first one.
 *
 * On switch the new value is written with the native History API
 * (`replaceState`) rather than `router.push`/`router.replace`. Next.js keeps
 * `useSearchParams` in sync with native History calls, so the controlled
 * `<Tabs>` re-renders to the new tab WITHOUT a server round-trip — switching
 * stays instant (no refetch of the page's server component, no scroll jump,
 * no loading flash). `router.push` is the right tool when the param drives a
 * server-side query (e.g. the audit-log filters); a view-only tab is not that.
 *
 * The param is omitted from the URL while the fallback tab is active so the
 * default view keeps a clean URL; only non-default tabs add `?tab=…`.
 *
 * @param validValues The set of tab values; an unknown/absent param falls back.
 * @param fallback    The tab shown when the param is absent or invalid.
 * @param paramKey    The search-param name (default `tab`).
 */
export function useTabParam(
  validValues: readonly string[],
  fallback: string,
  paramKey = "tab"
): { value: string; onValueChange: (next: string) => void } {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get(paramKey);
  const value = raw && validValues.includes(raw) ? raw : fallback;

  const onValueChange = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === fallback) {
        params.delete(paramKey);
      } else {
        params.set(paramKey, next);
      }
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        qs ? `${pathname}?${qs}` : pathname
      );
    },
    [searchParams, pathname, paramKey, fallback]
  );

  return { value, onValueChange };
}
