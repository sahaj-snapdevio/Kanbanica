"use server";

import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { headers } from "next/headers";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES } from "@/db/schema/types";
import { requireActionMembershipAndPermission } from "@/lib/actions/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { inviteEmailTemplate } from "@/lib/email/templates/invite";
import { enqueueEmailitSync } from "@/lib/emailit/enqueue-sync";
import { env } from "@/lib/env";
import { acceptInviteInTx } from "@/lib/invites/accept";
import {
  assertCanInviteMemberV2,
  loadEffectiveLimits,
} from "@/lib/plan/limits";
import { countSpaceMembers } from "@/lib/plan/usage";
import { validateEmail } from "@/lib/validators";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildInvitePayload, buildMemberPayload } from "@/lib/webhook-payloads";

export async function sendInvite(
  spaceId: string,
  data: {
    email: string;
    permissions: string[];
    cubeAssignments: string[];
  }
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "members.invite"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const { email, permissions, cubeAssignments } = data;

    // Plan-limit enforcement (early courtesy check; acceptInvite is authoritative).
    const limits = await loadEffectiveLimits(spaceId);
    const seatCount = await countSpaceMembers(spaceId);
    const seatCheck = assertCanInviteMemberV2(limits, seatCount);
    if (!seatCheck.ok) {
      return { error: seatCheck.error };
    }

    // Validate permissions against known values
    if (permissions && permissions.length > 0) {
      const validPerms = new Set<string>(PERMISSION_VALUES);
      const invalidPerms = permissions.filter((p) => !validPerms.has(p));
      if (invalidPerms.length > 0) {
        return { error: `Invalid permissions: ${invalidPerms.join(", ")}` };
      }
    }

    // Validate cube assignments belong to this space and are not deleted
    if (cubeAssignments && cubeAssignments.length > 0) {
      const validCubes = await db
        .select({ id: schema.cubes.id })
        .from(schema.cubes)
        .where(
          and(
            eq(schema.cubes.spaceId, spaceId),
            inArray(schema.cubes.id, cubeAssignments),
            ne(schema.cubes.status, "deleted")
          )
        );
      const validCubeIds = new Set(validCubes.map((v) => v.id));
      const invalidIds = cubeAssignments.filter((id) => !validCubeIds.has(id));
      if (invalidIds.length > 0) {
        return { error: "One or more cube assignments are invalid" };
      }
    }

    const validatedEmail = validateEmail(email);
    if (!validatedEmail) {
      return { error: "Invalid email format" };
    }

    // Check if user is already a member
    const existingUser = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, validatedEmail))
      .limit(1);

    if (existingUser.length > 0) {
      const existingMembership = await db
        .select()
        .from(schema.spaceMemberships)
        .where(
          and(
            eq(schema.spaceMemberships.userId, existingUser[0].id),
            eq(schema.spaceMemberships.spaceId, spaceId)
          )
        )
        .limit(1);

      if (existingMembership.length > 0) {
        return { error: "This user is already a member of the space" };
      }
    }

    // Check for existing pending invite
    const existingInvite = await db
      .select()
      .from(schema.invites)
      .where(
        and(
          eq(schema.invites.email, validatedEmail),
          eq(schema.invites.spaceId, spaceId),
          eq(schema.invites.status, "pending")
        )
      )
      .limit(1);

    if (existingInvite.length > 0) {
      return { error: "A pending invite already exists for this email" };
    }

    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [invite] = await db
      .insert(schema.invites)
      .values({
        id: createId(),
        email: validatedEmail,
        spaceId,
        permissions: permissions ?? [],
        cubeAssignments: cubeAssignments ?? [],
        token,
        status: "pending",
        invitedBy: session.user.id,
        expiresAt,
      })
      .returning();

    await db.insert(schema.lifecycleLogs).values({
      entityType: "space",
      entityId: spaceId,
      message: `Invite sent to ${validatedEmail}`,
    });

    const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/invite/${token}`;

    // Load space name for the email
    const [space] = await db
      .select({ name: schema.spaces.name })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);

    let emailWarning: string | undefined;
    if (space) {
      const { html, text } = await inviteEmailTemplate({
        invitedByName: session.user.name,
        spaceName: space.name,
        inviteUrl,
        permissions: permissions ?? [],
        expiresAt,
      });

      try {
        await enqueueEmail({
          to: validatedEmail,
          subject: `You've been invited to join ${space.name}`,
          html,
          text,
        });
      } catch (err) {
        console.error("[invites] failed to enqueue invite email:", err);
        emailWarning =
          "Invite created, but the email failed to send. Copy the link below or resend the invite from the members list.";
      }
    } else {
      emailWarning =
        "Invite created, but no email was sent because the space could not be loaded.";
    }

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "invite.send",
      category: "invite",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "invite",
      entityId: invite.id,
      spaceId,
      description: `Sent invite to ${validatedEmail}`,
      metadata: {
        inviteeEmail: validatedEmail,
        permissions,
        cubeAssignments,
        expiresAt: expiresAt.toISOString(),
        emailDeliveryFailed: emailWarning != null,
      },
      ...reqCtx,
    });

    dispatchWebhookEvent(spaceId, "member.invited", {
      invite: buildInvitePayload({
        email: validatedEmail,
        id: invite.id,
        permissions,
      }),
    });

    return {
      success: true,
      data: { ...invite, inviteUrl },
      warning: emailWarning,
    };
  } catch (error) {
    console.error("sendInvite error:", error);
    return {
      error: "Something went wrong while sending the invite. Please try again.",
    };
  }
}

