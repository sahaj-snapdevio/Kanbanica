/**
 * Periodic sweep over `cube_imports` rows.
 *
 *   - `uploading` rows older than 24h → abandoned. We abort the S3
 *     multipart upload (releases the in-progress part storage) and
 *     mark the row `expired`.
 *   - `finalizing` rows older than 1h → the worker most likely crashed
 *     between CompleteMultipartUpload and the job enqueue. Abort the
 *     multipart upload and mark `failed`.
 *   - `provisioning` rows older than 4h → pg-boss must have failed
 *     redelivery (e.g. retryLimit exhausted before the handler
 *     completed). Mark `failed` so the customer's UI surfaces the
 *     stuck state; the partially-provisioned cube row is left in
 *     `error` state from the handler's own cleanup path.
 *   - `failed` / `expired` rows older than 7 days → hard-delete the
 *     row (audit log preserves the history).
 *
 * Schedule: every 6 hours at :10 (offset from other crons).
 */

import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

import { cubeImports, cubes } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { getBackendConnection } from "@/lib/storage/backends";
import { abortMultipartUpload } from "@/lib/storage/cube-archive";
import { s3DeleteObject } from "@/lib/storage/s3-direct";

const UPLOAD_TIMEOUT_HOURS = 24;
const FINALIZING_TIMEOUT_HOURS = 1;
// Must comfortably exceed the CUBE_IMPORT_ROOTFS max wall-clock
// (expireInSeconds 2h × (retryLimit 1 + 1) + retryDelay ≈ 4h2m) so the reaper
// never deletes the `.cube` of an import that is still legitimately retrying a
// multi-GB download (audit H4). Belt-and-suspenders: the destructive sweep
// below ALSO gates on the cube row being provably dead.
const PROVISIONING_TIMEOUT_HOURS = 6;
const HARD_DELETE_AFTER_DAYS = 7;

