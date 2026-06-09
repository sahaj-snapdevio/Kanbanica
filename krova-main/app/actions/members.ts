"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import * as schema from "@/db/schema";
import { requireActionMembershipAndPermission } from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueEmailitSync } from "@/lib/emailit/enqueue-sync";
import {
  removeMemberFromSpace,
  updateMemberPermissionsAndAssignments,
} from "@/lib/members";
import { getPaymentProvider } from "@/lib/payments";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildMemberPayload } from "@/lib/webhook-payloads";

export async function updateMemberPermissions(
  spaceId: string,
  memberId: string,
  data: {
    permissions?: string[];
    cubeAssignments?: string[];
  }
): Promise<{ success: true } | { error: string }> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "members.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    // Find target membership
    const [targetMembership] = await db
      .select()
      .from(schema.spaceMemberships)
      .where(
        and(
          eq(schema.spaceMemberships.id, memberId),
          eq(schema.spaceMemberships.spaceId, spaceId)
        )
      )
      .limit(1);

    if (!targetMembership) {
      return { error: "Member not found in this space" };
    }

    if (targetMembership.isOwner) {
      return { error: "Cannot modify owner permissions" };
    }

    // Use shared helper for the actual update
    const updateError = await updateMemberPermissionsAndAssignments(
      memberId,
      spaceId,
      data
    );
    if (updateError) {
      return updateError;
    }

    await db.insert(schema.lifecycleLogs).values({
      entityType: "space",
      entityId: spaceId,
      message: `Permissions updated for member ${memberId}`,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "member.update_permissions",
      category: "member",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "membership",
      entityId: memberId,
      spaceId,
      description: `Updated permissions for member ${memberId}`,
      metadata: {
        targetUserId: targetMembership.userId,
        permissions: data.permissions,
        cubeAssignments: data.cubeAssignments,
      },
      ...reqCtx,
    });

    const [targetUser] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, targetMembership.userId))
      .limit(1);
    dispatchWebhookEvent(spaceId, "member.role_changed", {
      member: buildMemberPayload({
        email: targetUser?.email ?? "",
        permissions: data.permissions ?? [],
        userId: targetMembership.userId,
      }),
    });

    return { success: true };
  } catch (error) {
    console.error("updateMemberPermissions error:", error);
    return {
      error:
        "Something went wrong while updating permissions. Please try again.",
    };
  }
}

export async function removeMember(spaceId: string, memberId: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "members.manage"
    );
    if ("error" in permResult) {
      return permResult;
    }

    // Find target membership
    const [targetMembership] = await db
      .select()
      .from(schema.spaceMemberships)
      .where(
        and(
          eq(schema.spaceMemberships.id, memberId),
          eq(schema.spaceMemberships.spaceId, spaceId)
        )
      )
      .limit(1);

    if (!targetMembership) {
      return { error: "Member not found in this space" };
    }

    if (targetMembership.isOwner) {
      return {
        error: "The space owner cannot be removed. Transfer ownership first.",
      };
    }

    // Use shared helper for the actual removal
    const { accountDeleted } = await removeMemberFromSpace(
      memberId,
      targetMembership.userId,
      spaceId
    );

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "member.remove",
      category: "member",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "membership",
      entityId: memberId,
      spaceId,
      description: `Removed member ${memberId} from space`,
      metadata: { targetUserId: targetMembership.userId, accountDeleted },
      ...reqCtx,
    });

    dispatchWebhookEvent(spaceId, "member.removed", {
      member: buildMemberPayload({
        email: "",
        permissions: [],
        userId: targetMembership.userId,
      }),
      accountDeleted,
    });

    return { success: true };
  } catch (error) {
    console.error("removeMember error:", error);
    return {
      error:
        "Something went wrong while removing the member. Please try again.",
    };
  }
}

export async function transferOwnership(spaceId: string, newOwnerId: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    // Current user must be the owner
    const [currentMembership] = await db
      .select()
      .from(schema.spaceMemberships)
      .where(
        and(
          eq(schema.spaceMemberships.userId, session.user.id),
          eq(schema.spaceMemberships.spaceId, spaceId)
        )
      )
      .limit(1);

    if (!currentMembership) {
      return { error: "Forbidden: not a member of this space" };
    }

    if (!currentMembership.isOwner) {
      return { error: "Only the current owner can transfer ownership" };
    }

    // Find new owner membership
    const [newOwnerMembership] = await db
      .select()
      .from(schema.spaceMemberships)
      .where(
        and(
          eq(schema.spaceMemberships.userId, newOwnerId),
          eq(schema.spaceMemberships.spaceId, spaceId)
        )
      )
      .limit(1);

    if (!newOwnerMembership) {
      return { error: "New owner must be a member of this space" };
    }

    if (newOwnerMembership.userId === currentMembership.userId) {
      return { error: "This user is already the owner" };
    }

    // Look up the new owner's contact info now (inside the action, before
    // the tx) — we hand it to Polar after the DB commit to re-point invoice
    // emails. The original owner's PAYMENT METHOD stays on file at Polar
    // (we can't move cards across customers); the new owner uses Polar's
    // hosted customer portal to swap it.
    const [newOwnerUser] = await db
      .select({ email: schema.user.email, name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.id, newOwnerId))
      .limit(1);
    if (!newOwnerUser) {
      return { error: "New owner user not found" };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(schema.spaceMemberships)
        .set({ isOwner: false })
        .where(eq(schema.spaceMemberships.id, currentMembership.id));

      await tx
        .update(schema.spaceMemberships)
        .set({ isOwner: true })
        .where(eq(schema.spaceMemberships.id, newOwnerMembership.id));
    });

    // Post-commit: re-point the Polar customer's contact info to the new
    // owner. No-op on a free-plan space (no Polar customer exists yet). A
    // provider failure is non-fatal — the DB transfer already succeeded;
    // log + continue so the operator can re-run the sync later if needed.
    try {
      await getPaymentProvider().updateCustomerForSpace(spaceId, {
        email: newOwnerUser.email,
        name: newOwnerUser.name ?? null,
      });
    } catch (err) {
      console.error(
        `[transferOwnership] Polar customer update failed for space ${spaceId} — DB transfer succeeded, Polar contact still points at the old owner. Re-run when possible.`,
        err
      );
    }

    await db.insert(schema.lifecycleLogs).values({
      entityType: "space",
      entityId: spaceId,
      message: `Ownership transferred from ${session.user.id} to ${newOwnerId}`,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "space.transfer_ownership",
      category: "space",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "space",
      entityId: spaceId,
      spaceId,
      description: `Transferred ownership to user ${newOwnerId}`,
      metadata: { previousOwnerId: session.user.id, newOwnerId },
      ...reqCtx,
    });

    // Both sides changed: the old owner's owned_space_count dropped (and
    // is_team_member may have flipped to true); the new owner's increased.
    await enqueueEmailitSync(session.user.id);
    await enqueueEmailitSync(newOwnerId);

    return { success: true };
  } catch (error) {
    console.error("transferOwnership error:", error);
    return {
      error:
        "Something went wrong while transferring ownership. Please try again.",
    };
  }
}
