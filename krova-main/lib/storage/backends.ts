/**
 * Storage backend DB queries — selection, lookup, usage accounting.
 *
 * Backends are S3-compatible buckets stored in the `storage_backends`
 * table. Credentials are AES-256-GCM encrypted (`lib/encrypt.ts`).
 * `selectBackend()` picks the active bucket with the most free space.
 */

import { eq } from "drizzle-orm";
import { storageBackends } from "@/db/schema";
import { db } from "@/lib/db";
import { decryptValue, Secret } from "@/lib/encrypt";
import type { StorageBackendConnection } from "@/lib/storage/types";

function toConnection(
  row: typeof storageBackends.$inferSelect
): StorageBackendConnection {
  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    accessKeyId: new Secret(decryptValue(row.accessKeyIdEnc)),
    secretAccessKey: new Secret(decryptValue(row.secretAccessKeyEnc)),
  };
}

/** Get a specific backend by id. Returns null if no row exists. */
export async function getBackendConnection(
  backendId: string
): Promise<StorageBackendConnection | null> {
  const row = await db.query.storageBackends.findFirst({
    where: eq(storageBackends.id, backendId),
  });
  if (!row) {
    return null;
  }
  return toConnection(row);
}

/**
 * Pick the best backend for a new upload.
 *
 * 1. Filter to active backends.
 * 2. Sort by most free space (`capacityGb * 1GiB - usedBytes`).
 *    Unlimited (`capacityGb = null`) sorts last only when all sized
 *    backends are full; otherwise it ties at `Infinity`.
 * 3. Return null when no active backends exist.
 */
export async function selectBackend(): Promise<StorageBackendConnection | null> {
  const rows = await db.query.storageBackends.findMany({
    where: eq(storageBackends.isActive, true),
  });
  if (rows.length === 0) {
    return null;
  }

  const sorted = [...rows].sort((a, b) => {
    const aFree =
      a.capacityGb == null
        ? Number.POSITIVE_INFINITY
        : a.capacityGb * 1024 ** 3 - a.usedBytes;
    const bFree =
      b.capacityGb == null
        ? Number.POSITIVE_INFINITY
        : b.capacityGb * 1024 ** 3 - b.usedBytes;
    return bFree - aFree;
  });

  return toConnection(sorted[0]);
}

/**
 * Adjust a backend's `usedBytes` by a delta (positive on upload, negative
 * on delete). Uses SELECT FOR UPDATE + read-then-write so concurrent
 * adjustments don't underflow. Never throws.
 *
 * This is only a between-tick APPROXIMATION: it doesn't (and can't) match
 * what restic actually reclaims (dedup means deleting a snapshot frees the
 * unique chunks only), and several removal paths skip it entirely. The
 * AUTHORITATIVE number is recomputed periodically (every 30 min) by
 * `storage.health-check`, which sums the real S3 object sizes under the
 * backend's `<env>/` prefix and writes `usedBytes`. So a failed/imprecise
 * adjust here just costs a little selection accuracy until the next reconcile.
 */
export async function adjustBackendUsage(
  backendId: string,
  deltaBytes: number
): Promise<void> {
  if (!Number.isFinite(deltaBytes) || deltaBytes === 0) {
    return;
  }
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ usedBytes: storageBackends.usedBytes })
        .from(storageBackends)
        .where(eq(storageBackends.id, backendId))
        .for("update")
        .limit(1);
      if (!row) {
        return;
      }
      const next = Math.max(0, row.usedBytes + deltaBytes);
      await tx
        .update(storageBackends)
        .set({ usedBytes: next, updatedAt: new Date() })
        .where(eq(storageBackends.id, backendId));
    });
  } catch (err) {
    console.error(
      `[storage-backends] failed to adjust usage for ${backendId} by ${deltaBytes} bytes:`,
      err
    );
  }
}