export async function cancelInvite(spaceId: string, inviteId: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "members.invite"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const [invite] = await db
      .select()
      .from(schema.invites)
      .where(
        and(
          eq(schema.invites.id, inviteId),
          eq(schema.invites.spaceId, spaceId)
        )
      )
      .limit(1);

    if (!invite) {
      return { error: "Invite not found" };
    }
    if (invite.status === "accepted") {
      return {
        error: "Cannot revoke an invite that has already been accepted",
      };
    }
    if (invite.status === "revoked") {
      return { error: "Invite is already revoked" };
    }

    await db
      .update(schema.invites)
      .set({ status: "revoked" })
      .where(eq(schema.invites.id, inviteId));

    await db.insert(schema.lifecycleLogs).values({
      entityType: "space",
      entityId: spaceId,
      message: `Invite to ${invite.email} revoked`,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "invite.revoke",
      category: "invite",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "invite",
      entityId: invite.id,
      spaceId,
      description: `Revoked invite to ${invite.email}`,
      metadata: {
        inviteeEmail: invite.email,
        previousStatus: invite.status,
      },
      ...reqCtx,
    });

    return { success: true as const };
  } catch (error) {
    console.error("cancelInvite error:", error);
    return {
      error:
        "Something went wrong while revoking the invite. Please try again.",
    };
  }
}

