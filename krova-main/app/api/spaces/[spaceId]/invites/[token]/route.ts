import { createId } from "@paralleldrive/cuid2";
import { and, count, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import type { PermissionValue } from "@/db/schema/types";
import { requireSession } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  assertCanInviteMemberV2,
  loadEffectiveLimitsTx,
} from "@/lib/plan/limits";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; token: string }> }
) {
  try {
    const { spaceId, token } = await params;
    const session = await requireSession(request);

    // Find the invite by token and spaceId
    const [invite] = await db
      .select()
      .from(schema.invites)
      .where(
        and(
          eq(schema.invites.token, token),
          eq(schema.invites.spaceId, spaceId)
        )
      )
      .limit(1);

    if (!invite) {
      return Response.json({ error: "Invite not found" }, { status: 404 });
    }

    if (invite.status !== "pending") {
      return Response.json(
        { error: `Invite has already been ${invite.status}` },
        { status: 400 }
      );
    }

    if (invite.expiresAt < new Date()) {
      // Mark as expired
      await db
        .update(schema.invites)
        .set({ status: "expired" })
        .where(eq(schema.invites.id, invite.id));
      return Response.json({ error: "Invite has expired" }, { status: 410 });
    }

    // Verify the accepting user's email matches the invite
    if (session.user.email.toLowerCase() !== invite.email.toLowerCase()) {
      return Response.json(
        { error: "This invite was sent to a different email address" },
        { status: 403 }
      );
    }

    // Check if user is already a member
    const existingMembership = await db
      .select()
      .from(schema.spaceMemberships)
      .where(
        and(
          eq(schema.spaceMemberships.userId, session.user.id),
          eq(schema.spaceMemberships.spaceId, spaceId)
        )
      )
      .limit(1);

    if (existingMembership.length > 0) {
      // Mark invite as accepted even though user is already a member
      await db
        .update(schema.invites)
        .set({ status: "accepted" })
        .where(eq(schema.invites.id, invite.id));
      return Response.json(
        { error: "You are already a member of this space" },
        { status: 409 }
      );
    }

    const membershipId = createId();
    const invitePermissions = (invite.permissions as PermissionValue[]) ?? [];
    const inviteCubeAssignments = (invite.cubeAssignments as string[]) ?? [];

    // Plan-limit enforcement: count members inside the transaction and
    // re-check the seat limit here (authoritative point). Note: this is not
    // fully race-proof against two simultaneous accepts of different invites
    // under READ COMMITTED — acceptable today since a space has a single user;
    // revisit with a space-row lock if true multi-user teams ship.
    const txResult = await db.transaction(async (tx) => {
      const [{ memberCount }] = await tx
        .select({ memberCount: count() })
        .from(schema.spaceMemberships)
        .where(eq(schema.spaceMemberships.spaceId, spaceId));
      const limits = await loadEffectiveLimitsTx(tx, spaceId);
      const seatCheck = assertCanInviteMemberV2(limits, Number(memberCount));
      if (!seatCheck.ok) {
        return { error: seatCheck.error };
      }

      // Create membership
      await tx.insert(schema.spaceMemberships).values({
        id: membershipId,
        userId: session.user.id,
        spaceId,
        isOwner: false,
      });

      // Create permissions from invite
      if (invitePermissions.length > 0) {
        await tx.insert(schema.memberPermissions).values(
          invitePermissions.map((p) => ({
            id: createId(),
            membershipId,
            permission: p,
          }))
        );
      }

      // Create Cube assignments from invite
      if (inviteCubeAssignments.length > 0) {
        await tx.insert(schema.memberCubeAssignments).values(
          inviteCubeAssignments.map((cubeId) => ({
            id: createId(),
            membershipId,
            cubeId,
          }))
        );
      }

      // Mark invite as accepted
      await tx
        .update(schema.invites)
        .set({ status: "accepted" })
        .where(eq(schema.invites.id, invite.id));

      await tx.insert(schema.lifecycleLogs).values({
        entityType: "space",
        entityId: spaceId,
        message: `Invite accepted by ${session.user.email} (user ${session.user.id})`,
      });

      return { ok: true as const };
    });

    if ("error" in txResult) {
      return Response.json({ error: txResult.error }, { status: 403 });
    }

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "invite.accepted",
      category: "member",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "invite",
      entityId: invite.id,
      spaceId,
      description: `${session.user.email} accepted invite to space ${spaceId}`,
      metadata: {
        membershipId,
        permissions: invitePermissions,
        cubeAssignments: inviteCubeAssignments,
      },
      source: "api",
      ...reqCtx,
    });

    // Return the new membership with details
    const [newMembership] = await db
      .select()
      .from(schema.spaceMemberships)
      .where(eq(schema.spaceMemberships.id, membershipId))
      .limit(1);

    const [space] = await db
      .select()
      .from(schema.spaces)
      .where(eq(schema.spaces.id, spaceId))
      .limit(1);

    return Response.json(
      {
        membership: {
          ...newMembership,
          permissions: invitePermissions,
          cubeAssignments: inviteCubeAssignments,
        },
        space,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
