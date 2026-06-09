import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { cubeBackups, cubes, lifecycleLogs } from "@/db/schema";
import type { CubeBackupConfig } from "@/db/schema/backups";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { notifyAdminsOfCubeError } from "@/lib/email/notify-error";
import { env } from "@/lib/env";
import {
  connectToServer,
  execCommand,
  guestExec,
  shellEscape,
} from "@/lib/ssh";
import { adjustBackendUsage, selectBackend } from "@/lib/storage/backends";
import { buildCubeArchive } from "@/lib/storage/cube-archive";
import { s3HostUpload } from "@/lib/storage/s3-transfer";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildBackupPayload } from "@/lib/webhook-payloads";
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat";
import { enqueueJob } from "@/lib/worker/enqueue";
import { JobLogger } from "@/lib/worker/job-log";
import type { BackupCreatePayload } from "@/lib/worker/job-types";
import { JOB_NAMES } from "@/lib/worker/job-types";

/**
 * Outcome of a `createBackupSnapshot` run. The outer handler uses this
 * to decide whether the pre-deletion-backup `finally` block may safely
 * enqueue `cube.delete`.
 *
 * `interrupted-no-upload` is the dangerous case: the backup row was
 * `creating` when the handler re-entered, meaning a prior worker crashed
 * before any rootfs bytes were uploaded. Enqueuing `cube.delete` in this
 * case would destroy the customer's data with no recovery — see CRITICAL
 * C1 in the 2026-05-24 lifecycle audit. We mark the backup `failed`,
 * leave the cube alone, and notify admins for manual investigation.
 */
type BackupSnapshotOutcome =
  | { kind: "success" }
  /** Stale `creating` state on retry — no upload was attempted, do NOT delete cube. */
  | { kind: "interrupted-no-upload" }
  /** Skipped without ever claiming the work (not found / wrong status / cube already deleted / lost claim race). */
  | { kind: "skipped" }
  /** Upload was attempted but failed mid-way; safe to proceed with cube.delete if requested. */
  | { kind: "failed-during-upload" };

