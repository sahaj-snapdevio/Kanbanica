/**
 * Shared member management logic.
 * Used by server actions and API routes for permission updates and member removal.
 * Never duplicate this business logic.
 */

import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import { PERMISSION_VALUES, type PermissionValue } from "@/db/schema/types";
import { db } from "@/lib/db";
import { enqueueEmailitSync } from "@/lib/emailit/enqueue-sync";

/**
 * Update a member's permissions and/or cube assignments.
 * Validates cube assignments belong to the space.
 * Returns an error string on failure, or null on success.
 */
export async function updateMemberPermissionsAndAssignments(
  memberId: string,
  spaceId: string,
  data: {
    permissions?: string[];
    cubeAssignments?: string[];
  }
): Promise<{ error: string } | null> {
  const { permissions, cubeAssignments } = data;

  if (permissions !== undefined && permissions.length > 0) {
    const validPerms = new Set<string>(PERMISSION_VALUES);
    const invalidPerms = permissions.filter((p) => !validPerms.has(p));
    if (invalidPerms.length > 0) {
      return { error: `Invalid permissions: ${invalidPerms.join(", ")}` };
    }
  }

  if (cubeAssignments !== undefined && cubeAssignments.length > 0) {
    const validCubes = await db
      .select({ id: schema.cubes.id })
      .from(schema.cubes)
      .where(
        and(
          eq(schema.cubes.spaceId, spaceId),
          ne(schema.cubes.status, "deleted"),
          inArray(schema.cubes.id, cubeAssignments)
        )
      );

    const validCubeIds = new Set(validCubes.map((v) => v.id));
    const invalidIds = cubeAssignments.filter((id) => !validCubeIds.has(id));
    if (invalidIds.length > 0) {
      return { error: `Invalid Cube assignments: ${invalidIds.join(", ")}` };
    }
  }

  const txResult = await db.transaction(async (tx) => {
    // Lock the membership row to serialize concurrent permission updates
    const [locked] = await tx
      .select()
      .from(schema.spaceMemberships)
      .where(eq(schema.spaceMemberships.id, memberId))
      .for("update")
      .limit(1);

    if (!locked) {
      return { error: "Membership not found" } as const;
    }

    if (permissions !== undefined) {
      await tx
        .delete(schema.memberPermissions)
        .where(eq(schema.memberPermissions.membershipId, memberId));

      if (permissions.length > 0) {
        await tx.insert(schema.memberPermissions).values(
          permissions.map((p) => ({
            id: createId(),
            membershipId: memberId,
            permission: p as PermissionValue,
          }))
        );
      }
    }

    if (cubeAssignments !== undefined) {
      await tx
        .delete(schema.memberCubeAssignments)
        .where(eq(schema.memberCubeAssignments.membershipId, memberId));

      if (cubeAssignments.length > 0) {
        await tx.insert(schema.memberCubeAssignments).values(
          cubeAssignments.map((cubeId) => ({
            id: createId(),
            membershipId: memberId,
            cubeId,
          }))
        );
      }
    }

    return null;
  });

  if (txResult?.error) {
    return txResult;
  }

  return null;
}

/**
 * Remove a member from a space. Deletes permissions, assignments, and membership.
 * If the user has no remaining memberships, deletes their account.
 * Returns { accountDeleted } on success.
 */
export async function removeMemberFromSpace(
  memberId: string,
  targetUserId: string,
  spaceId: string
): Promise<{ accountDeleted: boolean }> {
  let accountDeleted = false;

  await db.transaction(async (tx) => {
    // Delete the membership (also cleans up permissions/assignments)
    await tx
      .delete(schema.memberPermissions)
      .where(eq(schema.memberPermissions.membershipId, memberId));

    await tx
      .delete(schema.memberCubeAssignments)
      .where(eq(schema.memberCubeAssignments.membershipId, memberId));

    await tx
      .delete(schema.spaceMemberships)
      .where(eq(schema.spaceMemberships.id, memberId));

    // If user has no remaining memberships, delete their account
    const remainingMemberships = await tx
      .select({ id: schema.spaceMemberships.id })
      .from(schema.spaceMemberships)
      .where(eq(schema.spaceMemberships.userId, targetUserId))
      .limit(1);

    if (remainingMemberships.length === 0) {
      await tx.delete(schema.user).where(eq(schema.user.id, targetUserId));

      await tx.insert(schema.lifecycleLogs).values({
        entityType: "space",
        entityId: spaceId,
        message: `User ${targetUserId} deleted after removal from their only space`,
      });

      accountDeleted = true;
    }

    await tx.insert(schema.lifecycleLogs).values({
      entityType: "space",
      entityId: spaceId,
      message: `Member ${memberId} removed from space`,
    });
  });

  // The removed user's space_count / is_team_member just changed. Skip when
  // their account was also deleted — `emailit.delete-contact` handles that.
  if (!accountDeleted) {
    await enqueueEmailitSync(targetUserId);
  }

  return { accountDeleted };
}
