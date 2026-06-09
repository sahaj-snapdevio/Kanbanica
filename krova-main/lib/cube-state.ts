/**
 * Atomic cube state transition utility.
 *
 * Shared pattern for sleep, restart, powerOff actions that need to:
 * 1. Atomically update cube status only if it matches the expected state
 * 2. On failure, check if cube exists and report its actual status
 */

import type { SQL } from "drizzle-orm";
import { and, eq, ne } from "drizzle-orm";
import * as schema from "@/db/schema";
import { db } from "@/lib/db";

type CubeRow = typeof schema.cubes.$inferSelect;

type TransitionSuccess = { cube: CubeRow };
type TransitionError = { error: string };
export type TransitionResult = TransitionSuccess | TransitionError;

/**
 * Atomically transition a cube from one status to another (or just touch updatedAt).
 *
 * @param cubeId - The cube to transition
 * @param spaceId - The space the cube belongs to
 * @param options.fromStatus - Required current status (single or array for OR)
 * @param options.toStatus - New status to set (omit to keep current status, just touch updatedAt)
 * @param options.verb - Human-readable verb for error messages (e.g. "sleep", "restart")
 */
export async function transitionCubeStatus(
  cubeId: string,
  spaceId: string,
  options: {
    fromStatus: string | string[];
    toStatus?: string;
    verb: string;
  }
): Promise<TransitionResult> {
  const { fromStatus, toStatus, verb } = options;

  // Build the WHERE conditions
  const statusConditions: SQL[] = Array.isArray(fromStatus)
    ? fromStatus.map((s) =>
        eq(
          schema.cubes.status,
          s as (typeof schema.cubeStatus.enumValues)[number]
        )
      )
    : [
        eq(
          schema.cubes.status,
          fromStatus as (typeof schema.cubeStatus.enumValues)[number]
        ),
      ];

  // For a single status, use eq; for multiple, use OR via checking each
  const statusCondition =
    statusConditions.length === 1
      ? statusConditions[0]
      : // Use individual conditions combined - we need to handle this differently
        // since drizzle doesn't have a simple `or` in the same way
        statusConditions[0]; // Fallback handled below

  // Build update set
  const updateSet: Record<string, unknown> = { updatedAt: new Date() };
  if (toStatus) {
    updateSet.status =
      toStatus as (typeof schema.cubeStatus.enumValues)[number];
  }

  let cube: CubeRow | undefined;

  if (Array.isArray(fromStatus) && fromStatus.length > 1) {
    // For multiple from statuses, use ne (not equal) conditions for excluded statuses
    // This is simpler and matches the existing deleteCube pattern
    const allStatuses = [
      "pending",
      "booting",
      "running",
      "sleeping",
      "stopping",
      "deleted",
      "error",
    ] as const;
    const excludedStatuses = allStatuses.filter((s) => !fromStatus.includes(s));

    const conditions = [
      eq(schema.cubes.id, cubeId),
      eq(schema.cubes.spaceId, spaceId),
      ...excludedStatuses.map((s) => ne(schema.cubes.status, s)),
    ];

    const [result] = await db
      .update(schema.cubes)
      .set(updateSet)
      .where(and(...conditions))
      .returning();
    cube = result;
  } else {
    const [result] = await db
      .update(schema.cubes)
      .set(updateSet)
      .where(
        and(
          eq(schema.cubes.id, cubeId),
          eq(schema.cubes.spaceId, spaceId),
          statusCondition
        )
      )
      .returning();
    cube = result;
  }

  if (!cube) {
    const [existing] = await db
      .select({ status: schema.cubes.status })
      .from(schema.cubes)
      .where(
        and(eq(schema.cubes.id, cubeId), eq(schema.cubes.spaceId, spaceId))
      )
      .limit(1);

    if (!existing) {
      return { error: "Cube not found" };
    }

    const expectedLabel = Array.isArray(fromStatus)
      ? fromStatus.join(" or ")
      : fromStatus;
    return {
      error: `Cube is currently ${existing.status}. It must be ${expectedLabel} to ${verb}.`,
    };
  }

  return { cube };
}
