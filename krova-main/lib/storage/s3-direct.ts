/**
 * Worker-side S3 operations via AWS SDK.
 *
 * Lightweight operations only: object deletion, capacity probe, listing.
 * Heavy file uploads/downloads go through `s3-transfer.ts` which runs
 * `rclone` on the bare-metal host so backup bytes never traverse the
 * worker process or the worker host's bandwidth.
 */

import {
  type _Object,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

import { buildS3Client } from "@/lib/storage/s3-client";
import type { StorageBackendConnection } from "@/lib/storage/types";

/**
 * Delete a single object. Treats "missing" as success — repeated deletes
 * are idempotent. Throws on any other error so the caller can retry.
 */
export async function s3DeleteObject(
  key: string,
  conn: StorageBackendConnection
): Promise<void> {
  const client = buildS3Client(conn);
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: conn.bucket, Key: key })
    );
  } catch (err) {
    const code = (err as { name?: string; Code?: string }).name;
    const errCode = (err as { Code?: string }).Code;
    if (code === "NoSuchKey" || errCode === "NoSuchKey") {
      return;
    }
    throw err;
  } finally {
    client.destroy();
  }
}

/**
 * Delete up to 1000 objects in a single S3 call. Returns counts of
 * successful and failed deletions. Missing keys count as deleted (S3
 * `DeleteObjects` semantics).
 */
export async function s3DeleteObjects(
  keys: string[],
  conn: StorageBackendConnection
): Promise<{ deleted: number; failed: number }> {
  if (keys.length === 0) {
    return { deleted: 0, failed: 0 };
  }
  const client = buildS3Client(conn);
  try {
    let deleted = 0;
    let failed = 0;
    // S3 DeleteObjects caps at 1000 keys per request; batch in chunks.
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      const res = await client.send(
        new DeleteObjectsCommand({
          Bucket: conn.bucket,
          Delete: {
            Objects: chunk.map((Key) => ({ Key })),
            Quiet: false,
          },
        })
      );
      deleted += res.Deleted?.length ?? 0;
      const errs = res.Errors ?? [];
      for (const e of errs) {
        // NoSuchKey is idempotent success — count it as deleted.
        if (e.Code === "NoSuchKey") {
          deleted++;
        } else {
          failed++;
          console.warn(
            `[s3-direct] failed to delete ${e.Key}: ${e.Code} ${e.Message}`
          );
        }
      }
    }
    return { deleted, failed };
  } finally {
    client.destroy();
  }
}

export interface S3ObjectInfo {
  key: string;
  mtimeMs: number;
  sizeBytes: number;
}

/**
 * Compute the next ListObjectsV2 continuation token, guarding the
 * S3-COMPATIBLE quirk where a page reports `IsTruncated=true` but omits
 * `NextContinuationToken`. AWS S3 guarantees the token is present when
 * truncated, but iDrive E2 / MinIO / B2 can deviate. Silently ending the walk
 * early would UNDER-count — `storage:audit` would miss orphans, and the
 * `usedBytes` reconciler would SHRINK usage, steering uploads onto a full
 * backend and silencing the capacity warning. We THROW so the caller treats it
 * as a failed list (the reconciler keeps its prior `usedBytes`; the audit
 * surfaces the error) rather than committing a short result.
 */
function nextContinuationToken(res: {
  IsTruncated?: boolean;
  NextContinuationToken?: string;
}): string | undefined {
  if (!res.IsTruncated) {
    return;
  }
  if (!res.NextContinuationToken) {
    throw new Error(
      "ListObjectsV2 returned IsTruncated=true without a NextContinuationToken — refusing to commit a partial object listing (S3-compatible endpoint pagination quirk)"
    );
  }
  return res.NextContinuationToken;
}

/**
 * Recursively list every object under each `prefix` in the bucket.
 * Used by the `storage:audit` script to detect orphan files (S3 objects
 * with no matching DB row).
 */
export async function s3ListObjects(
  conn: StorageBackendConnection,
  prefixes: string[]
): Promise<S3ObjectInfo[]> {
  const client = buildS3Client(conn);
  try {
    const results: S3ObjectInfo[] = [];
    for (const prefix of prefixes) {
      let continuationToken: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: conn.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );
        for (const obj of res.Contents ?? ([] as _Object[])) {
          if (!obj.Key) {
            continue;
          }
          results.push({
            key: obj.Key,
            sizeBytes: obj.Size ?? 0,
            mtimeMs: obj.LastModified?.getTime() ?? 0,
          });
        }
        continuationToken = nextContinuationToken(res);
      } while (continuationToken);
    }
    return results;
  } finally {
    client.destroy();
  }
}

/**
 * Sum the size (and count) of every object under each prefix, STREAMING
 * pages so we never hold the full object list in memory — a restic repo can
 * contain tens of thousands of small chunk objects. Used by
 * `storage.health-check` to reconcile a backend's `usedBytes` against ground
 * truth (the authoritative number; the per-op `adjustBackendUsage` deltas are
 * only a between-tick approximation).
 */
export async function s3SumObjectSizes(
  conn: StorageBackendConnection,
  prefixes: string[]
): Promise<{ objectCount: number; totalBytes: number }> {
  const client = buildS3Client(conn);
  try {
    let totalBytes = 0;
    let objectCount = 0;
    for (const prefix of prefixes) {
      let continuationToken: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: conn.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
        );
        for (const obj of res.Contents ?? ([] as _Object[])) {
          totalBytes += obj.Size ?? 0;
          objectCount++;
        }
        continuationToken = nextContinuationToken(res);
      } while (continuationToken);
    }
    return { objectCount, totalBytes };
  } finally {
    client.destroy();
  }
}

/**
 * Probe the backend by issuing a HeadBucket request. Returns true on 2xx,
 * throws with a readable message otherwise. Used by the health-check job
 * and the Orbit "Test connection" admin button.
 */
export async function s3ProbeBackend(
  conn: StorageBackendConnection
): Promise<void> {
  const client = buildS3Client(conn);
  try {
    await client.send(new HeadBucketCommand({ Bucket: conn.bucket }));
  } finally {
    client.destroy();
  }
}
