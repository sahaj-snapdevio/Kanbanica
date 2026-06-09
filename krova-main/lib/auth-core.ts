/**
 * Shared authentication query logic used by both API route helpers
 * and server action helpers. This avoids duplicating the cube access
 * check query across lib/api/auth-helpers.ts and lib/actions/auth-helpers.ts.
 */

import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

/**
 * Check if a member has access to a specific cube.
 * Owners bypass this check. Members with no cube assignments are unrestricted.
 * Members with assignments are restricted to only those cubes.
 *
 * Returns null if access is granted, or an error string if denied.
 */
export async function checkCubeAccess(
  membershipId: string,
  isOwner: boolean,
  cubeId: string
): Promise<string | null> {
  if (isOwner) {
    return null;
  }

  // Check if member has ANY cube assignments at all.
  // If none exist, the member is unrestricted (can access all cubes).
  // If assignments exist, the member is restricted to only those cubes.
  const assignments = await db
    .select({ cubeId: schema.memberCubeAssignments.cubeId })
    .from(schema.memberCubeAssignments)
    .where(eq(schema.memberCubeAssignments.membershipId, membershipId))
    .limit(1);

  // No assignments = unrestricted access to all cubes
  if (assignments.length === 0) {
    return null;
  }

  // Has assignments — check if this cube is in the list
  const [specificAssignment] = await db
    .select()
    .from(schema.memberCubeAssignments)
    .where(
      and(
        eq(schema.memberCubeAssignments.membershipId, membershipId),
        eq(schema.memberCubeAssignments.cubeId, cubeId)
      )
    )
    .limit(1);

  if (!specificAssignment) {
    return "Forbidden: no access to this Cube";
  }

  return null;
}
