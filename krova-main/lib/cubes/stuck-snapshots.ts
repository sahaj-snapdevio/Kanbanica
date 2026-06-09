/**
 * Single source of truth for detecting + clearing `cube_snapshots` rows
 * stranded in `creating` with nothing ever uploaded to restic.
 *
 * Shared by BOTH the manual `pnpm snapshots:cleanup-stuck` command
 * ([scripts/cleanup-stuck-snapshots.ts]) and the `snapshot.stale-check` cron
 * ([lib/worker/handlers/snapshot-stale-check.ts]) so the eligibility rule and
 * the delete live in exactly one place.
 *
 * Why `storage_path IS NULL` is the safe signal: `snapshot.create` writes
 * `storagePath` (the restic snapshot id) ATOMICALLY in the same UPDATE that
 * flips the row to `complete`. A row therefore never sits in `creating` WITH
 * a storagePath — a stuck `creating` row always has `storage_path = NULL`,
 * meaning nothing reached the backend, so deleting the row leaves no S3
 * orphan behind. This matches the no-upload orphan-delete the create handler's
 * own catch performs.
 *
 * The caller computes the cutoff so a single `Date.now()` reading drives both
 * the dry-run list and the delete (no drift between the two calls).
 */

import { and, eq, isNull, lt } from "drizzle-orm";
import { cubeSnapshots } from "@/db/schema";
import { db } from "@/lib/db";

export type StuckSnapshotRow = {
  id: string;
  cubeId: string;
  name: string;
  kind: string;
  createdAt: Date;
};

function stuckCreatingWhere(cutoff: Date) {
  return and(
    eq(cubeSnapshots.status, "creating"),
    isNull(cubeSnapshots.storagePath),
    lt(cubeSnapshots.createdAt, cutoff)
  );
}

/** List the rows that {@link deleteStuckCreatingSnapshots} would remove. */
export async function findStuckCreatingSnapshots(
  cutoff: Date
): Promise<StuckSnapshotRow[]> {
  return db
    .select({
      id: cubeSnapshots.id,
      cubeId: cubeSnapshots.cubeId,
      name: cubeSnapshots.name,
      kind: cubeSnapshots.kind,
      createdAt: cubeSnapshots.createdAt,
    })
    .from(cubeSnapshots)
    .where(stuckCreatingWhere(cutoff));
}

/** Delete stranded `creating` rows older than `cutoff`; returns deleted ids. */
export async function deleteStuckCreatingSnapshots(
  cutoff: Date
): Promise<string[]> {
  const deleted = await db
    .delete(cubeSnapshots)
    .where(stuckCreatingWhere(cutoff))
    .returning({ id: cubeSnapshots.id });
  return deleted.map((d) => d.id);
}
