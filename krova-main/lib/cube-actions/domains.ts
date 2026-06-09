import { createId } from "@paralleldrive/cuid2";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { DOMAIN_CACHE_PURGE_COOLDOWN_SECONDS } from "@/config/platform";
import * as schema from "@/db/schema";
import type { DomainMapping } from "@/db/schema/types";
import { audit } from "@/lib/audit";
import {
  actorAuditFields,
  type CubeActionContext,
  type CubeActionResult,
} from "@/lib/cube-actions/types";
import { db } from "@/lib/db";
import { cachePurgeCooldownRemainingSeconds } from "@/lib/domains/cache-purge";
import { findCrossSpaceLock } from "@/lib/domains/claim-service";
import { assertCanAddDomainV2, effectiveLimits } from "@/lib/plan/limits";
import {
  acquireSpaceLock,
  countSpaceDomainsTx,
  getSpaceOverrides,
  getSpacePlanRow,
} from "@/lib/plan/usage";
import { validateDomain } from "@/lib/validators";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildDomainPayload } from "@/lib/webhook-payloads";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Shared business logic for `GET /cubes/[cubeId]/domains`.
 * Caller is responsible for any wire-format wrapping (e.g. v1's
 * `{ domains: mappings.map(formatDomain) }`).
 */
export async function listDomainsAction(
  ctx: Pick<CubeActionContext, "cubeId">
): Promise<DomainMapping[]> {
  return await db
    .select()
    .from(schema.domainMappings)
    .where(eq(schema.domainMappings.cubeId, ctx.cubeId));
}

export type AddDomainInput = {
  rawDomain: unknown;
  port: unknown;
};

/**
 * Shared business logic for `POST /cubes/[cubeId]/domains`.
 * Note: domain audit logs intentionally do NOT carry the " via API key"
 * suffix or the apiKeyId metadata — matches existing behavior of both
 * routes; only `actorId` / `actorEmail` differ between session vs apiKey.
 */
export async function addDomainAction(
  ctx: CubeActionContext,
  input: AddDomainInput
): Promise<CubeActionResult<{ mapping: DomainMapping }>> {
  const { spaceId, cubeId, actor, reqCtx } = ctx;

  const domain = validateDomain(input.rawDomain);
  if (!domain) {
    return {
      ok: false,
      status: 400,
      error: "A valid domain name is required (e.g., example.com)",
    };
  }

  const port = input.port;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return {
      ok: false,
      status: 400,
      error: "Port must be a number between 1 and 65535",
    };
  }

  const [cube] = await db
    .select()
    .from(schema.cubes)
    .where(and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId)))
    .limit(1);

  if (!cube) {
    return { ok: false, status: 404, error: "Cube not found" };
  }

  if (
    cube.status === "deleted" ||
    cube.status === "error" ||
    cube.status === "stopping"
  ) {
    return {
      ok: false,
      status: 422,
      error: `Cannot add domain to a cube that is ${cube.status}`,
    };
  }

  const [planRow, spaceOverrides] = await Promise.all([
    getSpacePlanRow(spaceId),
    getSpaceOverrides(spaceId),
  ]);
  const limits = effectiveLimits(planRow, spaceOverrides);

  // Space-wide domain lock: if another space has a VERIFIED claim covering this
  // hostname (the domain itself or any parent of it), only that space may map
  // it. Unclaimed domains fall through to the first-come exact-hostname check
  // below. See lib/domains/claim-service.ts + the domain-claims design spec.
  const lock = await findCrossSpaceLock(domain, spaceId);
  if (lock) {
    return {
      ok: false,
      status: 409,
      error: "This domain is locked to another space.",
    };
  }

  const [existing] = await db
    .select({ id: schema.domainMappings.id })
    .from(schema.domainMappings)
    .where(eq(schema.domainMappings.domain, domain))
    .limit(1);

  if (existing) {
    return {
      ok: false,
      status: 409,
      error: "This domain is already in use",
    };
  }

  const mappingId = createId();
  let addResult: { ok: true } | { ok: false; error: string };
  try {
    addResult = await db.transaction(async (tx) => {
      await acquireSpaceLock(tx, spaceId);
      const domainCount = await countSpaceDomainsTx(tx, spaceId);
      const domainCheck = assertCanAddDomainV2(limits, domainCount);
      if (!domainCheck.ok) {
        return { ok: false as const, error: domainCheck.error };
      }
      await tx.insert(schema.domainMappings).values({
        id: mappingId,
        cubeId,
        domain,
        port,
        status: "pending",
        verificationStatus: "verified",
      });
      return { ok: true as const };
    });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      return {
        ok: false,
        status: 409,
        error: "This domain is already in use",
      };
    }
    throw err;
  }
  if (!addResult.ok) {
    return { ok: false, status: 403, error: addResult.error };
  }

  await enqueueJob(JOB_NAMES.DOMAIN_ADD, {
    mappingId,
    cubeId,
    serverId: cube.serverId,
    domain,
    port,
  });

  await db.insert(schema.lifecycleLogs).values({
    entityType: "cube" as const,
    entityId: cubeId,
    message: `Domain mapping added: ${domain}:${port} (pending)`,
  });

  const [mapping] = await db
    .select()
    .from(schema.domainMappings)
    .where(eq(schema.domainMappings.id, mappingId))
    .limit(1);

  const { actorId, actorEmail } = actorAuditFields(actor);
  audit({
    action: "domain.add",
    category: "domain",
    actorType: "user",
    actorId,
    actorEmail,
    entityType: "domain_mapping",
    entityId: mappingId,
    spaceId,
    description: `Added domain ${domain} to cube`,
    metadata: { domain, port, cubeId },
    source: "api",
    ...reqCtx,
  });

  if (mapping) {
    dispatchWebhookEvent(spaceId, "domain.added", {
      domain: buildDomainPayload(mapping),
    });
  }

  if (!mapping) {
    // Defensive: row was inserted in tx but the post-insert read returned
    // nothing (extreme replication lag / read-after-write inconsistency).
    return {
      ok: false,
      status: 500,
      error: "Internal server error",
    };
  }

  return { ok: true, data: { mapping } };
}