export async function handleCubeImportsReaper(): Promise<void> {
  console.log("[cube-imports-reaper] starting sweep");

  const now = Date.now();
  const uploadCutoff = new Date(now - UPLOAD_TIMEOUT_HOURS * 3_600_000);
  const finalizingCutoff = new Date(now - FINALIZING_TIMEOUT_HOURS * 3_600_000);
  const provisioningCutoff = new Date(
    now - PROVISIONING_TIMEOUT_HOURS * 3_600_000
  );
  const hardDeleteCutoff = new Date(
    now - HARD_DELETE_AFTER_DAYS * 24 * 3_600_000
  );

  // 1. Abandoned `uploading` rows → abort multipart + mark expired.
  const abandonedUploads = await db
    .select()
    .from(cubeImports)
    .where(
      and(
        eq(cubeImports.status, "uploading"),
        lt(cubeImports.updatedAt, uploadCutoff)
      )
    );

  let abortedUploads = 0;
  for (const row of abandonedUploads) {
    try {
      const backend = await getBackendConnection(row.storageBackendId);
      if (backend) {
        await abortMultipartUpload(backend, row.s3Key, row.s3UploadId);
      }
      await db
        .update(cubeImports)
        .set({
          status: "expired",
          error: `Upload abandoned after ${UPLOAD_TIMEOUT_HOURS}h`,
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(cubeImports.id, row.id));
      abortedUploads++;
    } catch (err) {
      console.error(
        `[cube-imports-reaper] failed to abort import ${row.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // 2. Stuck `finalizing` rows → mark failed.
  //
  // The `finalizing` state covers the window between calling
  // CompleteMultipartUpload (which finalizes the S3 object) and
  // updating the DB row to `provisioning`. A crash inside that
  // window leaves an orphan S3 object (the multipart was completed
  // and is now a regular object, not abortable). We try BOTH
  // abortMultipartUpload (no-op if completed) and DeleteObject
  // (no-op if never completed) to cover both possible states.
  const stuckFinalizing = await db
    .select()
    .from(cubeImports)
    .where(
      and(
        eq(cubeImports.status, "finalizing"),
        lt(cubeImports.updatedAt, finalizingCutoff)
      )
    );

  let abortedFinalizing = 0;
  for (const row of stuckFinalizing) {
    try {
      const backend = await getBackendConnection(row.storageBackendId);
      if (backend) {
        // Track abort/delete failures separately so an actual S3 error
        // (non-404) doesn't silently leak orphan objects. Real S3 errors
        // are audited so `pnpm storage:audit` isn't the only backstop
        // (audit M15, 2026-05-24).
        await abortMultipartUpload(backend, row.s3Key, row.s3UploadId).catch(
          (err) => {
            console.warn(
              `[cube-imports-reaper] abortMultipartUpload failed for ${row.id} (${row.s3Key}): ${err instanceof Error ? err.message : err}`
            );
            audit({
              action: "cube_imports.reaper_s3_abort_failed",
              category: "cube",
              actorType: "system",
              entityType: "cube",
              entityId: row.cubeId ?? row.id,
              spaceId: row.spaceId,
              description: `Multipart abort failed during reaper sweep for import ${row.id}`,
              metadata: {
                importId: row.id,
                s3Key: row.s3Key,
                error: err instanceof Error ? err.message : String(err),
              },
              source: "worker",
            });
          }
        );
        await s3DeleteObject(row.s3Key, backend).catch((err) => {
          console.warn(
            `[cube-imports-reaper] s3DeleteObject failed for ${row.id} (${row.s3Key}): ${err instanceof Error ? err.message : err}`
          );
          audit({
            action: "cube_imports.reaper_s3_delete_failed",
            category: "cube",
            actorType: "system",
            entityType: "cube",
            entityId: row.cubeId ?? row.id,
            spaceId: row.spaceId,
            description: `S3 object delete failed during reaper sweep for import ${row.id}`,
            metadata: {
              importId: row.id,
              s3Key: row.s3Key,
              error: err instanceof Error ? err.message : String(err),
            },
            source: "worker",
          });
        });
      }
      await db
        .update(cubeImports)
        .set({
          status: "failed",
          error: `Stuck in finalizing for >${FINALIZING_TIMEOUT_HOURS}h`,
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(cubeImports.id, row.id));
      abortedFinalizing++;
    } catch (err) {
      console.error(
        `[cube-imports-reaper] failed to abort finalizing import ${row.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // 3. Stuck `provisioning` rows → mark failed + clean up the
  //    archive object on S3. The handler's own cleanup path only
  //    fires when it catches an error; if the worker died abruptly
  //    (kernel OOM, container kill) the `.cube` archive can be
  //    left over. The cube row's `error` state is handled by
  //    cube.stale-check; this loop only handles import state.
  const stuckProvisioning = await db
    .select()
    .from(cubeImports)
    .where(
      and(
        eq(cubeImports.status, "provisioning"),
        lt(cubeImports.updatedAt, provisioningCutoff)
      )
    );

  let stuckProvisioningCount = 0;
  for (const row of stuckProvisioning) {
    try {
      // Only reap when the cube is PROVABLY dead. If the cube row is still
      // booting/pending/running, a CUBE_IMPORT_ROOTFS attempt may still be
      // downloading the archive — deleting its `.cube` from S3 would break the
      // in-flight provision (audit H4). Reap only when the cube gave up
      // (`error`/`deleted`) or no longer exists. A still-active row is left for
      // a later sweep (the 6h threshold means this is already rare).
      const cube = row.cubeId
        ? await db.query.cubes.findFirst({
            where: eq(cubes.id, row.cubeId),
            columns: { status: true },
          })
        : null;
      const cubeIsDead =
        !cube || cube.status === "error" || cube.status === "deleted";
      if (!cubeIsDead) {
        console.log(
          `[cube-imports-reaper] deferring provisioning import ${row.id} — cube ${row.cubeId} still ${cube?.status} (may be a live retry)`
        );
        continue;
      }
      const backend = await getBackendConnection(row.storageBackendId);
      if (backend) {
        await s3DeleteObject(row.s3Key, backend).catch(() => {});
      }
      await db
        .update(cubeImports)
        .set({
          status: "failed",
          error: `Stuck in provisioning for >${PROVISIONING_TIMEOUT_HOURS}h`,
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(cubeImports.id, row.id));
      stuckProvisioningCount++;
    } catch (err) {
      console.error(
        `[cube-imports-reaper] failed to sweep stuck provisioning import ${row.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // 4. Hard-delete old terminal rows. We honor completedAt if set,
  //    else fall back to updatedAt (a row may have ended up
  //    terminal via a path that didn't write completedAt).
  let hardDeleted = 0;
  try {
    const result = await db
      .delete(cubeImports)
      .where(
        and(
          inArray(cubeImports.status, ["failed", "expired"] as const),
          or(
            lt(cubeImports.completedAt, hardDeleteCutoff),
            and(
              isNull(cubeImports.completedAt),
              lt(cubeImports.updatedAt, hardDeleteCutoff)
            )
          )
        )
      )
      .returning({ id: cubeImports.id });
    hardDeleted = result.length;
  } catch (err) {
    console.error(
      "[cube-imports-reaper] hard-delete sweep failed:",
      err instanceof Error ? err.message : err
    );
  }

  audit({
    action: "cube-imports.reaper_sweep",
    category: "platform",
    actorType: "system",
    entityType: "storage",
    description: `Reaped cube_imports: ${abortedUploads} uploads, ${abortedFinalizing} finalizing, ${stuckProvisioningCount} provisioning, ${hardDeleted} hard-deleted`,
    metadata: {
      abortedUploads,
      abortedFinalizing,
      stuckProvisioning: stuckProvisioningCount,
      hardDeleted,
    },
    source: "worker",
  });

  // Avoid the word "failed" in the success-path summary line so the
  // Dokploy log viewer doesn't color-code the row red.
  console.log(
    "[cube-imports-reaper] sweep complete — " +
      `aborted=${abortedUploads + abortedFinalizing}, ` +
      `stuck-provisioning=${stuckProvisioningCount}, ` +
      `hard-deleted=${hardDeleted}`
  );
}
