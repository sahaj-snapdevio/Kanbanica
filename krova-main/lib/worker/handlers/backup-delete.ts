import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { cubeBackups, lifecycleLogs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { adjustBackendUsage } from "@/lib/storage/backends";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildBackupPayload } from "@/lib/webhook-payloads";
import { JobLogger } from "@/lib/worker/job-log";
import type { BackupDeletePayload } from "@/lib/worker/job-types";
import { deleteStorageObject } from "@/lib/worker/storage-delete";

async function handleBackupDeleteJob(
  job: Job<BackupDeletePayload>
): Promise<void> {
  const { backupId, spaceId } = job.data;
  console.log(`[backup-delete] starting for backupId=${backupId}`);

  // 1. Load backup
  const backup = await db.query.cubeBackups.findFirst({
    where: eq(cubeBackups.id, backupId),
  });
  if (!backup) {
    console.log(`[backup-delete] backup ${backupId} not found, skipping`);
    return;
  }

  // Backup logs are keyed to the cube they originated from so the history
  // stays attached even after the cube row is gone.
  const log = new JobLogger(
    job.id,
    "backup.delete",
    "cube",
    backup.originalCubeId
  );
  await log.info(`Deleting backup "${backup.name}"`);

  // 1b. Refuse to delete while the backup is still being created.
  //     `restic`-style mid-upload concerns aren't a thing for rclone-based
  //     backup uploads (they're a single object), but a `creating` row may
  //     still have an in-flight worker that would race on the S3 key. Throw
  //     so pg-boss retries — by next attempt the create handler will have
  //     transitioned to `complete` or `failed`. Mirrors snapshot-delete's
  //     guard. See audit M8 (2026-05-24).
  if (backup.status === "creating" || backup.status === "pending") {
    const reason =
      `Backup ${backupId} is in status='${backup.status}' — refusing to delete ` +
      "while creation is in flight; pg-boss will retry";
    console.warn(`[backup-delete] ${reason}`);
    await log.warn(reason);
    throw new Error(reason);
  }

  // 2. Delete from storage backend (throws on failure to prevent orphans).
  //    `s3DeleteObject` treats NoSuchKey as success, so a pg-boss retry
  //    after partial completion is safe at this layer.
  await deleteStorageObject(
    backup.storagePath,
    backup.storageBackendId,
    `[backup-delete] backup ${backupId}`
  );

  // 3. Delete DB record using a conditional RETURNING so we know whether
  //    THIS attempt actually removed the row (vs a previous attempt that
  //    already removed it and we're in a retry). Only adjust backend
  //    usage when we ACTUALLY deleted — otherwise a retry would
  //    double-decrement (audit M8, 2026-05-24).
  const [deleted] = await db
    .delete(cubeBackups)
    .where(eq(cubeBackups.id, backupId))
    .returning({ id: cubeBackups.id });

  if (deleted && backup.storageBackendId && backup.sizeBytes) {
    await adjustBackendUsage(backup.storageBackendId, -backup.sizeBytes);
  }

  // 4. Write lifecycle log
  await db.insert(lifecycleLogs).values({
    entityType: "space",
    entityId: spaceId,
    message: `Backup "${backup.name}" deleted (was for cube "${backup.originalCubeName}")`,
  });

  audit({
    action: "backup.delete",
    category: "cube",
    actorType: "system",
    entityType: "space",
    entityId: spaceId,
    spaceId,
    description: `Backup "${backup.name}" deleted`,
    metadata: { backupId, originalCubeId: backup.originalCubeId },
    source: "worker",
  });

  if (deleted) {
    dispatchWebhookEvent(spaceId, "backup.deleted", {
      backup: buildBackupPayload(backup),
    });
  }

  console.log(`[backup-delete] completed backupId=${backupId}`);
  await log.info(`Backup "${backup.name}" deleted`);
}

export async function handleBackupDelete(
  jobs: Job<BackupDeletePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleBackupDeleteJob(job);
  }
}