async function handleBackupCreateJob(
  job: Job<BackupCreatePayload>
): Promise<void> {
  const { backupId, cubeId, spaceId, serverId } = job.data;
  const log = new JobLogger(job.id, "backup.create", "cube", cubeId);
  console.log(
    `[backup-create] starting for backupId=${backupId} cubeId=${cubeId}`
  );
  await log.info(`Backup started (backupId=${backupId})`);

  // The outer handler ALWAYS reaches its `finally` so a pre-deletion
  // backup can enqueue `cube.delete` regardless of whether the upload
  // succeeded — backup failure must not block deletion. EXCEPT when no
  // upload was ever attempted (the "interrupted-no-upload" outcome), in
  // which case enqueuing `cube.delete` would destroy the customer's
  // data with no recoverable backup.
  let outcome: BackupSnapshotOutcome = { kind: "failed-during-upload" };
  try {
    outcome = await createBackupSnapshot(
      backupId,
      cubeId,
      spaceId,
      serverId,
      job.data.deleteCubeAfter === true,
      log
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[backup-create] unhandled error for backupId=${backupId}:`,
      reason
    );
    await log.error(`Backup creation failed: ${reason}`);

    // Mark backup as failed so it doesn't stay stuck in pending/creating
    await db
      .update(cubeBackups)
      .set({ status: "failed" })
      .where(eq(cubeBackups.id, backupId))
      .catch((updateErr) => {
        console.error(
          `[backup-create] failed to mark backup ${backupId} as failed:`,
          updateErr
        );
      });

    audit({
      action: "backup.create_failed",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Backup failed (unhandled): ${reason}`,
      metadata: { backupId, error: reason },
      source: "worker",
    });
    // An uncaught throw means createBackupSnapshot got past the
    // claim-and-upload path before failing — the outer "failed-during-upload"
    // default is correct here, leave `outcome` as set.
  }

  // Deletion is opt-in. Only the pre-deletion flow (the customer's
  // "Delete with Preserve backup" toggle, or `cube.stale-check`'s
  // auto-salvage) passes `deleteCubeAfter: true`. The "Save as backup"
  // flow — and any caller that forgets to set the flag — leaves the
  // source cube alone. This default prevents a missing flag from
  // accidentally destroying a customer's running cube.
  const shouldDeleteAfter = job.data.deleteCubeAfter === true;
  if (!shouldDeleteAfter) {
    return;
  }

  // ONLY a SUCCESSFUL backup (data safely on S3) authorizes destroying the
  // cube. Any other outcome means there is NO usable backup, so deleting would
  // permanently lose the exact data the customer (or stale-check salvage) asked
  // to preserve (audit H1, 2026-05-30).
  if (outcome.kind === "success") {
    try {
      await enqueueJob(JOB_NAMES.CUBE_DELETE, { cubeId, spaceId, serverId });
    } catch (enqueueErr) {
      // Critical: cube deletion couldn't be enqueued.
      // Log prominently — this requires manual intervention.
      console.error(
        `[backup-create] CRITICAL: failed to enqueue cube.delete for cubeId=${cubeId}:`,
        enqueueErr
      );
    }
    return;
  }

  // Skipped outcomes (backup not found / wrong status / cube already
  // deleted / lost claim race) mean the deletion decision was made
  // elsewhere; don't double-enqueue.
  if (outcome.kind === "skipped") {
    return;
  }

  // outcome is `interrupted-no-upload` OR `failed-during-upload`: either a
  // prior worker crashed before any upload, OR the compress/upload failed
  // (e.g. a transient S3/host blip). In BOTH cases there is no usable backup,
  // so we MUST NOT delete the cube — that would lose the data the customer
  // explicitly chose to preserve. Leave the rootfs intact (it's still on the
  // host) and flip the cube `stopping → error` so `cube.stale-check` (which
  // only targets pending/booting/stopping) cannot re-fire the salvage→delete
  // path in a loop while the host is flapping (audit G1). Notify admins to
  // drive recovery (retry the backup, or Force Delete via Orbit).
  const reasonLabel =
    outcome.kind === "interrupted-no-upload"
      ? "backup was interrupted before any upload"
      : "backup failed during compress/upload";
  console.error(
    `[backup-create] REFUSING to enqueue cube.delete for cubeId=${cubeId} — ${reasonLabel}; deletion would lose customer data. Manual recovery required.`
  );
  await log.error(
    `Refusing cube.delete: ${reasonLabel}. Cube left intact (flipped to error); admins notified.`
  );
  // Rule 52: a non-running cube must have lastBilledAt = null.
  try {
    await db
      .update(cubes)
      .set({ status: "error", lastBilledAt: null, updatedAt: new Date() })
      .where(eq(cubes.id, cubeId));
  } catch (statusErr) {
    console.error(
      `[backup-create] failed to flip cube ${cubeId} to error after refused delete:`,
      statusErr
    );
  }
  await notifyAdminsOfCubeError({
    cubeName: `cube ${cubeId}`,
    cubeId,
    spaceId,
    serverId,
    reason:
      `Pre-deletion backup ${backupId} ${reasonLabel}. Cube was NOT deleted (to ` +
      "preserve customer data) and was flipped to `error`. The rootfs on the host " +
      "should still be intact — retry the backup or proceed with deletion via " +
      "Orbit → Force Delete.",
  }).catch((err) => {
    console.error(
      `[backup-create] failed to notify admins for cubeId=${cubeId}:`,
      err
    );
  });
  audit({
    action: "backup.delete_skipped_no_usable_backup",
    category: "cube",
    actorType: "system",
    entityType: "cube",
    entityId: cubeId,
    spaceId,
    description: `Skipped pre-deletion cube.delete (${reasonLabel}); cube preserved + flipped to error`,
    metadata: { backupId, serverId, outcome: outcome.kind },
    source: "worker",
  });
}