/**
 * Shared business logic for `DELETE /cubes/[cubeId]/domains/[mappingId]`.
 * Same audit-log shape rule as addDomainAction — no suffix, no apiKeyId
 * metadata; only actorId/actorEmail differ between session vs apiKey.
 */
export async function removeDomainAction(
  ctx: CubeActionContext & { mappingId: string }
): Promise<CubeActionResult<{ domain: string }>> {
  const { spaceId, cubeId, mappingId, actor, reqCtx } = ctx;

  const [mapping] = await db
    .select()
    .from(schema.domainMappings)
    .where(
      and(
        eq(schema.domainMappings.id, mappingId),
        eq(schema.domainMappings.cubeId, cubeId)
      )
    )
    .limit(1);

  if (!mapping) {
    return { ok: false, status: 404, error: "Domain mapping not found" };
  }

  if (mapping.status === "stopping") {
    return {
      ok: false,
      status: 409,
      error: "Domain mapping is already being removed",
    };
  }

  const [cube] = await db
    .select()
    .from(schema.cubes)
    .where(and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId)))
    .limit(1);

  if (!cube) {
    return { ok: false, status: 404, error: "Cube not found" };
  }

  await db
    .update(schema.domainMappings)
    .set({ status: "stopping", updatedAt: new Date() })
    .where(eq(schema.domainMappings.id, mappingId));

  try {
    await enqueueJob(JOB_NAMES.DOMAIN_REMOVE, {
      mappingId,
      cubeId,
      serverId: cube.serverId,
      domain: mapping.domain,
    });
  } catch (enqueueErr) {
    // Rollback status so the user can retry
    await db
      .update(schema.domainMappings)
      .set({ status: mapping.status, updatedAt: new Date() })
      .where(eq(schema.domainMappings.id, mappingId))
      .catch(() => {});
    console.error("[domain-remove] failed to enqueue job:", enqueueErr);
    return {
      ok: false,
      status: 500,
      error: "Failed to schedule domain removal. Please try again.",
    };
  }

  await db.insert(schema.lifecycleLogs).values({
    entityType: "cube" as const,
    entityId: cubeId,
    message: `Domain mapping removal initiated: ${mapping.domain}`,
  });

  const { actorId, actorEmail } = actorAuditFields(actor);
  audit({
    action: "domain.remove",
    category: "domain",
    actorType: "user",
    actorId,
    actorEmail,
    entityType: "domain_mapping",
    entityId: mappingId,
    spaceId,
    description: `Removed domain ${mapping.domain} from cube`,
    metadata: { domain: mapping.domain, cubeId, mappingId },
    source: "api",
    ...reqCtx,
  });

  return { ok: true, data: { domain: mapping.domain } };
}

