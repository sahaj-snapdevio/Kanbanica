"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { PRODUCT_NAME } from "@/config/platform";
import { isAnalyticsAllowedPath } from "@/lib/analytics-scope";
import {
  CONSENT_DENIED,
  CONSENT_GRANTED,
  consentServerSnapshot,
  consentSnapshot,
  saveConsent,
  subscribeConsent,
} from "@/lib/cookie-consent";

/**
 * Cookie-consent banner. Renders only when GTM is configured and the visitor
 * has not yet made a choice (or has re-opened "Cookie settings"). Choices flow
 * through Google Consent Mode v2 — analytics cookies stay denied until the
 * visitor accepts. Visibility is read from an external store via
 * `useSyncExternalStore` so there is no setState-in-effect and no hydration
 * flash for visitors who already chose.
 */
export function CookieConsent({ enabled }: { enabled: boolean }) {
  const visible = useSyncExternalStore(
    subscribeConsent,
    consentSnapshot,
    consentServerSnapshot
  );
  const pathname = usePathname();

  // The banner only governs GTM analytics cookies, and GTM is customer-facing
  // only — never show it on the Orbit operator admin.
  if (!(enabled && visible && isAnalyticsAllowedPath(pathname ?? ""))) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {PRODUCT_NAME} uses essential cookies to run the site, plus optional
          analytics cookies (Google Analytics via Google Tag Manager) to
          understand usage. Analytics stay off until you accept. See our{" "}
          <Link className="text-primary hover:underline" href="/cookies">
            Cookie Policy
          </Link>{" "}
          and{" "}
          <Link className="text-primary hover:underline" href="/privacy">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            onClick={() => saveConsent(CONSENT_DENIED)}
            size="sm"
            variant="outline"
          >
            Decline
          </Button>
          <Button onClick={() => saveConsent(CONSENT_GRANTED)} size="sm">
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
