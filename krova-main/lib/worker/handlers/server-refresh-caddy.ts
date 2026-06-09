/**
 * Operator-initiated routing re-sync on an active server.
 *
 * Re-asserts the server's entire external routing state in three
 * idempotent steps:
 *   1. Cloudflare DNS — both derived records (proxied `<hostname>` origin +
 *      DNS-only `connect.<hostname>`) via create-or-update `ensureDnsRecord`.
 *   2. Origin CA cert — re-installed on Caddy from the platform env (so a
 *      rotated `CLOUDFLARE_ORIGIN_CERT` / `_KEY` is picked up here).
 *   3. Caddy `srv0` routes — the branded landing route (host-matched to BOTH
 *      the proxied origin hostname and the grey-cloud connect domain) plus
 *      one route per live customer custom domain from `domain_mappings`,
 *      swapped in a single atomic Caddy Admin API `PATCH`, plus the ACME
 *      automation policy and the origin-hostname `automatic_https` skip.
 *
 * Use case: an existing server that pre-dates hostname-derivation has no grey
 * `connect.<hostname>` DNS record and a stale Caddy landing route (the
 * `install` phase that would set them cannot be re-run once
 * `setupPhase === "ready"`). This one action heals all of it — and also
 * self-heals Caddy drift from `domain_mappings` and rotates the Origin CA cert.
 *
 * Idempotent (Rule 7) — re-running re-pushes the identical desired state.
 *
 * What this handler does NOT do:
 *   - Reboot the server or restart any Cubes.
 *   - Change `setupPhase` / `setupStatus` (the server stays active).
 *   - Touch non-`http` Caddy apps or TCP/SSH iptables DNAT mappings.
 */

import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import * as schema from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { triggerEvent } from "@/lib/pusher";
import { setUpServerCloudflareOrigin } from "@/lib/server/cloudflare-origin";
import { getActiveCustomDomainsForServer } from "@/lib/server/server-domains";
import { serverLandingHosts } from "@/lib/server/server-hostnames";
import { initializeCaddyServer, reconcileCaddyRoutes } from "@/lib/ssh/caddy";
import { connectToServer } from "@/lib/ssh/connect-to-server";
import { JobLogger } from "@/lib/worker/job-log";
import type { ServerRefreshCaddyPayload } from "@/lib/worker/job-types";

async function runHandler(job: Job<ServerRefreshCaddyPayload>): Promise<void> {
  const { serverId } = job.data;
  const log = new JobLogger(job.id, "server.refresh-caddy", "server", serverId);
  let client: Awaited<ReturnType<typeof connectToServer>>["client"] | null =
    null;

  try {
    await log.info("Routing refresh started (operator-initiated)");

    const [server] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, serverId))
      .limit(1);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    // Re-guard the phase — server state may have changed between enqueue
    // and run; a Caddy reconcile is only meaningful on a fully-setup box.
    if (server.setupPhase !== "ready") {
      throw new Error(
        `Server "${server.hostname}" is not ready (setupPhase=${server.setupPhase}) — Caddy refresh is only available on fully-setup servers`
      );
    }

    const conn = await connectToServer(serverId);
    client = conn.client;

    // Step 1+2: re-assert the Cloudflare origin — both DNS records (idempotent
    // create-or-update) and the Origin CA cert, re-installed on Caddy from
    // the platform env. Picks up a rotated cert and creates the grey
    // `connect.<hostname>` record on servers predating hostname-derivation.
    await log.step(
      "Cloudflare origin: DNS records + Origin CA cert",
      async () => {
        await setUpServerCloudflareOrigin(client!, server, log);
      }
    );

    // Step 3: rebuild the srv0 routes array + automation policy atomically.
    // `initializeCaddyServer` runs first — it is idempotent: it POSTs a full
    // `/load` if Caddy was reset to a bare config with no `srv0`, or
    // PATCH-merges if `srv0` already exists. That guarantees `srv0` exists
    // before `reconcileCaddyRoutes` issues its atomic routes PATCH, so a
    // refresh can heal a fully-reset Caddy, not just drifted routes.
    let domainCount = 0;
    await log.step("Reconcile Caddy routes", async () => {
      const landingHosts = serverLandingHosts(server.hostname);
      await initializeCaddyServer(client!, landingHosts);
      const domains = await getActiveCustomDomainsForServer(serverId);
      domainCount = domains.length;
      await reconcileCaddyRoutes(client!, landingHosts, domains);
    });

    await log.info(
      `Routing refresh complete — DNS records + Origin CA cert + landing route + ${domainCount} custom-domain route(s) re-pushed`
    );

    audit({
      action: "server.caddy_refreshed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Operator refreshed routing on "${server.hostname}" — DNS records, Origin CA cert, landing route + ${domainCount} custom-domain route(s) re-pushed`,
      metadata: { domainCount },
      source: "worker",
    });

    await triggerEvent(`private-server-${serverId}`, "caddy.refreshed", {
      serverId,
      domainCount,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[server-refresh-caddy] failed for ${serverId}:`, err);
    await log.error(`Routing refresh failed: ${msg}`);
    audit({
      action: "server.caddy_refresh_failed",
      category: "server",
      actorType: "system",
      entityType: "server",
      entityId: serverId,
      description: `Operator-initiated routing refresh failed: ${msg.slice(0, 200)}`,
      metadata: { error: msg.slice(0, 1000) },
      source: "worker",
    });
  } finally {
    if (client) {
      try {
        client.end();
      } catch {
        /* noop */
      }
    }
  }
}

export async function handleServerRefreshCaddy(
  jobs: Job<ServerRefreshCaddyPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await runHandler(job);
  }
}