async function createBackupSnapshot(
  backupId: string,
  cubeId: string,
  spaceId: string,
  serverId: string,
  shouldDeleteAfter: boolean,
  log: JobLogger
): Promise<BackupSnapshotOutcome> {
  // 1. Load backup — only proceed if status is still "pending".
  //    If status is "creating", a prior worker run was killed mid-flight;
  //    mark it failed and signal "interrupted-no-upload" so the outer
  //    handler refuses to enqueue cube.delete (no backup data exists).
  const backup = await db.query.cubeBackups.findFirst({
    where: eq(cubeBackups.id, backupId),
  });
  if (!backup) {
    console.log(`[backup-create] backup ${backupId} not found, skipping`);
    return { kind: "skipped" };
  }
  if (backup.status === "creating") {
    console.log(
      `[backup-create] backup ${backupId} stuck in creating (prior run interrupted), marking failed`
    );
    await markBackupFailed(
      backupId,
      "Interrupted: prior worker run was killed mid-flight"
    );
    return { kind: "interrupted-no-upload" };
  }
  // A retry that finds the backup already `complete` means a prior run uploaded
  // it successfully but the worker died before the caller's finally enqueued
  // cube.delete (pre-deletion flow) — return `success` so that re-enqueue
  // happens now. cube.delete claims any non-deleted status atomically, so a
  // double-enqueue converges to `deleted` idempotently with no double-cleanup.
  // Without this, the cube strands in `stopping` until cube.stale-check reaps it.
  if (backup.status === "complete") {
    console.log(
      `[backup-create] backup ${backupId} already complete — treating as success (re-converge the delete)`
    );
    return { kind: "success" };
  }
  if (backup.status !== "pending") {
    console.log(
      `[backup-create] backup ${backupId} not pending (status=${backup.status}), skipping`
    );
    return { kind: "skipped" };
  }

  // 2. Load cube — must not already be deleted
  const cube = await db.query.cubes.findFirst({
    where: eq(cubes.id, cubeId),
  });
  if (!cube || cube.status === "deleted") {
    await markBackupFailed(backupId, "Cube already deleted");
    return { kind: "skipped" };
  }

  // 3. Atomically update backup → creating (only if still pending, prevents concurrent races)
  const [claimed] = await db
    .update(cubeBackups)
    .set({ status: "creating" })
    .where(and(eq(cubeBackups.id, backupId), eq(cubeBackups.status, "pending")))
    .returning({ id: cubeBackups.id });

  if (!claimed) {
    console.log(
      `[backup-create] backup ${backupId} no longer pending, skipping`
    );
    return { kind: "skipped" };
  }

  // 4. Load server and SSH key
  let client: Awaited<ReturnType<typeof connectToServer>>["client"];
  try {
    const result = await connectToServer(serverId);
    client = result.client;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await markBackupFailed(backupId, reason);
    // SSH connect failed before any upload could begin; treat same as
    // interrupted-no-upload so the outer handler refuses cube.delete.
    return { kind: "interrupted-no-upload" };
  }

  const cubeDir = `/var/lib/krova/cubes/${cubeId}`;
  const archiveFilename = `${backupId}.cube`;
  const archivePath = `${cubeDir}/${archiveFilename}`;
  const envPrefix =
    env.NODE_ENV === "production" ? "production" : "development";
  const storagePath = `${envPrefix}/backups/${spaceId}/${archiveFilename}`;

  // 4e. If a prior interrupted snapshot-restore left the pristine pre-restore
  //     rootfs at `.bak`, prefer it — back up the customer's INTACT pre-restore
  //     data, never a half-restored state (audit C1b). No-op for a healthy cube
  //     (no `.bak` exists); a cube mid-restore is `stopping`, so a save-as
  //     backup of a running cube never hits this.
  await execCommand(
    client,
    `[ -f ${cubeDir}/rootfs.ext4.bak ] && mv -f ${cubeDir}/rootfs.ext4.bak ${cubeDir}/rootfs.ext4 || true`,
    30_000
  ).catch(() => {});

  try {
    // 5. Re-read cube status immediately before flush to handle status changes
    // since the initial check (e.g., state-sync could have changed it)
    const freshCube = await db.query.cubes.findFirst({
      where: eq(cubes.id, cubeId),
    });
    if (freshCube?.status === "running") {
      await guestExec(client, cubeId, "sync", 10_000).catch(() => {
        console.warn(
          "[backup-create] sync failed (guest agent may be unresponsive), proceeding anyway"
        );
      });
    }

    // The CubeBackupConfig was captured at row-insert time
    // (createPreDeletionBackup) — it's the source of truth for the
    // manifest's `config` section. Pull it as the typed shape.
    const config = backup.cubeConfig as CubeBackupConfig;

    // 6-8. Build .cube archive + upload — the cube is in `stopping`
    //      throughout, and a multi-GB rootfs can take well over 10
    //      minutes end-to-end, so we heartbeat cubes.updatedAt to keep
    //      cube.stale-check from marking it stuck and enqueueing a
    //      duplicate cube.delete that would race with this handler.
    const backend = await selectBackend();
    if (!backend) {
      throw new Error("No active storage backend configured");
    }
    const { archiveSizeBytes } = await withCubeHeartbeat(cubeId, async () => {
      const buildResult = await log.step(
        "Build .cube archive (compress + manifest + tar)",
        async () =>
          await buildCubeArchive(client, {
            workingDir: cubeDir,
            rootfsFilename: "rootfs.ext4",
            archiveFilename,
            manifestSource: {
              source: {
                cubeId,
                cubeName: backup.originalCubeName,
                spaceId,
              },
              config: {
                vcpus: config.vcpus,
                ramMb: config.ramMb,
                diskLimitGb: config.diskLimitGb,
                imageId: config.imageId,
                userData: null,
                kernelArgs: null,
              },
            },
          })
      );
      console.log(
        `[backup-create] archive size: ${(buildResult.archiveSizeBytes / 1024 / 1024).toFixed(0)} MB ` +
          `(rootfs ${(buildResult.rootfsCompressedSizeBytes / 1024 / 1024).toFixed(0)} MB compressed)`
      );
      await log.info(
        `Archive size: ${(buildResult.archiveSizeBytes / 1024 / 1024).toFixed(0)} MB`
      );

      await log.step(`Upload to ${backend.name}`, async () => {
        await s3HostUpload(
          client,
          buildResult.archivePath,
          storagePath,
          backend
        );
      });

      return { archiveSizeBytes: buildResult.archiveSizeBytes };
    });
    const fileSizeBytes = archiveSizeBytes;

    // 9. Clean up the host-side archive — S3 has the canonical copy now.
    await execCommand(client, `rm -f ${shellEscape(archivePath)}`).catch(
      () => {}
    );

    // 10. Mark backup as complete
    await db
      .update(cubeBackups)
      .set({
        status: "complete",
        sizeBytes: fileSizeBytes,
        storagePath,
        storageBackendId: backend.id,
        completedAt: new Date(),
      })
      .where(eq(cubeBackups.id, backupId));

    // Keep backend usage accurate between health checks
    await adjustBackendUsage(backend.id, fileSizeBytes);

    await db.insert(lifecycleLogs).values({
      entityType: "cube",
      entityId: cubeId,
      message: `Backup "${backup.name}" created (${(fileSizeBytes / 1024 / 1024).toFixed(0)} MB)`,
    });

    audit({
      action: "backup.create_complete",
      category: "cube",
      actorType: backup.createdBy ? "user" : "system",
      actorId: backup.createdBy,
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Backup "${backup.name}" created`,
      metadata: { backupId, sizeBytes: fileSizeBytes, storagePath },
      source: "worker",
    });

    dispatchWebhookEvent(spaceId, "backup.created", {
      backup: buildBackupPayload({ ...backup, sizeBytes: fileSizeBytes }),
      source: { type: shouldDeleteAfter ? "pre_deletion" : "save_as_backup" },
    });

    console.log(`[backup-create] completed backupId=${backupId}`);
    await log.info(`Backup "${backup.name}" complete`);
    return { kind: "success" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[backup-create] failed backupId=${backupId}:`, reason);
    await log.error(`Backup creation failed: ${reason}`);

    // Clean up host-side intermediates on failure. `buildCubeArchive`
    // does its own internal cleanup; this catches the case where the
    // upload step failed after the archive was built.
    await execCommand(client, `rm -f ${shellEscape(archivePath)}`).catch(
      () => {}
    );

    await markBackupFailed(backupId, reason);

    await db
      .insert(lifecycleLogs)
      .values({
        entityType: "cube",
        entityId: cubeId,
        message: `Backup "${backup.name}" failed: ${reason}`,
      })
      .catch(() => {});

    audit({
      action: "backup.create_failed",
      category: "cube",
      actorType: "system",
      entityType: "cube",
      entityId: cubeId,
      spaceId,
      description: `Backup "${backup.name}" failed: ${reason}`,
      metadata: { backupId, error: reason },
      source: "worker",
    });
    // Compress/upload failed after the claim — there is NO usable backup on
    // S3. The outer handler treats this exactly like `interrupted-no-upload`:
    // it does NOT delete the cube (would lose the data the customer chose to
    // preserve) and flips the cube to `error` for manual recovery (audit H1).
    return { kind: "failed-during-upload" };
  } finally {
    client.end();
  }
}

async function markBackupFailed(
  backupId: string,
  reason: string
): Promise<void> {
  console.error(
    `[backup-create] marking backup ${backupId} as failed: ${reason}`
  );
  await db
    .update(cubeBackups)
    .set({ status: "failed" })
    .where(eq(cubeBackups.id, backupId))
    .catch((err) => {
      console.error(
        `[backup-create] failed to mark backup ${backupId} as failed:`,
        err
      );
    });
}

export async function handleBackupCreate(
  jobs: Job<BackupCreatePayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleBackupCreateJob(job);
  }
}
