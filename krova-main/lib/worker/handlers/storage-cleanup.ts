import type { Job } from "pg-boss";

import { audit } from "@/lib/audit";
import { getBackendConnection } from "@/lib/storage/backends";
import { s3DeleteObjects, s3ListObjects } from "@/lib/storage/s3-direct";
import type { StorageCleanupPayload } from "@/lib/worker/job-types";

async function handleStorageCleanupJob(
  job: Job<StorageCleanupPayload>
): Promise<void> {
  const { storagePaths, storagePrefix, storageBackendId, reason } = job.data;

  // Mode validation: exactly one input must be set.
  const hasPaths = Array.isArray(storagePaths) && storagePaths.length > 0;
  const hasPrefix =
    typeof storagePrefix === "string" && storagePrefix.length > 0;
  if (hasPaths && hasPrefix) {
    throw new Error(
      `[storage-cleanup] both storagePaths and storagePrefix set — ambiguous (reason: ${reason})`
    );
  }
  if (!hasPaths && !hasPrefix) {
    // Empty-paths legitimate case: caller had nothing to delete but
    // still enqueued. No-op cleanly.
    if (Array.isArray(storagePaths)) {
      console.log(
        `[storage-cleanup] empty storagePaths — nothing to do (reason: ${reason})`
      );
      return;
    }
    throw new Error(
      `[storage-cleanup] neither storagePaths nor storagePrefix set (reason: ${reason})`
    );
  }

  const backend = await getBackendConnection(storageBackendId);
  if (!backend) {
    console.warn(
      `[storage-cleanup] storage backend ${storageBackendId} not found, skipping cleanup`
    );
    return;
  }

  // Resolve keys to delete based on mode. Prefix mode lists the
  // bucket (paginated) and collects every key under the prefix.
  let keys: string[];
  let mode: "paths" | "prefix";
  if (hasPaths) {
    keys = storagePaths;
    mode = "paths";
  } else {
    // Narrowing: `hasPrefix` is true here (we passed the mode-validation
    // gate above which throws if neither path nor prefix is set).
    const prefix = storagePrefix as string;
    mode = "prefix";
    console.log(
      `[storage-cleanup] listing prefix "${prefix}" on backend ${storageBackendId}`
    );
    const objects = await s3ListObjects(backend, [prefix]);
    keys = objects.map((o) => o.key);
    console.log(
      `[storage-cleanup] prefix "${prefix}" → ${keys.length} object(s) to delete`
    );
  }

  console.log(
    `[storage-cleanup] starting: ${keys.length} object(s) on backend ${storageBackendId} (mode=${mode}) — ${reason}`
  );

  const { deleted, failed } = await s3DeleteObjects(keys, backend);

  audit({
    action: "storage.cleanup",
    category: "platform",
    actorType: "system",
    entityType: "storage",
    description: `Storage backend cleanup: ${deleted} deleted, ${failed} failed — ${reason}`,
    metadata: {
      total: keys.length,
      deleted,
      failed,
      mode,
      prefix: hasPrefix ? storagePrefix : undefined,
      reason,
      storageBackendId,
    },
    source: "worker",
  });

  // Avoid the word "failed" in the success path — the Dokploy log viewer
  // keyword-matches it and color-codes the row as ERROR.
  console.log(
    failed === 0
      ? `[storage-cleanup] completed — ${deleted} object(s) deleted`
      : `[storage-cleanup] completed — ${deleted} deleted, ${failed} failed`
  );

  // Throw on partial failure so pg-boss retries the whole job. S3
  // DeleteObjects treats a missing key as success, so a retry only
  // re-attempts the genuinely-failed keys. Without this, a failed
  // delete would silently leave an orphaned object with no DB row
  // pointing at it (the caller deletes the DB rows regardless).
  if (failed > 0) {
    throw new Error(
      `Storage cleanup left ${failed} of ${keys.length} object(s) undeleted on backend ${storageBackendId} — ${reason}`
    );
  }
}

export async function handleStorageCleanup(
  jobs: Job<StorageCleanupPayload>[]
): Promise<void> {
  for (const job of jobs) {
    await handleStorageCleanupJob(job);
  }
}
