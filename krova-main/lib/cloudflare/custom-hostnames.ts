/**
 * Cloudflare for SaaS — Custom Hostname CRUD.
 *
 * A Custom Hostname registers a customer's domain on the `krova.cloud`
 * zone and routes it (via `custom_origin_server`) to a specific server's
 * proxied origin record. Cloudflare manages the visitor<->edge TLS cert.
 *
 * API pinned 2026-05-17:
 *   POST   /zones/{zone}/custom_hostnames
 *   GET    /zones/{zone}/custom_hostnames?hostname=<exact>
 *   GET    /zones/{zone}/custom_hostnames/{id}
 *   PATCH  /zones/{zone}/custom_hostnames/{id}
 *   DELETE /zones/{zone}/custom_hostnames/{id}
 */

import {
  CloudflareError,
  cfRequest,
  cloudflareZoneId,
} from "@/lib/cloudflare/client";

export type CustomHostname = {
  id: string;
  hostname: string;
  /** Hostname activation status — "active" once Cloudflare proxies it. */
  status: string;
  /** Certificate status — "active" once issued + deployed. May be absent
   *  on a just-created hostname before issuance begins. */
  ssl?: { status: string };
  custom_origin_server?: string;
};

/** Find a Custom Hostname by exact hostname. Returns null if none exists. */
export async function findCustomHostname(
  hostname: string
): Promise<CustomHostname | null> {
  const zone = cloudflareZoneId();
  // Cloudflare's `hostname` filter is a substring match and the list is
  // paginated — request a large page and exact-match client-side. 50 is a
  // safe ceiling: it would take >50 hostnames sharing this exact substring
  // to miss the target, which a single customer hostname never produces.
  const matches = await cfRequest<CustomHostname[]>(
    "GET",
    `/zones/${zone}/custom_hostnames?hostname=${encodeURIComponent(hostname)}&per_page=50`
  );
  return matches.find((h) => h.hostname === hostname) ?? null;
}

/** Get a Custom Hostname by id. */
export async function getCustomHostname(id: string): Promise<CustomHostname> {
  const zone = cloudflareZoneId();
  return cfRequest<CustomHostname>(
    "GET",
    `/zones/${zone}/custom_hostnames/${id}`
  );
}

/** Create a Custom Hostname routing to `originServer`. */
export async function createCustomHostname(
  hostname: string,
  originServer: string
): Promise<CustomHostname> {
  const zone = cloudflareZoneId();
  return cfRequest<CustomHostname>("POST", `/zones/${zone}/custom_hostnames`, {
    hostname,
    ssl: { method: "http", type: "dv" },
    custom_origin_server: originServer,
  });
}

/** Update a Custom Hostname's origin server. */
export async function updateCustomHostnameOrigin(
  id: string,
  originServer: string
): Promise<CustomHostname> {
  const zone = cloudflareZoneId();
  return cfRequest<CustomHostname>(
    "PATCH",
    `/zones/${zone}/custom_hostnames/${id}`,
    { custom_origin_server: originServer }
  );
}

/** Delete a Custom Hostname by id. A 404 is treated as success. */
export async function deleteCustomHostname(id: string): Promise<void> {
  const zone = cloudflareZoneId();
  try {
    await cfRequest("DELETE", `/zones/${zone}/custom_hostnames/${id}`);
  } catch (e) {
    if (e instanceof CloudflareError && e.status === 404) {
      return;
    }
    throw e;
  }
}

/**
 * Idempotently ensure a Custom Hostname exists for `hostname` routing to
 * `originServer`. Creates it if absent; PATCHes the origin if it diverges.
 *
 * The find->create sequence has a theoretical TOCTOU window, but each
 * globally-unique domain yields exactly one `domain.add` job (enforced by
 * the `domain_mappings` partial-unique index), so concurrent creates of
 * the same hostname do not occur in practice. If one ever did, the loser's
 * Cloudflare duplicate error bubbles to pg-boss, and the retry's
 * `findCustomHostname` returns the existing record — self-healing.
 */
export async function ensureCustomHostname(
  hostname: string,
  originServer: string
): Promise<CustomHostname> {
  const existing = await findCustomHostname(hostname);
  if (existing) {
    if (existing.custom_origin_server !== originServer) {
      return updateCustomHostnameOrigin(existing.id, originServer);
    }
    return existing;
  }
  return createCustomHostname(hostname, originServer);
}

/**
 * Collapse a Custom Hostname's hostname-status + ssl-status into one
 * string for `domainMappings.cloudflareStatus` and the UI badge:
 *   "active"  — hostname active AND cert issued; HTTPS is live.
 *   otherwise — the first non-active sub-status (e.g. "pending_validation",
 *               "pending_deployment", "blocked"), so the UI can show why.
 */
export function summarizeCloudflareStatus(h: CustomHostname): string {
  if (h.status === "active" && h.ssl?.status === "active") {
    return "active";
  }
  if (h.status !== "active") {
    return h.status;
  }
  return h.ssl?.status ?? "pending";
}
