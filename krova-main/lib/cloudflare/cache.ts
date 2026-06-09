/**
 * Cloudflare — edge cache purge (purge by hostname).
 *
 * Customer custom domains are Cloudflare-for-SaaS Custom Hostnames on Krova's
 * own zone, so their edge cache lives on OUR zone and ONLY Krova can purge it
 * (the customer's record is grey-cloud / DNS-only and caches nothing). We
 * purge by HOSTNAME so one customer's purge never touches another's cache —
 * NEVER `purge_everything`, which would drop every customer's cached content
 * on the zone at once.
 *
 * API verified 2026-06-02 (Cloudflare Cache docs):
 *   POST /zones/{zone_id}/purge_cache   body { "hosts": ["app.customer.com"] }
 * Purge-by-hostname is available on ALL plans (Cloudflare "Instant Purge for
 * all", Apr 2025 — no Enterprise requirement); up to 30 hostnames per request.
 */

import { cfRequest, cloudflareZoneId } from "@/lib/cloudflare/client";

/** Cloudflare's hard ceiling on hostnames in one purge_cache request. */
export const PURGE_CACHE_MAX_HOSTS = 30;

/**
 * Build the `purge_cache` request body for a by-hostname purge. Pure +
 * unit-tested. Trims, lower-cases, and de-dupes the input; throws on an empty
 * list or one exceeding Cloudflare's 30-host ceiling.
 */
export function buildPurgeByHostnameBody(hostnames: string[]): {
  hosts: string[];
} {
  const hosts = [
    ...new Set(hostnames.map((h) => h.trim().toLowerCase()).filter(Boolean)),
  ];
  if (hosts.length === 0) {
    throw new Error("purge_cache: at least one hostname is required");
  }
  // Cloudflare purge-by-hostname does NOT accept wildcards — a wildcard /
  // catch-all custom hostname's cache must be purged per concrete subdomain
  // (verified 2026-06-02; it's a long-standing unimplemented feature request).
  // Reject "*" so we never send a value Cloudflare would silently ignore.
  const wildcard = hosts.find((h) => h.includes("*"));
  if (wildcard) {
    throw new Error(
      `purge_cache: wildcard hostnames are not supported by Cloudflare purge-by-hostname (got "${wildcard}")`
    );
  }
  if (hosts.length > PURGE_CACHE_MAX_HOSTS) {
    throw new Error(
      `purge_cache: at most ${PURGE_CACHE_MAX_HOSTS} hostnames per request (got ${hosts.length})`
    );
  }
  return { hosts };
}

/**
 * Purge a single custom hostname's edge cache on Krova's Cloudflare zone.
 * Idempotent — purging an already-cold hostname is a no-op success. A
 * Cloudflare 429 (rate limit) surfaces as a `CloudflareError` so the worker
 * can back off and retry.
 */
export async function purgeCacheByHostname(hostname: string): Promise<void> {
  const zone = cloudflareZoneId();
  await cfRequest(
    "POST",
    `/zones/${zone}/purge_cache`,
    buildPurgeByHostnameBody([hostname])
  );
}
