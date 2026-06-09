/**
 * Server-facing hostnames, derived from `servers.hostname`.
 *
 * Both hostname shapes are pure functions of `server.hostname` plus the
 * platform base domain — never stored in a column, never operator-entered,
 * so they cannot drift or be misconfigured. `hostname` is `notNull`, so
 * both functions always return a string (there is no null case).
 */

import { PLATFORM_BASE_DOMAIN } from "@/config/platform";

/**
 * The proxied (orange-cloud) Cloudflare for SaaS custom origin for a server.
 * e.g. `banana` → `banana.krova.cloud`. Used as the `custom_origin_server`
 * when registering a customer's Custom Hostname. MUST resolve orange-cloud —
 * Cloudflare for SaaS requires the custom origin to be a proxied record.
 */
export function serverOriginHostname(hostname: string): string {
  return `${hostname}.${PLATFORM_BASE_DOMAIN}`;
}

/**
 * The DNS-only (grey-cloud) endpoint for a server — customer SSH/TCP
 * connections and the bare landing page. e.g. `banana` →
 * `connect.banana.krova.cloud`. MUST resolve grey-cloud straight to the
 * bare-metal IP: Cloudflare's proxy won't carry SSH ports, and the
 * landing-page ACME HTTP-01 challenge needs a direct line to Caddy.
 */
export function serverConnectDomain(hostname: string): string {
  return `connect.${hostname}.${PLATFORM_BASE_DOMAIN}`;
}

/**
 * The two server-facing hostnames that BOTH serve the branded landing page,
 * grouped so Caddy can be told how to treat each one's TLS.
 *
 * Caddy host-matches a single landing route to both names, but only the
 * connect domain is ACME-managed — see `initializeCaddyServer` in
 * `lib/ssh/caddy.ts`.
 */
export interface ServerLandingHosts {
  /**
   * Grey-cloud connect domain (`connect.<hostname>.krova.cloud`). Caddy
   * ACME-manages its certificate: the HTTP-01 challenge reaches Caddy
   * directly because the DNS record is not proxied.
   */
  connectDomain: string;
  /**
   * Orange-cloud origin hostname (`<hostname>.krova.cloud`). Served with the
   * loaded wildcard Cloudflare Origin CA cert; Caddy must NOT ACME-manage it
   * — an HTTP-01 challenge would be intercepted by Cloudflare's proxy.
   */
  originHostname: string;
}

/**
 * Both branded-landing hostnames for a server, derived from `servers.hostname`.
 * The single source of truth for the pair — callers never build it ad hoc.
 */
export function serverLandingHosts(hostname: string): ServerLandingHosts {
  return {
    connectDomain: serverConnectDomain(hostname),
    originHostname: serverOriginHostname(hostname),
  };
}
