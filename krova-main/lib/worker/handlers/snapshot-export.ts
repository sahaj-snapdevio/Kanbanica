/**
 * Materialize a customer-requested snapshot export as a portable `.cube`
 * archive. The handler runs entirely on the source cube's bare-metal host:
 *
 *   1. `restic dump <snapshotId> rootfs.ext4` → host-local file (the per-cube
 *      restic chunk cache warms this path on subsequent exports of the
 *      same cube).
 *   2. `buildCubeArchive` → zstd-compress + sha256 + tar manifest into
 *      a single `.cube`.
 *   3. `s3HostUpload` → push to `<env>/exports/{spaceId}/{exportId}.cube`.
 *   4. Presign a 24h GET URL, email the space owner, write the URL +
 *      expiresAt back on the `snapshot_exports` row.
 *
 * The `snapshot.export-reap` cron deletes the S3 object + flips the row
 * to `expired` when `expiresAt` passes.
 *
 * Idempotency:
 *  - Atomic claim `pending → materializing` rejects duplicate dispatches.
 *  - `materializing` rows from a crashed prior run are marked `failed`
 *    by the export-reap cron's 1-hour stuck guard; never resumed in place.
 *  - The S3 upload uses the `exportId` in the object key so a retry on
 *    a different worker overwrites the same key (no orphan blobs).
 */

