import { eq } from "drizzle-orm";
import type { JobWithMetadata } from "pg-boss";
import { cubes, domainMappings, lifecycleLogs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { triggerEvent } from "@/lib/pusher";
import { deregisterCubeCustomHostname } from "@/lib/server/cube-domain";
import { connectToServer } from "@/lib/ssh";
import { removeCustomDomainRoute } from "@/lib/ssh/caddy";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildDomainPayload } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { DomainRemovePayload } from "@/lib/worker/job-types";

async function handleDomainRemoveJob(
  job: JobWithMetadata<DomainRemovePayload>
): Promise<void> {
  const { mappingId, cubeId, serverId, domain } = job.data;
  const log = new JobLogger(job.id, "domain.remove", "cube", cubeId);
  console.log(`[domain-remove] starting for domain=${domain} cubeId=${cubeId}`);
  await log.info(`Removing domain "${domain}"`);

  // 1. Load domain mapping — idempotent check.
  const mapping = await db.query.domainMappings.findFirst({
    where: eq(domainMappings.id, mappingId),
  });
  if (!mapping) {
    console.log(`[domain-remove] mapping ${mappingId} not found, skipping`);
    return;
  }

  let client: Awaited<ReturnType<typeof connectToServer>>["client"] | null =
    null;

  try {
    // 2. Delete the Cloudflare Custom Hostname (if one was registered).
    //    Gated on the Cloudflare env being configured: a teardown must not
    //    be permanently blocked just because the credentials were removed.
    //    Transient Cloudflare API errors still propagate from
    //    deregisterCubeCustomHostname so a retry can delete the hostname.
    if (mapping.cloudflareHostnameId) {
      if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID) {
        await deregisterCubeCustomHostname(mapping.cloudflareHostnameId);
        await log.info("Cloudflare Custom Hostname deleted");
      } else {
        await log.warn(
          `Cloudflare not configured — skipping Custom Hostname deletion for "${domain}"`
        );
      }
    }

    // 3. Remove the Caddy route. 404 is non-fatal (route already gone).
    const result = await connectToServer(serverId);
    client = result.client;
    await removeCustomDomainRoute(client, domain);

    // 4. Load Cube for the audit spaceId, then hard-delete the row.
    const cube = await db.query.cubes.findFirst({
      where: eq(cubes.id, cubeId),
      columns: { spaceId: true },
    });
    if (!cube) {
      console.warn(
        `[domain-remove] cube ${cubeId} not found — audit spaceId will be undefined`
      );
    }
    await db.delete(domainMappings).where(eq(domainMappings.id, mappingId));

    // 5. Lifecycle log + Pusher + audit.
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Domain ${domain} mapping removed`,
    });
    await triggerEvent(`private-cube-${cubeId}`, "domain.update", {
      mappingId,
      domain,
      status: "removed",
    });
    audit({
      action: "domain.remove_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId: cube?.spaceId,
      description: `Domain ${domain} mapping removed`,
      metadata: { domain, cubeId },
      source: "worker",
    });

    if (cube?.spaceId) {
      dispatchWebhookEvent(cube.spaceId, "domain.removed", {
        domain: buildDomainPayload(mapping),
      });
    }

    console.log(`[domain-remove] completed domain=${domain} cubeId=${cubeId}`);
    await log.info(`Domain "${domain}" removed`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[domain-remove] failed domain=${domain}:`, err);
    await log.error(`Domain "${domain}" remove failed: ${reason}`);

    // Final-attempt cleanup. The action layer set the row to `stopping` before
    // enqueue; a host that stays unreachable across all retries would leave it
    // stuck there forever — dead-ending BOTH re-remove (409 on `stopping`) and
    // re-add (unique conflict on the still-present row). On the FINAL attempt,
    // force the row to a terminal (deleted) state so the customer can re-add.
    // The Cloudflare hostname delete is host-INDEPENDENT (API) so still attempt
    // it; the Caddy route is rebuilt from the DB by server.refresh-caddy / the
    // next transfer, so a leftover stale route is dropped once the host returns.
    // pg-boss v12: retryCount/retryLimit come off JobWithMetadata (this queue is
    // registered with `includeMetadata: true` in boss.ts).
    const retryCount = job.retryCount;
    const retryLimit = job.retryLimit;
    if (retryCount >= retryLimit) {
      if (
        mapping.cloudflareHostnameId &&
        env.CLOUDFLARE_API_TOKEN &&
        env.CLOUDFLARE_ZONE_ID
      ) {
        await deregisterCubeCustomHostname(mapping.cloudflareHostnameId).catch(
          () => {}
        );
      }
      await db
        .delete(domainMappings)
        .where(eq(domainMappings.id, mappingId))
        .catch(() => {});
      await db
        .insert(lifecycleLogs)
        .values({
          entityType: "cube",
          entityId: cubeId,
          message: `Domain ${domain} mapping force-removed after ${retryLimit + 1} failed attempts (host unreachable): ${reason.slice(0, 200)}`,
        })
        .catch(() => {});
      await triggerEvent(`private-cube-${cubeId}`, "domain.update", {
        mappingId,
        domain,
        status: "removed",
      }).catch(() => {});
      audit({
        action: "domain.remove_force_completed",
        category: "cube",
        actorType: "system",
        entityType: "cube",
        entityId: cubeId,
        description: `Domain ${domain} force-removed after exhausting retries: ${reason.slice(0, 200)}`,
        metadata: { domain, cubeId, error: reason.slice(0, 1000) },
        source: "worker",
      });
      await log.warn(
        `Domain "${domain}" force-removed after ${retryLimit + 1} failed attempts — row deleted so it can be re-added`
      );
      return;
    }

    throw err;
  } finally {
    client?.end();
  }
}

export async function handleDomainRemove(
  jobs: JobWithMetadata<DomainRemovePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleDomainRemoveJob(job);
  }
}
