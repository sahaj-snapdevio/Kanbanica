"use server";

import { headers } from "next/headers";
import { requireActionMembershipAndPermission } from "@/lib/actions/auth-helpers";
import { extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { claimTxtHost, claimTxtValue } from "@/lib/domains/claim-coverage";
import {
  type ClaimActor,
  createClaim,
  releaseClaim,
  verifyClaim,
} from "@/lib/domains/claim-service";

/**
 * Resolve the acting member for a space-domain-claim mutation. Claims are
 * gated by `cube.manage` — the permission that already governs custom domains
 * (owners always have it).
 */
async function getClaimActor(
  spaceId: string
): Promise<{ actor: ClaimActor } | { error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return { error: "Unauthorized" };
  }
  const permResult = await requireActionMembershipAndPermission(
    session.user.id,
    spaceId,
    "cube.manage"
  );
  if ("error" in permResult) {
    return { error: permResult.error };
  }
  const reqCtx = extractRequestContext(await headers());
  return {
    actor: {
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      ipAddress: reqCtx.ipAddress,
      userAgent: reqCtx.userAgent,
    },
  };
}

export async function createDomainClaim(spaceId: string, rawDomain: string) {
  const a = await getClaimActor(spaceId);
  if ("error" in a) {
    return { error: a.error };
  }
  const result = await createClaim(spaceId, rawDomain, a.actor);
  if (!result.ok) {
    return { error: result.error };
  }
  const { claim } = result.data;
  return {
    ok: true as const,
    domain: claim.domain,
    txtName: claimTxtHost(claim.domain),
    txtValue: claimTxtValue(claim.token),
  };
}

export async function verifyDomainClaim(spaceId: string, claimId: string) {
  const a = await getClaimActor(spaceId);
  if ("error" in a) {
    return { error: a.error };
  }
  const result = await verifyClaim(spaceId, claimId, a.actor);
  if (!result.ok) {
    return { error: result.error };
  }
  return { ok: true as const, status: result.data.claim.status };
}

export async function releaseDomainClaim(spaceId: string, claimId: string) {
  const a = await getClaimActor(spaceId);
  if ("error" in a) {
    return { error: a.error };
  }
  const result = await releaseClaim(spaceId, claimId, a.actor);
  if (!result.ok) {
    return { error: result.error };
  }
  return { ok: true as const };
}
