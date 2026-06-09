/**
 * Materialize a customer-requested promotion of a snapshot to a backup.
 * The `cube_backups` row is pre-inserted by the server action (via
 * `createPreDeletionBackup({ skipEnqueue: true })`) so the customer's
 * cubeConfig snapshot is captured at action time. This handler:
 *
 *   1. Claims the backup atomically (pending → creating).
 *   2. `restic dump <snapshotId> rootfs.ext4` onto the cube's host workspace.
 *   3. Wraps it in a `.cube` archive via the shared buildCubeArchive helper.
 *   4. Uploads to `<env>/backups/<spaceId>/<backupId>.cube`.
 *   5. Flips the backup row to `complete` + records size + backend.
 *
 * Snapshots are content-addressed reads — promotion is idempotent
 * against restic (a retry re-dumps the same snapshot id), and the S3
 * upload uses the backupId in the key so a retry overwrites the same
 * object rather than orphaning a partial blob.
 */

import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { cubeBackups, cubeSnapshots, cubes, lifecycleLogs } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { connectToServer, execCommand, shellEscape } from "@/lib/ssh";
import { adjustBackendUsage, selectBackend } from "@/lib/storage/backends";
import { buildCubeArchive } from "@/lib/storage/cube-archive";
import { loadResticRepoConfig, resticDump } from "@/lib/storage/restic";
import { s3HostUpload } from "@/lib/storage/s3-transfer";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import {
  buildBackupPayload,
  buildSnapshotPayload,
} from "@/lib/webhook-payloads";
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat";
import { JobLogger } from "@/lib/worker/job-log";
import type { SnapshotPromoteToBackupPayload } from "@/lib/worker/job-types";

