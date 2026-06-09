/**
 * Shared storage backend object deletion logic for worker handlers.
 *
 * Used by snapshot-delete and backup-delete handlers to avoid
 * duplicating the "delete from backend, retry on failure" pattern.
 */

import { getBackendConnection } from "@/lib/storage/backends";
import { s3DeleteObject } from "@/lib/storage/s3-direct";

/**
 * Delete an object from a storage backend. Throws on failure so the job
 * retries and prevents orphaned objects. Logs warnings for missing
 * backends.
 *
 * @param storagePath - S3 object key
 * @param storageBackendId - ID of the storage backend
 * @param logPrefix - Prefix for log messages (e.g. "[snapshot-delete]")
 */
export async function deleteStorageObject(
  storagePath: string | null,
  storageBackendId: string | null,
  logPrefix: string
): Promise<void> {
  if (!storagePath || !storageBackendId) {
    if (storagePath && !storageBackendId) {
      console.warn(
        `${logPrefix} has storagePath but no storageBackendId, skipping deletion`
      );
    }
    return;
  }

  const backend = await getBackendConnection(storageBackendId);
  if (!backend) {
    console.warn(
      `${logPrefix} storage backend ${storageBackendId} not found, proceeding with DB cleanup`
    );
    return;
  }

  try {
    await s3DeleteObject(storagePath, backend);
  } catch (err) {
    console.error(
      `${logPrefix} failed to delete object (${storagePath}), will retry:`,
      err
    );
    throw err; // Retry the job — don't orphan objects
  }
}
