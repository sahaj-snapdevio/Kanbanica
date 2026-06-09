"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";

import { isAnalyticsAllowedPath } from "@/lib/analytics-scope";

/**
 * Client-side Google Tag Manager container loader. The root layout is a server
 * component and cannot read the pathname, so the actual container `<Script>` +
 * `<noscript>` fallback live here, gated on `isAnalyticsAllowedPath` — GTM loads
 * on every customer-facing route but never on the Orbit operator admin
 * (`/orbit/*`).
 *
 * The Consent Mode v2 default (everything denied) stays as a `beforeInteractive`
 * script in the root layout: it is inert without the container, and its
 * load-order contract (default set before the container loads) is preserved
 * because `beforeInteractive` always runs ahead of this `afterInteractive`
 * container init.
 *
 * Once the container has loaded on a customer page, next/script de-dupes by id,
 * so an in-tab SPA navigation into Orbit will not re-inject it; the PageTracker
 * (analytics-provider.tsx) stops feeding it page views there so no admin
 * navigation is tracked.
 */
export function GtmScripts({ gtmId }: { gtmId?: string }) {
  const pathname = usePathname();

  if (!gtmId || !isAnalyticsAllowedPath(pathname ?? "")) {
    return null;
  }

  return (
    <>
      <Script id="gtm-init" strategy="afterInteractive">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`}
      </Script>
      <noscript>
        <iframe
          height={0}
          src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
          style={{ display: "none", visibility: "hidden" }}
          title="Google Tag Manager"
          width={0}
        />
      </noscript>
    </>
  );
}