async function handleOne(
  job: Job<SnapshotPromoteToBackupPayload>
): Promise<void> {
  const { snapshotId, cubeId, spaceId, serverId, backupId } = job.data;
  const log = new JobLogger(
    job.id,
    "snapshot.promote-to-backup",
    "cube",
    cubeId
  );
  console.log(
    `[snapshot-promote-to-backup] starting backupId=${backupId} snapshotId=${snapshotId}`
  );

  // 1. Claim atomically.
  const [claimed] = await db
    .update(cubeBackups)
    .set({ status: "creating" })
    .where(and(eq(cubeBackups.id, backupId), eq(cubeBackups.status, "pending")))
    .returning({ id: cubeBackups.id });
  if (!claimed) {
    await log.warn(`Backup ${backupId} no longer pending — skipping`);
    return;
  }

  // 2. Load source snapshot + verify.
  const snapshot = await db.query.cubeSnapshots.findFirst({
    where: eq(cubeSnapshots.id, snapshotId),
  });
  if (snapshot?.status !== "complete" || !snapshot.storagePath) {
    await markBackupFailed(
      backupId,
      "Source snapshot is not in a complete state"
    );
    return;
  }
  if (!snapshot.storageBackendId) {
    await markBackupFailed(backupId, "Source snapshot has no storage backend");
    return;
  }
  const cube = await db.query.cubes.findFirst({ where: eq(cubes.id, cubeId) });
  if (!cube) {
    await markBackupFailed(backupId, "Source cube has been deleted");
    return;
  }

  // 3. Source repo + destination backend.
  const { config: repoConfig } = await loadResticRepoConfig(
    cubeId,
    snapshot.storageBackendId
  );
  const destBackend = await selectBackend();
  if (!destBackend) {
    await markBackupFailed(backupId, "No active storage backend available");
    return;
  }

  const envPrefix =
    env.NODE_ENV === "production" ? "production" : "development";
  const s3Key = `${envPrefix}/backups/${spaceId}/${backupId}.cube`;
  const workingDir = `/tmp/krova-promote-${backupId}`;
  const dumpedRootfs = `${workingDir}/rootfs.ext4`;

  // Guarded connect so a host-down doesn't strand the backup row in
  // `creating` forever (the row was claimed above; an uncaught connect
  // failure would let the pg-boss retry short-circuit on status!='pending').
  let client: Awaited<ReturnType<typeof connectToServer>>["client"];
  try {
    client = (await connectToServer(serverId)).client;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[snapshot-promote-to-backup] connect failed backupId=${backupId}: ${reason}`
    );
    await markBackupFailed(backupId, reason);
    return;
  }
  try {
    await withCubeHeartbeat(cubeId, async () => {
      await execCommand(client, `mkdir -p ${shellEscape(workingDir)}`, 10_000);

      await log.step("Restic dump source snapshot", async () => {
        await resticDump(
          client,
          repoConfig,
          snapshot.storagePath as string,
          "rootfs.ext4",
          dumpedRootfs
        );
      });

      const archive = await log.step("Build .cube archive", async () =>
        buildCubeArchive(client, {
          workingDir,
          rootfsFilename: "rootfs.ext4",
          archiveFilename: `${backupId}.cube`,
          manifestSource: {
            source: {
              cubeId,
              cubeName: cube.name,
              spaceId,
              platformVersion: null,
            },
            config: {
              vcpus: cube.vcpus,
              ramMb: cube.ramMb,
              diskLimitGb: cube.diskLimitGb,
              imageId: cube.imageId,
              userData: cube.userData ?? null,
              kernelArgs: null,
            },
          },
        })
      );

      await log.step(`Upload to ${destBackend.name}`, async () => {
        await s3HostUpload(client, archive.archivePath, s3Key, destBackend);
      });

      await execCommand(
        client,
        `rm -rf ${shellEscape(workingDir)}`,
        30_000
      ).catch(() => {});

      await db
        .update(cubeBackups)
        .set({
          status: "complete",
          storagePath: s3Key,
          storageBackendId: destBackend.id,
          sizeBytes: archive.archiveSizeBytes,
          completedAt: new Date(),
        })
        .where(eq(cubeBackups.id, backupId));

      await adjustBackendUsage(destBackend.id, archive.archiveSizeBytes);

      await db.insert(lifecycleLogs).values({
        entityType: "cube",
        entityId: cubeId,
        message: `Snapshot "${snapshot.name}" promoted to backup`,
      });

      audit({
        action: "backup.promoted_from_snapshot",
        category: "cube",
        actorType: "user",
        entityType: "cube",
        entityId: cubeId,
        spaceId,
        description: `Snapshot ${snapshotId} promoted to backup ${backupId}`,
        metadata: {
          snapshotId,
          backupId,
          sizeBytes: archive.archiveSizeBytes,
        },
        source: "worker",
      });

      const backupRow = await db.query.cubeBackups.findFirst({
        where: eq(cubeBackups.id, backupId),
      });

      dispatchWebhookEvent(spaceId, "snapshot.promoted_to_backup", {
        snapshot: buildSnapshotPayload({
          cubeId,
          id: snapshotId,
          kind: snapshot.kind,
          name: snapshot.name,
          sizeBytes: snapshot.sizeBytes,
        }),
        backupId,
      });

      if (backupRow) {
        dispatchWebhookEvent(spaceId, "backup.created", {
          backup: buildBackupPayload(backupRow),
          source: { type: "snapshot_promote", snapshotId },
        });
      }

      await log.info(
        `Backup ready (${(archive.archiveSizeBytes / 1024 / 1024).toFixed(0)} MB)`
      );
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[snapshot-promote-to-backup] failed backupId=${backupId}: ${reason}`
    );
    await log.error(`Promote failed: ${reason}`);
    await execCommand(
      client,
      `rm -rf ${shellEscape(workingDir)}`,
      30_000
    ).catch(() => {});
    await markBackupFailed(backupId, reason);
  } finally {
    client.end();
  }
}

async function markBackupFailed(
  backupId: string,
  _reason: string
): Promise<void> {
  // cube_backups has no failure-reason column today — status='failed' is
  // the canonical signal. Reason gets surfaced via the JobLogger error
  // log already.
  await db
    .update(cubeBackups)
    .set({ status: "failed" })
    .where(eq(cubeBackups.id, backupId))
    .catch(() => {});
}

export async function handleSnapshotPromoteToBackup(
  jobs: Job<SnapshotPromoteToBackupPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleOne(job);
  }
}
