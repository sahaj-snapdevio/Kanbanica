"use client";

import { openConsentBanner } from "@/lib/cookie-consent";

/**
 * Re-opens the cookie-consent banner so a visitor can change or withdraw their
 * choice at any time (as the Cookie Policy promises). Rendered in the public
 * footer; harmless when GTM is unconfigured (the banner simply won't show).
 */
export function CookieSettingsLink({ className }: { className?: string }) {
  return (
    <button className={className} onClick={openConsentBanner} type="button">
      Cookie settings
    </button>
  );
}