import { and, eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import {
  cubeSnapshots,
  cubes,
  lifecycleLogs,
  snapshotExports,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { enqueueEmail } from "@/lib/email";
import { getSpaceOwner } from "@/lib/email/helpers";
import { snapshotExportReadyTemplate } from "@/lib/email/templates/snapshot-export-ready";
import { env } from "@/lib/env";
import { connectToServer, execCommand, shellEscape } from "@/lib/ssh";
import { adjustBackendUsage, selectBackend } from "@/lib/storage/backends";
import { buildCubeArchive } from "@/lib/storage/cube-archive";
import { presignDownloadUrl } from "@/lib/storage/cube-archive/presign";
import { loadResticRepoConfig, resticDump } from "@/lib/storage/restic";
import { s3HostUpload } from "@/lib/storage/s3-transfer";
import { dispatchWebhookEvent } from "@/lib/webhook-dispatch";
import { buildSnapshotPayload } from "@/lib/webhook-payloads";
import { withCubeHeartbeat } from "@/lib/worker/cube-heartbeat";
import { JobLogger } from "@/lib/worker/job-log";
import type { SnapshotExportPayload } from "@/lib/worker/job-types";

/** Customer-facing TTL on the presigned download. */
const EXPORT_TTL_HOURS = 24;

async function handleSnapshotExportJob(
  job: Job<SnapshotExportPayload>
): Promise<void> {
  const { exportId, snapshotId, cubeId, spaceId, serverId } = job.data;
  const log = new JobLogger(job.id, "snapshot.export", "cube", cubeId);
  console.log(
    `[snapshot-export] starting exportId=${exportId} snapshotId=${snapshotId}`
  );
  await log.info(`Snapshot export started (exportId=${exportId})`);

  // 1. Atomic claim — only proceed if still `pending`. Rejects duplicate
  //    dispatches from a retry storm.
  const [claimed] = await db
    .update(snapshotExports)
    .set({ status: "materializing" })
    .where(
      and(
        eq(snapshotExports.id, exportId),
        eq(snapshotExports.status, "pending")
      )
    )
    .returning({ id: snapshotExports.id });
  if (!claimed) {
    console.log(
      `[snapshot-export] export ${exportId} no longer pending, skipping`
    );
    return;
  }

  // 2. Load source snapshot + cube + verify state.
  const snapshot = await db.query.cubeSnapshots.findFirst({
    where: eq(cubeSnapshots.id, snapshotId),
  });
  if (snapshot?.status !== "complete" || !snapshot.storagePath) {
    await markExportFailed(
      exportId,
      "Source snapshot is not in a complete state with a storage path"
    );
    return;
  }
  if (!snapshot.storageBackendId) {
    await markExportFailed(
      exportId,
      "Source snapshot has no storage backend reference"
    );
    return;
  }
  const cube = await db.query.cubes.findFirst({ where: eq(cubes.id, cubeId) });
  if (!cube) {
    await markExportFailed(exportId, "Source cube has been deleted");
    return;
  }

  // 3. Resolve the cube's restic repo (pinned to the snapshot's backend so
  //    we read from the same bucket the snapshot actually lives in).
  const { config: repoConfig } = await loadResticRepoConfig(
    cubeId,
    snapshot.storageBackendId
  );

  // 4. Pick a destination backend for the export object. Reuse selectBackend
  //    so it lands on the backend with most free capacity — export storage
  //    is short-lived (24h TTL), no need to pin.
  const destBackend = await selectBackend();
  if (!destBackend) {
    await markExportFailed(
      exportId,
      "No active storage backend available for export upload"
    );
    return;
  }

  const envPrefix =
    env.NODE_ENV === "production" ? "production" : "development";
  const s3Key = `${envPrefix}/exports/${spaceId}/${exportId}.cube`;
  const workingDir = `/tmp/krova-export-${exportId}`;
  const dumpedRootfs = `${workingDir}/rootfs.ext4`;

  // 5. SSH to the source cube's host and materialize. Guarded connect so a
  //    host-down doesn't strand the export row in `materializing` forever (an
  //    uncaught connect failure would let the pg-boss retry short-circuit on
  //    status!='pending', leaving a permanent zombie row no cron reaps).
  let client: Awaited<ReturnType<typeof connectToServer>>["client"];
  try {
    client = (await connectToServer(serverId)).client;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[snapshot-export] connect failed exportId=${exportId}: ${reason}`
    );
    await markExportFailed(exportId, reason);
    return;
  }
  try {
    await withCubeHeartbeat(cubeId, async () => {
      await log.step("Prepare workspace", async () => {
        await execCommand(
          client,
          `mkdir -p ${shellEscape(workingDir)}`,
          10_000
        );
      });

      await log.step("Restic dump rootfs", async () => {
        await resticDump(
          client,
          repoConfig,
          snapshot.storagePath as string,
          "rootfs.ext4",
          dumpedRootfs
        );
      });

      const archiveResult = await log.step("Build .cube archive", async () => {
        return buildCubeArchive(client, {
          workingDir,
          rootfsFilename: "rootfs.ext4",
          archiveFilename: `${exportId}.cube`,
          manifestSource: {
            source: {
              cubeId,
              cubeName: cube.name,
              spaceId,
              // platformVersion not tracked here — matches backup-create.ts.
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
            exportedAt: new Date(),
          },
        });
      });

      await log.step(`Upload to ${destBackend.name}`, async () => {
        await s3HostUpload(
          client,
          archiveResult.archivePath,
          s3Key,
          destBackend
        );
      });

      // 6. Clean local artifacts — S3 holds the canonical copy.
      await execCommand(
        client,
        `rm -rf ${shellEscape(workingDir)}`,
        30_000
      ).catch(() => {});

      // 7. Presign + persist + email.
      const expiresAt = new Date(Date.now() + EXPORT_TTL_HOURS * 3600 * 1000);
      const presignedUrl = await presignDownloadUrl(
        destBackend,
        s3Key,
        EXPORT_TTL_HOURS * 3600
      );

      await db
        .update(snapshotExports)
        .set({
          status: "ready",
          storagePath: s3Key,
          storageBackendId: destBackend.id,
          sizeBytes: archiveResult.archiveSizeBytes,
          presignedUrl,
          expiresAt,
          completedAt: new Date(),
        })
        .where(eq(snapshotExports.id, exportId));

      await adjustBackendUsage(destBackend.id, archiveResult.archiveSizeBytes);

      const owner = await getSpaceOwner(spaceId);
      if (owner) {
        const { html, text } = await snapshotExportReadyTemplate({
          userName: owner.name,
          spaceName: owner.spaceName,
          snapshotName: snapshot.name,
          cubeName: cube.name,
          downloadUrl: presignedUrl,
          expiresAt,
          sizeBytes: archiveResult.archiveSizeBytes,
        });
        await enqueueEmail({
          to: owner.email,
          subject: `Your snapshot "${snapshot.name}" is ready to download`,
          html,
          text,
        });
      } else {
        console.warn(
          `[snapshot-export] no space owner for spaceId=${spaceId} — skipping email; URL still recorded`
        );
      }

      await db.insert(lifecycleLogs).values({
        entityType: "cube",
        entityId: cubeId,
        message: `Snapshot "${snapshot.name}" exported — download link valid for 24h`,
      });

      audit({
        action: "snapshot.export_ready",
        category: "cube",
        actorType: "system",
        entityType: "cube",
        entityId: cubeId,
        spaceId,
        description: `Snapshot export ready (size=${archiveResult.archiveSizeBytes})`,
        metadata: {
          exportId,
          snapshotId,
          sizeBytes: archiveResult.archiveSizeBytes,
        },
        source: "worker",
      });

      dispatchWebhookEvent(spaceId, "snapshot.exported", {
        snapshot: buildSnapshotPayload({
          cubeId,
          id: snapshotId,
          kind: snapshot.kind,
          name: snapshot.name,
          sizeBytes: snapshot.sizeBytes,
        }),
        export: {
          id: exportId,
          archiveSizeBytes: archiveResult.archiveSizeBytes,
          expiresAt: expiresAt.toISOString(),
        },
      });

      await log.info(
        `Export ready — link expires ${expiresAt.toISOString()} (${(archiveResult.archiveSizeBytes / 1024 / 1024).toFixed(0)} MB)`
      );
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[snapshot-export] failed exportId=${exportId}: ${reason}`);
    await log.error(`Export failed: ${reason}`);
    await execCommand(
      client,
      `rm -rf ${shellEscape(workingDir)}`,
      30_000
    ).catch(() => {});
    await markExportFailed(exportId, reason);
  } finally {
    client.end();
  }
}

async function markExportFailed(
  exportId: string,
  reason: string
): Promise<void> {
  await db
    .update(snapshotExports)
    .set({ status: "failed", failureReason: reason.slice(0, 500) })
    .where(eq(snapshotExports.id, exportId));
}

export async function handleSnapshotExport(
  jobs: Job<SnapshotExportPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleSnapshotExportJob(job);
  }
}
