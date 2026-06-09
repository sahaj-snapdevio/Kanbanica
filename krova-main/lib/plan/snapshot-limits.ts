/**
 * Snapshot- and backup-specific plan guards. Separated from `lib/plan/limits.ts`
 * because they share the same `EffectiveLimits` shape but add an extra DB
 * count helper for each cap.
 */

import { and, count, eq, ne } from "drizzle-orm";
import { cubeSnapshots } from "@/db/schema";
import { db } from "@/lib/db";
import type { EffectiveLimits, LimitCheck } from "@/lib/plan/limits";

/**
 * Block manual snapshot creation when the cube is at its plan's manual cap
 * (or when the plan disallows manual snapshots entirely — Trial). Trial users
 * get the "upgrade" message; capped users get the "delete one to make room"
 * message, which is the actionable next step on a plan they cannot exceed.
 */
export function assertCanCreateManualSnapshot(
  limits: EffectiveLimits,
  currentManualCount: number
): LimitCheck {
  if (limits.maxManualSnapshotsPerCube <= 0) {
    return {
      ok: false,
      error: `The ${limits.label} plan does not include manual snapshots. Upgrade your plan to create one.`,
    };
  }
  if (currentManualCount >= limits.maxManualSnapshotsPerCube) {
    return {
      ok: false,
      error: `The ${limits.label} plan allows at most ${limits.maxManualSnapshotsPerCube} manual snapshot${limits.maxManualSnapshotsPerCube === 1 ? "" : "s"} per Cube. Delete an existing manual snapshot first.`,
    };
  }
  return { ok: true };
}

/**
 * Block backup creation (pre-deletion OR promote-from-snapshot) when the
 * space is at its plan's backup cap. Mirrors `assertCanKeepBackupV2` in
 * `lib/plan/limits.ts` but uses identical wording across both backup entry
 * points so customers see the same message regardless of how they got here.
 *
 * `maxBackups === null` means "unlimited" (Business plan); only the
 * per-GB-month storage charge throttles them.
 */
export function assertCanCreateBackup(
  limits: EffectiveLimits,
  currentBackupCount: number
): LimitCheck {
  if (limits.maxBackups === null) {
    return { ok: true };
  }
  if (limits.maxBackups <= 0) {
    return {
      ok: false,
      error: `The ${limits.label} plan does not include backups. Upgrade your plan to keep one.`,
    };
  }
  if (currentBackupCount >= limits.maxBackups) {
    return {
      ok: false,
      error: `The ${limits.label} plan allows at most ${limits.maxBackups} backup${limits.maxBackups === 1 ? "" : "s"}. Delete an existing backup, or upgrade your plan.`,
    };
  }
  return { ok: true };
}

/**
 * Count this cube's non-failed manual snapshots — what
 * `assertCanCreateManualSnapshot`'s caller needs to feed in. Excludes
 * `failed` because failed rows hold no data and shouldn't burn a cap slot.
 */
export async function countManualSnapshotsForCube(
  cubeId: string
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(cubeSnapshots)
    .where(
      and(
        eq(cubeSnapshots.cubeId, cubeId),
        eq(cubeSnapshots.kind, "manual"),
        ne(cubeSnapshots.status, "failed")
      )
    );
  return Number(row?.n ?? 0);
}

/**
 * Count this cube's `kind='auto' status='complete'` snapshots — used by the
 * auto-prune handler to decide whether `restic forget` has any work to do.
 */
export async function countAutoSnapshotsForCube(
  cubeId: string
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(cubeSnapshots)
    .where(
      and(
        eq(cubeSnapshots.cubeId, cubeId),
        eq(cubeSnapshots.kind, "auto"),
        eq(cubeSnapshots.status, "complete")
      )
    );
  return Number(row?.n ?? 0);
}
