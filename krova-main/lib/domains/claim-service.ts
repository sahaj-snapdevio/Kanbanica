/**
 * Space domain-claim service — the DB + audit logic behind the
 * `app/actions/domain-claims.ts` server actions, the `addDomainAction` lock,
 * and the `domain-claim.recheck` cron. Kept OUT of a `"use server"` file so
 * the verify path can take an injectable verifier for tests (and so these
 * helpers are importable by the worker + the cube-action layer).
 */

import { randomBytes } from "node:crypto";
import { and, eq, inArray, like, ne, or } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { SpaceDomainClaim } from "@/db/schema/types";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  candidateParentDomains,
  claimsOverlap,
  normalizeClaimDomain,
} from "@/lib/domains/claim-coverage";
import { verifyClaimTxt } from "@/lib/domains/verify-txt";

export type ClaimActor = {
  actorType: "user" | "admin";
  actorId: string;
  actorEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export type ClaimResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: 400 | 403 | 404 | 409 | 422 | 500;
      error: string;
    };

function isUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

/**
 * The verified claim in ANOTHER space that locks `hostname`, or null. This is
 * the cross-space lock enforcement used by `addDomainAction`: a verified claim
 * on any parent of `hostname` (or on `hostname` itself), owned by a different
 * space, blocks the mapping. Indexed `domain IN (parents)` lookup.
 */
export async function findCrossSpaceLock(
  hostname: string,
  spaceId: string
): Promise<SpaceDomainClaim | null> {
  const parents = candidateParentDomains(hostname);
  if (parents.length === 0) {
    return null;
  }
  const rows = await db
    .select()
    .from(schema.spaceDomainClaims)
    .where(
      and(
        inArray(schema.spaceDomainClaims.domain, parents),
        eq(schema.spaceDomainClaims.status, "verified")
      )
    );
  return rows.find((c) => c.spaceId !== spaceId) ?? null;
}

/**
 * An in-use (`active`/`pending`) domain mapping under `claimDomain` owned by a
 * DIFFERENT space, or null. Used at verify time: we refuse to lock a domain out
 * from under another space's live mapping (conservative — operator resolves).
 * `LIKE '%.<domain>'` matches subdomains by suffix; the leading dot enforces the
 * boundary (domains never contain `_`/`%`, so no LIKE-metachar hazard).
 */
export async function findActiveMappingUnderDomainOtherSpace(
  claimDomain: string,
  spaceId: string
): Promise<{ domain: string; spaceId: string | null } | null> {
  const rows = await db
    .select({
      domain: schema.domainMappings.domain,
      spaceId: schema.cubes.spaceId,
    })
    .from(schema.domainMappings)
    .innerJoin(schema.cubes, eq(schema.cubes.id, schema.domainMappings.cubeId))
    .where(
      and(
        ne(schema.domainMappings.status, "stopping"),
        or(
          eq(schema.domainMappings.domain, claimDomain),
          like(schema.domainMappings.domain, `%.${claimDomain}`)
        )
      )
    );
  return rows.find((r) => r.spaceId !== spaceId) ?? null;
}

