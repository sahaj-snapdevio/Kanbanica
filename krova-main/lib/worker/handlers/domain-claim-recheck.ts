import { and, eq } from "drizzle-orm";
import { DOMAIN_CLAIM_MAX_FAILED_CHECKS } from "@/config/platform";
import { lifecycleLogs, spaceDomainClaims } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { recheckClaimDecision } from "@/lib/domains/claim-coverage";
import { verifyClaimTxt } from "@/lib/domains/verify-txt";
import { enqueueEmail } from "@/lib/email";
import { getSpaceOwner } from "@/lib/email/helpers";
import { env } from "@/lib/env";

/**
 * Daily re-check of every `verified` domain claim. Re-resolves the TXT record;
 * a successful check resets the miss counter, a miss increments it, and once it
 * reaches DOMAIN_CLAIM_MAX_FAILED_CHECKS the lock auto-releases
 * (`verified → failed`) so a removed TXT / transferred domain can't hold a
 * domain hostage forever. Idempotent; the 3-strike threshold tolerates a
 * transient DNS blip. The release flip is atomic (guarded on still-`verified`).
 */
export async function handleDomainClaimRecheck(): Promise<void> {
  const claims = await db
    .select()
    .from(spaceDomainClaims)
    .where(eq(spaceDomainClaims.status, "verified"));

  const now = new Date();

  for (const claim of claims) {
    const proven = await verifyClaimTxt(claim.domain, claim.token);
    const decision = recheckClaimDecision(
      claim.failedChecks,
      proven,
      DOMAIN_CLAIM_MAX_FAILED_CHECKS
    );

    if (!decision.release) {
      await db
        .update(spaceDomainClaims)
        .set({
          failedChecks: decision.failedChecks,
          lastCheckedAt: now,
          updatedAt: now,
        })
        .where(eq(spaceDomainClaims.id, claim.id));
      continue;
    }

    // Auto-release the lock. Atomic: only if the row is still `verified` (a
    // concurrent manual release / re-verify wins).
    const [released] = await db
      .update(spaceDomainClaims)
      .set({
        status: "failed",
        failedChecks: decision.failedChecks,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(spaceDomainClaims.id, claim.id),
          eq(spaceDomainClaims.status, "verified")
        )
      )
      .returning();
    if (!released) {
      continue;
    }

    await db.insert(lifecycleLogs).values({
      entityType: "space" as const,
      entityId: claim.spaceId,
      message: `Domain lock released for ${claim.domain} — the verification TXT record was no longer found`,
    });
    audit({
      action: "domain_claim.auto_released",
      category: "domain",
      actorType: "system",
      entityType: "space_domain_claim",
      entityId: claim.id,
      spaceId: claim.spaceId,
      description: `Auto-released domain lock ${claim.domain} after ${decision.failedChecks} failed rechecks`,
      metadata: { domain: claim.domain, claimId: claim.id },
      source: "worker",
    });

    // Best-effort owner notification — never let an email failure abort the run.
    try {
      const owner = await getSpaceOwner(claim.spaceId);
      if (owner) {
        const settingsUrl = `${env.NEXT_PUBLIC_APP_URL}/${claim.spaceId}/settings`;
        const { domainClaimReleasedEmailTemplate } = await import(
          "@/lib/email/templates/domain-claim-released"
        );
        const { html, text } = await domainClaimReleasedEmailTemplate({
          userName: owner.name,
          spaceName: owner.spaceName,
          domain: claim.domain,
          settingsUrl,
        });
        await enqueueEmail({
          to: owner.email,
          subject: `Domain lock released — ${claim.domain}`,
          html,
          text,
        });
      }
    } catch (err) {
      console.error(
        `[domain-claim-recheck] failed to send release email for ${claim.domain}:`,
        err
      );
    }
  }
}