/**
 * Shared core for the per-domain Cloudflare cache purge. Atomically claims the
 * cooldown window (a conditional UPDATE so two concurrent requests can't both
 * pass), enqueues `domain.purge-cache`, and writes the lifecycle + audit rows.
 * The caller has already loaded + scoped the mapping and resolved the audit
 * actor; this owns the cooldown + enqueue + bookkeeping so all three surfaces
 * (dashboard, v1, Orbit) share one path (Rule 14).
 */
async function runDomainCachePurge(args: {
  mapping: DomainMapping;
  spaceId: string;
  cubeId: string;
  audit: {
    actorType: "user" | "admin";
    actorId: string;
    actorEmail: string | null;
  };
  reqCtx: { ipAddress: string | null; userAgent: string | null };
  source: "api" | "web";
}): Promise<CubeActionResult<{ domain: string; cooldownSeconds: number }>> {
  const { mapping, spaceId, cubeId } = args;

  // Wildcard / catch-all custom hostnames can't be edge-purged: Cloudflare's
  // purge-by-hostname rejects "*" — each concrete subdomain must be purged
  // individually. validateDomain currently rejects wildcards at add-time, so
  // this is defense-in-depth (and the explicit answer should wildcard mapping
  // ever be allowed, e.g. for the self-hosted-ingress direction). NOTE: this
  // whole feature is coupled to Cloudflare-for-SaaS and is slated to be retired
  // with it once custom domains move to the self-hosted ingress.
  if (mapping.domain.includes("*")) {
    return {
      ok: false,
      status: 422,
      error:
        "Cache clearing isn't available for wildcard domains — clear individual subdomains instead.",
    };
  }

  // Cache only exists once the hostname is live on Cloudflare. Nothing to
  // purge otherwise — refuse rather than enqueue a no-op.
  if (mapping.status !== "active" || !mapping.cloudflareHostnameId) {
    return {
      ok: false,
      status: 422,
      error:
        "Cache can only be cleared once the domain is active on Cloudflare.",
    };
  }

  const now = new Date();
  const cutoff = new Date(
    now.getTime() - DOMAIN_CACHE_PURGE_COOLDOWN_SECONDS * 1000
  );

  // Atomic cooldown claim: stamp lastCachePurgeAt only if it's null or older
  // than the cooldown. A losing concurrent request claims nothing → 429.
  const claimed = await db
    .update(schema.domainMappings)
    .set({ lastCachePurgeAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.domainMappings.id, mapping.id),
        eq(schema.domainMappings.status, "active"),
        or(
          isNull(schema.domainMappings.lastCachePurgeAt),
          lt(schema.domainMappings.lastCachePurgeAt, cutoff)
        )
      )
    )
    .returning({ id: schema.domainMappings.id });

  if (claimed.length === 0) {
    const retryAfterSeconds = Math.max(
      cachePurgeCooldownRemainingSeconds(mapping.lastCachePurgeAt, now),
      1
    );
    return {
      ok: false,
      status: 429,
      error: `Cache was cleared recently — please wait ${retryAfterSeconds}s before clearing again.`,
      errorMeta: { retryAfterSeconds },
    };
  }

  try {
    await enqueueJob(
      JOB_NAMES.DOMAIN_PURGE_CACHE,
      { mappingId: mapping.id, cubeId, spaceId, domain: mapping.domain },
      { singletonKey: mapping.id }
    );
  } catch (enqueueErr) {
    // Roll the cooldown stamp back to its prior value so the customer can
    // retry immediately rather than being blocked by a failed enqueue.
    await db
      .update(schema.domainMappings)
      .set({ lastCachePurgeAt: mapping.lastCachePurgeAt })
      .where(eq(schema.domainMappings.id, mapping.id))
      .catch(() => {});
    console.error("[domain-purge-cache] failed to enqueue job:", enqueueErr);
    return {
      ok: false,
      status: 500,
      error: "Failed to schedule cache purge. Please try again.",
    };
  }

  await db.insert(schema.lifecycleLogs).values({
    entityType: "cube" as const,
    entityId: cubeId,
    message: `Cache clear requested for ${mapping.domain}`,
  });

  audit({
    action: "domain.cache_purge_requested",
    category: "domain",
    actorType: args.audit.actorType,
    actorId: args.audit.actorId,
    actorEmail: args.audit.actorEmail,
    entityType: "domain_mapping",
    entityId: mapping.id,
    spaceId,
    description: `Requested Cloudflare cache clear for ${mapping.domain}`,
    metadata: { domain: mapping.domain, cubeId, mappingId: mapping.id },
    source: args.source,
    ...args.reqCtx,
  });

  return {
    ok: true,
    data: {
      domain: mapping.domain,
      cooldownSeconds: DOMAIN_CACHE_PURGE_COOLDOWN_SECONDS,
    },
  };
}

