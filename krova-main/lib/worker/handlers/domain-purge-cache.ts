import { eq } from "drizzle-orm";
import type { JobWithMetadata } from "pg-boss";
import { domainMappings, lifecycleLogs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { purgeCacheByHostname } from "@/lib/cloudflare";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { triggerEvent } from "@/lib/pusher";
import { JobLogger } from "@/lib/worker/job-log";
import type { DomainPurgeCachePayload } from "@/lib/worker/job-types";

async function handleDomainPurgeCacheJob(
  job: JobWithMetadata<DomainPurgeCachePayload>
): Promise<void> {
  const { mappingId, cubeId, spaceId, domain } = job.data;
  const log = new JobLogger(job.id, "domain.purge-cache", "cube", cubeId);
  await log.info(`Clearing Cloudflare cache for "${domain}"`);

  // 1. Idempotent load — the mapping may have been removed between enqueue
  //    and run. A purge against a gone hostname is meaningless, so skip.
  const mapping = await db.query.domainMappings.findFirst({
    where: eq(domainMappings.id, mappingId),
  });
  if (!mapping) {
    await log.info(`Mapping ${mappingId} no longer exists — nothing to purge`);
    return;
  }
  if (!mapping.cloudflareHostnameId) {
    await log.info(
      `"${domain}" is not registered on Cloudflare — nothing to purge`
    );
    return;
  }
  // Cloudflare not configured: a missing token must not strand the job in
  // retries forever — log + skip (mirrors domain-remove's guard).
  if (!(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID)) {
    await log.warn(
      `Cloudflare not configured — skipping cache purge for "${domain}"`
    );
    return;
  }

  try {
    // 2. Single by-hostname purge. A transient CF 429 throws CloudflareError
    //    and is retried by pg-boss (retryLimit 3, retryDelay 30).
    await log.step(`Purge edge cache: ${domain}`, async () => {
      await purgeCacheByHostname(domain);
    });

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Cleared Cloudflare edge cache for ${domain}`,
    });
    audit({
      action: "domain.cache_purged",
      category: "domain",
      actorType: "system",
      entityType: "domain_mapping",
      entityId: mappingId,
      spaceId,
      description: `Cleared Cloudflare edge cache for ${domain}`,
      metadata: { domain, cubeId, mappingId },
      source: "worker",
    });
    await triggerEvent(`private-cube-${cubeId}`, "domain.cache-purged", {
      mappingId,
      domain,
      status: "success",
    });
    await log.info(`Cache cleared for "${domain}"`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await log.error(`Cache purge for "${domain}" failed: ${reason}`);

    // pg-boss v12 exposes retryCount/retryLimit on JobWithMetadata (queue is
    // registered with includeMetadata: true). Transient (e.g. CF 429): rethrow
    // so pg-boss retries. Final attempt: notify the UI so the customer isn't
    // left waiting, then RETURN (the cooldown stamp already advanced at
    // enqueue; rethrowing would just mark the job failed with no recovery —
    // the customer can retry once the cooldown elapses).
    if (job.retryCount < job.retryLimit) {
      throw err;
    }
    await triggerEvent(`private-cube-${cubeId}`, "domain.cache-purged", {
      mappingId,
      domain,
      status: "failed",
      error: reason.slice(0, 200),
    }).catch(() => {});
    await db
      .insert(lifecycleLogs)
      .values({
        entityType: "cube",
        entityId: cubeId,
        message: `Cloudflare cache purge for ${domain} failed after ${job.retryLimit + 1} attempts: ${reason.slice(0, 200)}`,
      })
      .catch(() => {});
    audit({
      action: "domain.cache_purge_failed",
      category: "domain",
      actorType: "system",
      entityType: "domain_mapping",
      entityId: mappingId,
      spaceId,
      description: `Cloudflare cache purge for ${domain} failed: ${reason.slice(0, 200)}`,
      metadata: { domain, cubeId, mappingId, error: reason.slice(0, 1000) },
      source: "worker",
    });
  }
}

export async function handleDomainPurgeCache(
  jobs: JobWithMetadata<DomainPurgeCachePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleDomainPurgeCacheJob(job);
  }
}
