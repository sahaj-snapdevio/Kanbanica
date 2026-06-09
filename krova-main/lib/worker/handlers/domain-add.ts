import { and, eq } from "drizzle-orm";
import type { JobWithMetadata } from "pg-boss";
import { cubes, domainMappings, lifecycleLogs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { summarizeCloudflareStatus } from "@/lib/cloudflare";
import { db } from "@/lib/db";
import { triggerEvent } from "@/lib/pusher";
import {
  deregisterCubeCustomHostname,
  registerCubeCustomHostname,
} from "@/lib/server/cube-domain";
import { addCustomDomainRoute, connectToServer } from "@/lib/ssh";
import { domainAddFailureAction } from "@/lib/worker/handlers/domain-add-policy";
import { JobLogger } from "@/lib/worker/job-log";
import type { DomainAddPayload } from "@/lib/worker/job-types";

async function handleDomainAddJob(
  job: JobWithMetadata<DomainAddPayload>
): Promise<void> {
  const { mappingId, cubeId, serverId, domain, port } = job.data;
  const log = new JobLogger(job.id, "domain.add", "cube", cubeId);
  console.log(`[domain-add] starting for domain=${domain} cubeId=${cubeId}`);
  await log.info(`Adding domain "${domain}" → :${port}`);

  // 1. Load domain mapping — idempotent check.
  const mapping = await db.query.domainMappings.findFirst({
    where: eq(domainMappings.id, mappingId),
  });
  if (!mapping) {
    console.log(`[domain-add] mapping ${mappingId} not found, skipping`);
    return;
  }
  if (mapping.status !== "pending") {
    console.log(
      `[domain-add] mapping ${mappingId} not pending (status=${mapping.status}), skipping`
    );
    return;
  }

  // 2. Load Cube.
  const cube = await db.query.cubes.findFirst({ where: eq(cubes.id, cubeId) });
  if (!cube) {
    throw new Error(`Cube ${cubeId} not found`);
  }

  // Track a Custom Hostname we registered, so the failure path can clean
  // it up rather than leaking an orphan in Cloudflare.
  let registeredHostnameId: string | undefined;
  // Set true the instant the mapping is flipped to `active`. Once active, the
  // domain is live — a failure in a trivial post-success step (lifecycle log,
  // Pusher, audit) must NEVER tear it down (mirrors the Rule 50 forward-flip).
  let becameActive = false;

  try {
    // 3. Register the Cloudflare Custom Hostname (idempotent).
    const ch = await registerCubeCustomHostname(domain, serverId);
    registeredHostnameId = ch.id;
    const cfStatus = summarizeCloudflareStatus(ch);
    await db
      .update(domainMappings)
      .set({
        cloudflareHostnameId: ch.id,
        cloudflareStatus: cfStatus,
        updatedAt: new Date(),
      })
      .where(eq(domainMappings.id, mappingId));
    await log.info(
      `Cloudflare Custom Hostname registered (status: ${cfStatus})`
    );

    // 4. Add the Caddy Host route. Every domain is created with a routing
    //    port, so the route is always added here. A Cube with no internal
    //    IP means it is not provisioned yet — an error.
    if (!cube.internalIp) {
      throw new Error(
        `Cube ${cubeId} has no internal IP — cannot add Caddy route for "${domain}"`
      );
    }
    const { client } = await connectToServer(serverId);
    try {
      await addCustomDomainRoute(client, domain, cube.internalIp, port);
    } finally {
      client.end();
    }
    await log.info(`Caddy route added for "${domain}" → :${port}`);

    // 5. Mark active (conditional — don't clobber a concurrent change).
    const [updated] = await db
      .update(domainMappings)
      .set({ status: "active", updatedAt: new Date() })
      .where(
        and(
          eq(domainMappings.id, mappingId),
          eq(domainMappings.status, "pending")
        )
      )
      .returning({ id: domainMappings.id });
    if (!updated) {
      console.log(
        `[domain-add] mapping ${mappingId} no longer pending after setup, skipping`
      );
      return;
    }
    becameActive = true;

    // 6. Lifecycle log + Pusher + audit.
    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Domain ${domain} registered with Cloudflare for SaaS`,
    });
    await triggerEvent(`private-cube-${cubeId}`, "domain.update", {
      mappingId,
      domain,
      port,
      status: "active",
    });
    audit({
      action: "domain.add_complete",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId: cube.spaceId,
      description: `Domain ${domain} registered with Cloudflare for SaaS`,
      metadata: { domain, port, cubeId },
      source: "worker",
    });

    console.log(`[domain-add] completed domain=${domain} cubeId=${cubeId}`);
    await log.info(`Domain "${domain}" active`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);

    // pg-boss v12 exposes the 0-based retry count + the queue's configured
    // limit on JobWithMetadata (delivered because boss.ts registers this queue
    // with `includeMetadata: true`). Reading them off metadata removes the old
    // hardcoded `retryLimit = 3` that had to be kept in sync with QUEUE_OPTIONS.
    const retryCount = job.retryCount;
    const retryLimit = job.retryLimit;
    const action = domainAddFailureAction({
      becameActive,
      retryCount,
      retryLimit,
    });

    // The domain is LIVE — a failure in a trivial post-success step (lifecycle
    // log / Pusher / audit) must not tear it down (Rule 50 forward-flip).
    if (action === "keep-live") {
      console.warn(
        `[domain-add] post-activation step failed for ${domain} (domain is live, not rolling back): ${reason}`
      );
      await log.warn(
        `Domain "${domain}" is active; a post-setup step failed (non-fatal): ${reason}`
      );
      return;
    }

    console.error(`[domain-add] failed domain=${domain}:`, err);
    await log.error(`Domain "${domain}" failed: ${reason}`);

    // Transient failure with retries remaining: leave the row `pending` and the
    // idempotent Cloudflare hostname in place, rethrow so the pg-boss retry
    // re-attempts. Deleting here is what made a single SSH/Cloudflare blip
    // permanently destroy a customer's domain.
    if (action === "retry") {
      await log.warn(
        `Domain "${domain}" setup failed (attempt ${retryCount + 1}/${retryLimit + 1}) — will retry; mapping kept pending`
      );
      throw err;
    }

    // Final attempt: clean up the Custom Hostname we registered, delete the
    // failed mapping, and surface the removal.
    if (registeredHostnameId) {
      await deregisterCubeCustomHostname(registeredHostnameId).catch((e) => {
        console.warn(
          `[domain-add] Custom Hostname cleanup failed for ${domain}: ${e instanceof Error ? e.message : e}`
        );
      });
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
        message: `Domain ${domain} mapping failed after ${retryLimit + 1} attempts: ${reason}`,
      })
      .catch(() => {});
    await triggerEvent(`private-cube-${cubeId}`, "domain.update", {
      mappingId,
      domain,
      port,
      status: "removed",
    }).catch(() => {});

    throw err;
  }
}

export async function handleDomainAdd(
  jobs: JobWithMetadata<DomainAddPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleDomainAddJob(job);
  }
}
