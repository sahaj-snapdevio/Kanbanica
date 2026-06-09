"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
import {
  AnalyticsProvider as BaseAnalyticsProvider,
  useAnalytics,
} from "use-analytics";

import { getOrCreateAnalytics } from "@/lib/analytics";
import { isAnalyticsAllowedPath } from "@/lib/analytics-scope";

function PageTracker() {
  const pathname = usePathname();
  const analytics = useAnalytics();
  useEffect(() => {
    // GTM is customer-facing only — never record Orbit-admin navigations,
    // even if the container lingered from an earlier customer-page visit.
    if (!isAnalyticsAllowedPath(pathname ?? "")) {
      return;
    }
    void analytics?.page({ path: pathname });
  }, [pathname, analytics]);
  return null;
}

export function AnalyticsProvider({
  containerId,
  children,
}: {
  containerId?: string;
  children: React.ReactNode;
}) {
  const instance = useMemo(
    () => getOrCreateAnalytics(containerId),
    [containerId]
  );

  if (!instance) {
    return children;
  }

  return (
    <BaseAnalyticsProvider instance={instance}>
      <PageTracker />
      {children}
    </BaseAnalyticsProvider>
  );
}
