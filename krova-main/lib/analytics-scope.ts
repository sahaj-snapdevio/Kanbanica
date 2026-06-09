/**
 * Where the Google Tag Manager container (and the cookie-consent banner that
 * gates it) is allowed to load. GTM is customer-facing only: it loads on the
 * marketing site, auth, the customer dashboard, and the browser terminal, but
 * NEVER on the Orbit operator admin (`/orbit/*`). Operators are staff, not
 * tracked traffic, and the admin surface has no analytics value.
 *
 * Pure + framework-free so it can be unit-tested and shared (Rule 14) by the
 * client GTM loader (components/gtm-scripts.tsx), the analytics page-tracker
 * (components/analytics-provider.tsx), and the consent banner
 * (components/cookie-consent.tsx).
 */

/** True for the Orbit operator-admin route group (`/orbit`, `/orbit/...`). */
export function isOrbitPath(pathname: string): boolean {
  return pathname === "/orbit" || pathname.startsWith("/orbit/");
}

/** GTM analytics + the consent banner load on every route except Orbit admin. */
export function isAnalyticsAllowedPath(pathname: string): boolean {
  return !isOrbitPath(pathname);
}