export async function resendInvite(spaceId: string, inviteId: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    const permResult = await requireActionMembershipAndPermission(
      session.user.id,
      spaceId,
      "members.invite"
    );
    if ("error" in permResult) {
      return permResult;
    }

    const [invite] = await db
      .select()
      .from(schema.invites)
      .where(
        and(
          eq(schema.invites.id, inviteId),
          eq(schema.invites.spaceId, spaceId)
        )
      )
      .limit(1);

    if (!invite) {
      return { error: "Invite not found" };
    }
    if (invite.status === "accepted") {
      return { error: "This invite has already been accepted" };
    }
    if (invite.status === "revoked") {
      return { error: "Revoked invites cannot be resent — send a new invite" };
    }

    // Re-check seat limit before extending the invite — the space's plan may
    // have changed since the original send.
    const limits = await loadEffectiveLimits(spaceId);
    const seatCount = await countSpaceMembers(spaceId);
    const seatCheck = assertCanInviteMemberV2(limits, seatCount);
    if (!seatCheck.ok) {
      return { error: seatCheck.error };
    }

    // Rotate the token (invalidates any leaked previous link) and extend expiry.
    const newToken = nanoid(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await db
      .update(schema.invites)
      .set({
        token: newToken,
        status: "pending",
        expiresAt,
      })
      .where(eq(schema.invites.id, invite.id));

    const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/invite/${newToken}`;

    const [space] = await db
      .select({ name: schema.spaces.name })
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);

    let emailWarning: string | undefined;
    if (space) {
      const { html, text } = await inviteEmailTemplate({
        invitedByName: session.user.name,
        spaceName: space.name,
        inviteUrl,
        permissions: (invite.permissions as string[]) ?? [],
        expiresAt,
      });

      try {
        await enqueueEmail({
          to: invite.email,
          subject: `You've been invited to join ${space.name}`,
          html,
          text,
        });
      } catch (err) {
        console.error("[invites] failed to enqueue resend email:", err);
        emailWarning =
          "Invite refreshed, but the email failed to send. Copy the link to share it manually.";
      }
    } else {
      emailWarning =
        "Invite refreshed, but no email was sent because the space could not be loaded.";
    }

    await db.insert(schema.lifecycleLogs).values({
      entityType: "space",
      entityId: spaceId,
      message: `Invite to ${invite.email} resent`,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "invite.resend",
      category: "invite",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "invite",
      entityId: invite.id,
      spaceId,
      description: `Resent invite to ${invite.email}`,
      metadata: {
        inviteeEmail: invite.email,
        previousStatus: invite.status,
        newExpiresAt: expiresAt.toISOString(),
        emailDeliveryFailed: emailWarning != null,
      },
      ...reqCtx,
    });

    return {
      success: true as const,
      data: { inviteUrl, expiresAt },
      warning: emailWarning,
    };
  } catch (error) {
    console.error("resendInvite error:", error);
    return {
      error:
        "Something went wrong while resending the invite. Please try again.",
    };
  }
}

export async function acceptInvite(token: string) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return { error: "Unauthorized" };
    }

    if (!token || typeof token !== "string") {
      return { error: "Token is required" };
    }

    const [inviteLookup] = await db
      .select({ id: schema.invites.id, email: schema.invites.email })
      .from(schema.invites)
      .where(eq(schema.invites.token, token))
      .limit(1);

    if (!inviteLookup) {
      return { error: "This invite link is no longer valid" };
    }

    if (session.user.email.toLowerCase() !== inviteLookup.email.toLowerCase()) {
      return { error: "This invite was sent to a different email address" };
    }

    const result = await db.transaction(async (tx) =>
      acceptInviteInTx({
        tx,
        inviteId: inviteLookup.id,
        userId: session.user.id,
        userEmail: session.user.email,
      })
    );

    if (!result.ok) {
      return { error: result.error };
    }

    await db.insert(schema.lifecycleLogs).values({
      entityType: "space",
      entityId: result.spaceId,
      message: result.wasExistingMember
        ? `Invite resolved for existing member ${session.user.email}`
        : `Invite accepted by ${session.user.email}`,
    });

    const reqCtx = extractRequestContext(await headers());
    audit({
      action: "invite.accept",
      category: "invite",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "invite",
      entityId: result.inviteId,
      spaceId: result.spaceId,
      description: result.wasExistingMember
        ? "Invite resolved — membership already existed"
        : "Accepted invite to space",
      metadata: {
        invitedBy: result.invitedBy,
        // Don't claim permissions/cubeAssignments were applied when the
        // membership pre-existed — no rows were written for them.
        permissions: result.wasExistingMember ? [] : result.invitePermissions,
        cubeAssignments: result.wasExistingMember
          ? []
          : result.inviteCubeAssignments,
        wasExistingMember: result.wasExistingMember,
      },
      ...reqCtx,
    });

    if (!result.wasExistingMember) {
      // space_count / is_team_member just changed for the joiner.
      await enqueueEmailitSync(session.user.id);
      dispatchWebhookEvent(result.spaceId, "member.joined", {
        member: buildMemberPayload({
          email: session.user.email,
          permissions: result.invitePermissions ?? [],
          userId: session.user.id,
        }),
      });
    }

    return { success: true as const, data: { spaceId: result.spaceId } };
  } catch (error) {
    console.error("acceptInvite error:", error);
    return {
      error:
        "Something went wrong while accepting the invite. Please try again.",
    };
  }
}