/** Create a `pending` claim for `rawDomain` in `spaceId`. */
export async function createClaim(
  spaceId: string,
  rawDomain: unknown,
  actor: ClaimActor
): Promise<ClaimResult<{ claim: SpaceDomainClaim }>> {
  const domain = normalizeClaimDomain(rawDomain);
  if (!domain) {
    return {
      ok: false,
      status: 400,
      error: "Enter a valid domain, e.g. acme.com (no wildcards or schemes).",
    };
  }

  // Block immediately if the domain overlaps any OTHER space's VERIFIED claim
  // (disjoint subtrees across spaces). Pending claims don't lock, so same/other
  // spaces may hold overlapping pending claims — the verify step + the partial
  // unique index decide the winner. Verified claims are few; scan + check in JS.
  const verified = await db
    .select()
    .from(schema.spaceDomainClaims)
    .where(eq(schema.spaceDomainClaims.status, "verified"));
  const conflict = verified.find(
    (c) => c.spaceId !== spaceId && claimsOverlap(c.domain, domain)
  );
  if (conflict) {
    return {
      ok: false,
      status: 409,
      error:
        "This domain (or a parent/subdomain of it) is locked to another space.",
    };
  }

  const token = randomBytes(16).toString("hex");
  let claim: SpaceDomainClaim;
  try {
    const [row] = await db
      .insert(schema.spaceDomainClaims)
      .values({ spaceId, domain, token, status: "pending" })
      .returning();
    if (!row) {
      return { ok: false, status: 500, error: "Internal server error" };
    }
    claim = row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        error: "This space has already added that domain.",
      };
    }
    throw err;
  }

  await db.insert(schema.lifecycleLogs).values({
    entityType: "space" as const,
    entityId: spaceId,
    message: `Domain claim added: ${domain} (pending verification)`,
  });
  audit({
    action: "domain_claim.create",
    category: "domain",
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    entityType: "space_domain_claim",
    entityId: claim.id,
    spaceId,
    description: `Added domain claim ${domain}`,
    metadata: { domain, claimId: claim.id },
    source: "web",
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return { ok: true, data: { claim } };
}

/**
 * Run TXT verification for a pending claim and, on success + no conflict, lock
 * the domain to the space. `verify` is injectable for tests (defaults to the
 * real DNS check). Fail-closed: a missing TXT leaves the claim `pending`.
 */
export async function verifyClaim(
  spaceId: string,
  claimId: string,
  actor: ClaimActor,
  verify: (domain: string, token: string) => Promise<boolean> = verifyClaimTxt
): Promise<ClaimResult<{ claim: SpaceDomainClaim }>> {
  const [claim] = await db
    .select()
    .from(schema.spaceDomainClaims)
    .where(
      and(
        eq(schema.spaceDomainClaims.id, claimId),
        eq(schema.spaceDomainClaims.spaceId, spaceId)
      )
    )
    .limit(1);
  if (!claim) {
    return { ok: false, status: 404, error: "Domain claim not found" };
  }
  if (claim.status === "verified") {
    return { ok: true, data: { claim } }; // idempotent
  }

  const now = new Date();
  const proven = await verify(claim.domain, claim.token);
  if (!proven) {
    await db
      .update(schema.spaceDomainClaims)
      .set({ lastCheckedAt: now, updatedAt: now })
      .where(eq(schema.spaceDomainClaims.id, claimId));
    return {
      ok: false,
      status: 422,
      error:
        "TXT record not found yet. Add the record shown above and try again — DNS can take a few minutes to propagate.",
    };
  }

  // Proven. Conflict guards before locking:
  // (a) another space verified an overlapping domain in the meantime.
  const verified = await db
    .select()
    .from(schema.spaceDomainClaims)
    .where(eq(schema.spaceDomainClaims.status, "verified"));
  if (
    verified.some(
      (c) => c.spaceId !== spaceId && claimsOverlap(c.domain, claim.domain)
    )
  ) {
    return {
      ok: false,
      status: 409,
      error: "This domain is now locked to another space.",
    };
  }
  // (b) another space has a live mapping under this domain — never auto-evict;
  // surface to operators and refuse (the customer is told to contact support).
  const blockingMapping = await findActiveMappingUnderDomainOtherSpace(
    claim.domain,
    spaceId
  );
  if (blockingMapping) {
    audit({
      action: "domain_claim.verify_conflict",
      category: "domain",
      actorType: "system",
      entityType: "space_domain_claim",
      entityId: claim.id,
      spaceId,
      description: `Domain claim ${claim.domain} verified ownership but another space has an active mapping (${blockingMapping.domain}) under it — manual resolution required`,
      metadata: {
        domain: claim.domain,
        conflictingMapping: blockingMapping.domain,
        conflictingSpaceId: blockingMapping.spaceId,
      },
      source: "web",
    });
    return {
      ok: false,
      status: 409,
      error:
        "Another space is currently using a hostname under this domain. Contact support to resolve ownership.",
    };
  }

  // Atomic flip pending → verified; the partial unique index is the backstop.
  try {
    const [updated] = await db
      .update(schema.spaceDomainClaims)
      .set({
        status: "verified",
        verifiedAt: now,
        lastCheckedAt: now,
        failedChecks: 0,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.spaceDomainClaims.id, claimId),
          eq(schema.spaceDomainClaims.status, "pending")
        )
      )
      .returning();
    if (!updated) {
      // Lost a race (already verified/changed) — re-read for a sane response.
      const [current] = await db
        .select()
        .from(schema.spaceDomainClaims)
        .where(eq(schema.spaceDomainClaims.id, claimId))
        .limit(1);
      if (current?.status === "verified") {
        return { ok: true, data: { claim: current } };
      }
      return { ok: false, status: 409, error: "Claim could not be verified." };
    }

    await db.insert(schema.lifecycleLogs).values({
      entityType: "space" as const,
      entityId: spaceId,
      message: `Domain ${claim.domain} verified and locked to this space`,
    });
    audit({
      action: "domain_claim.verify",
      category: "domain",
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorEmail: actor.actorEmail,
      entityType: "space_domain_claim",
      entityId: claim.id,
      spaceId,
      description: `Verified + locked domain ${claim.domain}`,
      metadata: { domain: claim.domain, claimId: claim.id },
      source: "web",
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return { ok: true, data: { claim: updated } };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        status: 409,
        error: "This domain was just locked by another space.",
      };
    }
    throw err;
  }
}

/** Release (delete) a claim, freeing the lock. The space's own mappings stay. */
export async function releaseClaim(
  spaceId: string,
  claimId: string,
  actor: ClaimActor
): Promise<ClaimResult<{ domain: string }>> {
  const [claim] = await db
    .select()
    .from(schema.spaceDomainClaims)
    .where(
      and(
        eq(schema.spaceDomainClaims.id, claimId),
        eq(schema.spaceDomainClaims.spaceId, spaceId)
      )
    )
    .limit(1);
  if (!claim) {
    return { ok: false, status: 404, error: "Domain claim not found" };
  }

  await db
    .delete(schema.spaceDomainClaims)
    .where(eq(schema.spaceDomainClaims.id, claimId));

  await db.insert(schema.lifecycleLogs).values({
    entityType: "space" as const,
    entityId: spaceId,
    message: `Domain claim released: ${claim.domain}`,
  });
  audit({
    action: "domain_claim.release",
    category: "domain",
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    entityType: "space_domain_claim",
    entityId: claim.id,
    spaceId,
    description: `Released domain claim ${claim.domain}`,
    metadata: { domain: claim.domain, claimId: claim.id },
    source: "web",
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return { ok: true, data: { domain: claim.domain } };
}
