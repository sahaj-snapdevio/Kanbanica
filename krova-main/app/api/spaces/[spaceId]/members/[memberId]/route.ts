import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import type { PermissionValue } from "@/db/schema/types";
import { requirePermission, requireSpaceMember } from "@/lib/api/auth-helpers";
import { audit, extractRequestContext } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  removeMemberFromSpace,
  updateMemberPermissionsAndAssignments,
} from "@/lib/members";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; memberId: string }> }
) {
  try {
    const { spaceId, memberId } = await params;
    const { membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "members.manage");

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
      return Response.json({ error: "Member not found" }, { status: 404 });
    }

    const [memberUser] = await db
      .select({
        id: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
      })
      .from(schema.user)
      .where(eq(schema.user.id, targetMembership.userId))
      .limit(1);

    const permissions = await db
      .select()
      .from(schema.memberPermissions)
      .where(eq(schema.memberPermissions.membershipId, memberId));

    const cubeAssignments = await db
      .select()
      .from(schema.memberCubeAssignments)
      .where(eq(schema.memberCubeAssignments.membershipId, memberId));

    return Response.json({
      ...targetMembership,
      user: memberUser,
      permissions: permissions.map((p) => p.permission),
      cubeAssignments: cubeAssignments.map((a) => a.cubeId),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; memberId: string }> }
) {
  try {
    const { spaceId, memberId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "members.manage");

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
      return Response.json({ error: "Member not found" }, { status: 404 });
    }

    if (targetMembership.isOwner) {
      return Response.json(
        { error: "Cannot modify owner permissions" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { permissions, cubeAssignments } = body as {
      permissions?: PermissionValue[];
      cubeAssignments?: string[];
    };

    // Use shared helper for the actual update
    const updateError = await updateMemberPermissionsAndAssignments(
      memberId,
      spaceId,
      { permissions, cubeAssignments }
    );
    if (updateError) {
      return Response.json(updateError, { status: 400 });
    }

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "member.permissions_updated",
      category: "member",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "membership",
      entityId: memberId,
      spaceId,
      description: `Permissions updated for member ${memberId} in space ${spaceId}`,
      metadata: { permissions, cubeAssignments },
      source: "api",
      ...reqCtx,
    });

    // Write lifecycle logs for the update
    if (permissions !== undefined) {
      await db.insert(schema.lifecycleLogs).values({
        entityType: "space",
        entityId: spaceId,
        message: `Permissions updated for member ${memberId}: [${permissions.join(", ")}]`,
      });
    }
    if (cubeAssignments !== undefined) {
      await db.insert(schema.lifecycleLogs).values({
        entityType: "space",
        entityId: spaceId,
        message: `Cube assignments updated for member ${memberId}: [${cubeAssignments.join(", ")}]`,
      });
    }

    // Return updated member
    const [updatedMembership] = await db
      .select()
      .from(schema.spaceMemberships)
      .where(eq(schema.spaceMemberships.id, memberId))
      .limit(1);

    const updatedPermissions = await db
      .select()
      .from(schema.memberPermissions)
      .where(eq(schema.memberPermissions.membershipId, memberId));

    const updatedAssignments = await db
      .select()
      .from(schema.memberCubeAssignments)
      .where(eq(schema.memberCubeAssignments.membershipId, memberId));

    return Response.json({
      ...updatedMembership,
      permissions: updatedPermissions.map((p) => p.permission),
      cubeAssignments: updatedAssignments.map((a) => a.cubeId),
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; memberId: string }> }
) {
  try {
    const { spaceId, memberId } = await params;
    const { session, membership } = await requireSpaceMember(request, spaceId);
    await requirePermission(membership, "members.manage");

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
      return Response.json({ error: "Member not found" }, { status: 404 });
    }

    if (targetMembership.isOwner) {
      return Response.json(
        { error: "Cannot remove the owner" },
        { status: 400 }
      );
    }

    // Use shared helper for the actual removal
    await removeMemberFromSpace(memberId, targetMembership.userId, spaceId);

    const reqCtx = extractRequestContext(request.headers);
    audit({
      action: "member.removed",
      category: "member",
      actorType: "user",
      actorId: session.user.id,
      actorEmail: session.user.email,
      entityType: "membership",
      entityId: memberId,
      spaceId,
      description: `Member ${memberId} removed from space ${spaceId}`,
      metadata: { removedUserId: targetMembership.userId },
      source: "api",
      ...reqCtx,
    });

    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
