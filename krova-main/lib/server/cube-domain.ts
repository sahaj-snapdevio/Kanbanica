/**
 * Cube custom-domain <-> Cloudflare Custom Hostname glue.
 *
 * A Cube's custom domain is registered with Cloudflare for SaaS as a
 * Custom Hostname whose `custom_origin_server` is the Cube's server's
 * proxied origin record — derived from `servers.hostname` via
 * `serverOriginHostname()`. These helpers resolve that origin and wrap the
 * Custom Hostname CRUD with the env / configuration guards every caller
 * needs.
 */

import { eq } from "drizzle-orm";

import { servers } from "@/db/schema";
import {
  CloudflareError,
  type CustomHostname,
  deleteCustomHostname,
  ensureCustomHostname,
  updateCustomHostnameOrigin,
} from "@/lib/cloudflare";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { serverOriginHostname } from "@/lib/server/server-hostnames";

/** Throw unless the Cloudflare API env is configured. */
function assertCloudflareConfigured(): void {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ZONE_ID) {
    throw new CloudflareError(
      "Cloudflare is not configured (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID) — cannot manage custom hostnames",
      0
    );
  }
}

/**
 * Resolve a server's proxied Cloudflare origin hostname. Derived from
 * `servers.hostname`, so it is always defined for an existing server.
 */
export async function resolveServerOrigin(serverId: string): Promise<string> {
  const [server] = await db
    .select({ hostname: servers.hostname })
    .from(servers)
    .where(eq(servers.id, serverId))
    .limit(1);
  if (!server) {
    throw new Error(`Server ${serverId} not found`);
  }
  return serverOriginHostname(server.hostname);
}

/**
 * Register (or, if it already exists, re-point) `domain` as a Custom
 * Hostname routing to the server's origin. Idempotent.
 */
export async function registerCubeCustomHostname(
  domain: string,
  serverId: string
): Promise<CustomHostname> {
  assertCloudflareConfigured();
  const origin = await resolveServerOrigin(serverId);
  return ensureCustomHostname(domain, origin);
}

/** Re-point an existing Custom Hostname to a different server's origin. */
export async function repointCubeCustomHostname(
  hostnameId: string,
  serverId: string
): Promise<CustomHostname> {
  assertCloudflareConfigured();
  const origin = await resolveServerOrigin(serverId);
  return updateCustomHostnameOrigin(hostnameId, origin);
}

/**
 * Re-point every supplied custom domain's Custom Hostname origin to `serverId`.
 *
 * Used by the cube-transfer rollback / cancel paths to RESTORE the origin to
 * the source server after a pre-flip failure: the transfer re-points origins
 * to the DESTINATION at the finalizing step (make-before-break) before the
 * atomic flip, so a failure/cancel before the flip would otherwise leave the
 * domain pointing at a destination that's about to be torn down.
 *
 * Idempotent — re-pointing to the server a hostname already targets is a no-op
 * PATCH (`ensureCustomHostname`-style semantics live in `updateCustomHostnameOrigin`,
 * which simply PATCHes). Best-effort PER DOMAIN: a single domain's failure is
 * logged and the rest still proceed, so one bad hostname can't block recovery
 * of the others. Rows without a `cloudflareHostnameId` are skipped (nothing to
 * re-point — they were Caddy-only).
 */
export async function repointCubeDomainsToServer(
  domains: Array<{ domain: string; cloudflareHostnameId: string | null }>,
  serverId: string
): Promise<void> {
  for (const d of domains) {
    if (!d.cloudflareHostnameId) {
      continue;
    }
    try {
      await repointCubeCustomHostname(d.cloudflareHostnameId, serverId);
    } catch (err) {
      console.warn(
        `[cube-domain] failed to re-point ${d.domain} origin to server ${serverId} (non-fatal): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

/** Delete a Cube's Custom Hostname by id. A 404 is treated as success. */
export async function deregisterCubeCustomHostname(
  hostnameId: string
): Promise<void> {
  assertCloudflareConfigured();
  await deleteCustomHostname(hostnameId);
}