/**
 * Shared business logic for
 * `POST /cubes/[cubeId]/domains/[mappingId]/purge-cache` (dashboard + v1).
 * Scopes the mapping to the cube + space before purging (defense in depth on
 * top of the route's permission gate).
 */
export async function purgeDomainCacheAction(
  ctx: CubeActionContext & { mappingId: string }
): Promise<CubeActionResult<{ domain: string; cooldownSeconds: number }>> {
  const { spaceId, cubeId, mappingId, actor, reqCtx } = ctx;

  const [mapping] = await db
    .select()
    .from(schema.domainMappings)
    .where(
      and(
        eq(schema.domainMappings.id, mappingId),
        eq(schema.domainMappings.cubeId, cubeId)
      )
    )
    .limit(1);
  if (!mapping) {
    return { ok: false, status: 404, error: "Domain mapping not found" };
  }

  const [cube] = await db
    .select({ id: schema.cubes.id })
    .from(schema.cubes)
    .where(and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId)))
    .limit(1);
  if (!cube) {
    return { ok: false, status: 404, error: "Cube not found" };
  }

  const { actorId, actorEmail } = actorAuditFields(actor);
  return runDomainCachePurge({
    mapping,
    spaceId,
    cubeId,
    audit: { actorType: "user", actorId, actorEmail },
    reqCtx,
    source: "api",
  });
}

/**
 * Shared business logic for the Orbit admin
 * `POST /orbit/domains/[mappingId]/purge-cache`. Resolves the owning cube +
 * space from the mapping itself (the admin route carries only the mappingId).
 */
export async function adminPurgeDomainCacheAction(args: {
  mappingId: string;
  actor: { userId: string; userEmail: string };
  reqCtx: { ipAddress: string | null; userAgent: string | null };
}): Promise<CubeActionResult<{ domain: string; cooldownSeconds: number }>> {
  const { mappingId, actor, reqCtx } = args;

  const [mapping] = await db
    .select()
    .from(schema.domainMappings)
    .where(eq(schema.domainMappings.id, mappingId))
    .limit(1);
  if (!mapping) {
    return { ok: false, status: 404, error: "Domain mapping not found" };
  }

  const [cube] = await db
    .select({ id: schema.cubes.id, spaceId: schema.cubes.spaceId })
    .from(schema.cubes)
    .where(eq(schema.cubes.id, mapping.cubeId))
    .limit(1);
  if (!cube) {
    return { ok: false, status: 404, error: "Cube not found" };
  }

  return runDomainCachePurge({
    mapping,
    spaceId: cube.spaceId,
    cubeId: cube.id,
    audit: {
      actorType: "admin",
      actorId: actor.userId,
      actorEmail: actor.userEmail,
    },
    reqCtx,
    source: "web",
  });
}
