/**
 * snapshot.stale-check — sweep `cube_snapshots` rows stranded in `creating`
 * with nothing uploaded (`storage_path IS NULL`) and delete them.
 *
 * This is the belt-and-suspenders backstop for the one stranding case the
 * guarded connect in `snapshot.create` CANNOT catch: the worker process being
 * hard-killed AFTER the row was claimed `pending → creating` but BEFORE the
 * handler's catch ran. pg-boss may then retry, but the retry short-circuits on
 * `status != 'pending'` and leaves the row in `creating` forever (`snapshot.
 * auto-prune` only reaps `complete` rows). The handler's guarded connect +
 * the scheduler preflight prevent the common (host-down) case; this cron mops
 * up the rare hard-kill straggler.
 *
 * Shares its eligibility rule + delete with the manual
 * `pnpm snapshots:cleanup-stuck` command via lib/cubes/stuck-snapshots.ts.
 *
 * Threshold: 2h — comfortably past the 30-min `resticBackup` timeout and the
 * 60-min `snapshot.create` job-expire budget, so a genuinely in-flight first
 * snapshot is never reaped.
 */

import { audit } from "@/lib/audit";
import { deleteStuckCreatingSnapshots } from "@/lib/cubes/stuck-snapshots";

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export async function handleSnapshotStaleCheck(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  const deletedIds = await deleteStuckCreatingSnapshots(cutoff);

  if (deletedIds.length === 0) {
    return;
  }

  audit({
    action: "snapshot.stale_reaped",
    category: "cube",
    actorType: "system",
    entityType: "space",
    description: `Reaped ${deletedIds.length} snapshot row(s) stranded in "creating" with no data uploaded`,
    metadata: { count: deletedIds.length, snapshotIds: deletedIds },
    source: "worker",
  });

  console.log(
    `[snapshot-stale-check] reaped ${deletedIds.length} stuck "creating" snapshot row(s)`
  );
}
