/**
 * backup.stale-check — flip `cube_backups` rows stranded in `creating` with
 * nothing uploaded (`storage_path IS NULL`) to `failed`.
 *
 * The stranding case (audit I-1): `snapshot.promote-to-backup` (and, in theory,
 * any `backup.create` whose own self-heal didn't fire) claims a row
 * `pending → creating`, then the worker is hard-killed — or the job's
 * `expireInSeconds` (3600s) fires — mid restic-dump / compress / upload. pg-boss
 * may retry, but the retry's atomic claim short-circuits on `status != 'pending'`
 * and leaves the row in `creating` forever. Because `countSpaceBackups` counts
 * every row except `failed`, that dead row permanently burns a `maxBackups`
 * slot the customer is entitled to — with no UI signal and (before this cron)
 * no reaper. `backup.create` self-heals via its own re-entry guard; the
 * promote handler has no such guard, so this is the backstop for both.
 *
 * Flipping to `failed` (not deleting) frees the slot AND leaves a visible
 * record the customer can retry from. Only `storage_path IS NULL` rows are
 * reaped: a row WITH a storage_path uploaded its `.cube` but died before the
 * final flip to `complete`, so failing it would orphan the S3 object —
 * `pnpm storage:audit` handles that case, not this cron.
 *
 * Threshold 2h — comfortably past the 1h job-expire budget of both
 * `backup.create` and `snapshot.promote-to-backup` (plus their 30-min
 * restic-dump timeout), so a genuinely in-flight backup is never reaped.
 */

import { and, eq, isNull, lt } from "drizzle-orm";
import { cubeBackups } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

export async function handleBackupStaleCheck(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  const reaped = await db
    .update(cubeBackups)
    .set({ status: "failed" })
    .where(
      and(
        eq(cubeBackups.status, "creating"),
        isNull(cubeBackups.storagePath),
        lt(cubeBackups.createdAt, cutoff)
      )
    )
    .returning({ id: cubeBackups.id });

  if (reaped.length === 0) {
    return;
  }

  audit({
    action: "backup.stale_reaped",
    category: "cube",
    actorType: "system",
    entityType: "space",
    description: `Reaped ${reaped.length} backup row(s) stranded in "creating" with no data uploaded`,
    metadata: { count: reaped.length, backupIds: reaped.map((r) => r.id) },
    source: "worker",
  });

  console.log(
    `[backup-stale-check] reaped ${reaped.length} stuck "creating" backup row(s) → failed`
  );
}
