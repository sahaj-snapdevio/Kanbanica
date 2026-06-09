/**
 * Hourly cron that ages out customer snapshot exports.
 *
 *  - `status='ready'` rows whose `expiresAt` has passed → delete the S3
 *    object and flip to `expired` (DB row is retained for audit but the
 *    presigned URL is dead-letter from this point).
 *  - `status='materializing'` rows older than 1h → flip to `failed`
 *    (handler crashed before completing; never resume in place, the next
 *    customer request can re-export).
 *  - `status='failed' | 'expired'` rows older than 7 days → hard-delete
 *    the row.
 *
 * The cron policy is `exclusive` so concurrent ticks across worker
 * replicas collapse to one. All errors are caught per-row so a single
 * malformed row can't poison the whole cycle.
 */

import { and, eq, inArray, lt } from "drizzle-orm";
import type { Job } from "pg-boss";
import { snapshotExports } from "@/db/schema";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  adjustBackendUsage,
  getBackendConnection,
} from "@/lib/storage/backends";
import { s3DeleteObject } from "@/lib/storage/s3-direct";

const MATERIALIZING_STUCK_MS = 60 * 60 * 1000; // 1h
const TERMINAL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d

export async function handleSnapshotExportReap(_jobs: Job[]): Promise<void> {
  void _jobs;
  const now = new Date();

  // 1. Reap ready rows past TTL → delete S3 object + mark expired.
  const expired = await db
    .select({
      id: snapshotExports.id,
      storagePath: snapshotExports.storagePath,
      storageBackendId: snapshotExports.storageBackendId,
      sizeBytes: snapshotExports.sizeBytes,
      spaceId: snapshotExports.spaceId,
      snapshotId: snapshotExports.snapshotId,
    })
    .from(snapshotExports)
    .where(
      and(
        eq(snapshotExports.status, "ready"),
        lt(snapshotExports.expiresAt, now)
      )
    );

  for (const row of expired) {
    try {
      if (row.storagePath && row.storageBackendId) {
        const backend = await getBackendConnection(row.storageBackendId);
        if (backend) {
          await s3DeleteObject(row.storagePath, backend);
          if (row.sizeBytes && row.sizeBytes > 0) {
            await adjustBackendUsage(row.storageBackendId, -row.sizeBytes);
          }
        }
      }
      await db
        .update(snapshotExports)
        .set({ status: "expired" })
        .where(eq(snapshotExports.id, row.id));
      audit({
        action: "snapshot.export_expired",
        category: "platform",
        actorType: "system",
        entityType: "space",
        entityId: row.spaceId,
        spaceId: row.spaceId,
        description: "Snapshot export expired — S3 object deleted",
        metadata: {
          exportId: row.id,
          snapshotId: row.snapshotId,
          storagePath: row.storagePath,
        },
        source: "worker",
      });
    } catch (err) {
      console.error(
        `[snapshot-export-reap] failed to reap export ${row.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // 2. Mark stuck `materializing` rows failed. Handler crashed before
  //    flipping to ready; retrying in place is unsafe (no idempotent
  //    resume of restic dump + zstd partway through).
  const stuckCutoff = new Date(now.getTime() - MATERIALIZING_STUCK_MS);
  const stuck = await db
    .update(snapshotExports)
    .set({
      status: "failed",
      failureReason: "Handler interrupted before completion (stuck > 1h)",
    })
    .where(
      and(
        eq(snapshotExports.status, "materializing"),
        lt(snapshotExports.createdAt, stuckCutoff)
      )
    )
    .returning({ id: snapshotExports.id });
  if (stuck.length > 0) {
    console.warn(
      `[snapshot-export-reap] flipped ${stuck.length} stuck materializing rows to failed`
    );
  }

  // 3. Hard-delete terminal rows older than 7 days.
  const terminalCutoff = new Date(now.getTime() - TERMINAL_TTL_MS);
  const purged = await db
    .delete(snapshotExports)
    .where(
      and(
        inArray(snapshotExports.status, ["failed", "expired"]),
        lt(snapshotExports.createdAt, terminalCutoff)
      )
    )
    .returning({ id: snapshotExports.id });

  console.log(
    `[snapshot-export-reap] cycle complete — expired=${expired.length} stuck=${stuck.length} purged=${purged.length}`
  );
}
