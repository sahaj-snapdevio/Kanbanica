/**
 * Restic repository URL construction.
 *
 * Each cube has its own repo under
 *
 *   s3:https://<endpoint-host>/<bucket>/<env-prefix>/snapshot-repos/<cubeId>
 *
 * The format is documented at
 * https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html —
 * `s3:https://server/bucket/path` is the canonical custom-S3-endpoint
 * shape. Path-style addressing is required for non-AWS endpoints
 * (iDrive E2, MinIO); pass `-o s3.bucket-lookup=path` to every
 * `restic` command in `commands.ts` to enforce it.
 *
 * Why per-cube and not per-space or platform-wide:
 *  - Per-cube isolation: a corrupt repo only loses one cube's
 *    snapshot history, not everyone's.
 *  - Dedup wins are within-cube (same rootfs over time, ~95% chunk
 *    overlap). Cross-cube dedup would be marginal and would mix
 *    customer data in one repo.
 *  - Repository-level locks (`restic`'s built-in mutex) only
 *    serialize within a cube — concurrent cross-cube operations
 *    run in parallel.
 *  - Per-cube prune cron is cheap to parallelize.
 */

import type { StorageBackendConnection } from "@/lib/storage/types";

/**
 * Returns the storage env segment (`production` or `development`) that every
 * Krova S3 object is namespaced under (`<env>/snapshot-repos|backups|imports|
 * exports/...`). Exported so the `usedBytes` reconciler in
 * `storage.health-check` can list a backend's whole `<env>/` tree.
 */
export function getStorageEnvSegment(nodeEnv: string | undefined): string {
  return nodeEnv === "production" ? "production" : "development";
}

/**
 * Build the full `s3:` URL for a cube's restic repository, given the
 * active storage backend connection.
 *
 * Mirrors the path layout used by the full-blob backup pipeline
 * (`<env>/backups/<spaceId>/<backupId>.cube`) so all snapshot +
 * backup objects share one bucket and one set of S3 credentials.
 */
export function getResticRepoUrl(
  cubeId: string,
  backend: StorageBackendConnection,
  nodeEnv: string | undefined
): string {
  // `backend.endpoint` is the FULL URL including scheme — e.g.
  // `https://s3.eu-central-1.idrivee2.com`. Restic's S3 backend
  // expects everything after the `s3:` prefix to be a URL the AWS
  // SDK can parse: `s3:<scheme>://<host>[:port]/<bucket>/<path>`.
  // We strip an accidental trailing slash from the endpoint so the
  // resulting URL never has a double `//` between host and bucket.
  const endpoint = backend.endpoint.replace(/\/+$/, "");
  return `s3:${endpoint}/${backend.bucket}/${getStorageEnvSegment(nodeEnv)}/snapshot-repos/${cubeId}`;
}

/**
 * Return the S3 object-key prefix used inside the bucket for this
 * cube's repo (NO `s3:` scheme, NO host). Used by `cube-delete.ts`
 * when it needs to enumerate + delete every chunk after the cube is
 * gone (via `s3DeleteObjects` from `lib/storage/s3-direct.ts`).
 *
 * Example:
 *   `production/snapshot-repos/abc123`
 *
 * Always ends WITHOUT a trailing slash — the caller adds `/` when
 * listing keys with `ListObjectsV2` so we don't double-match (e.g.
 * `production/snapshot-repos/abc12345` would be a different cube).
 */
export function getResticRepoKeyPrefix(
  cubeId: string,
  nodeEnv: string | undefined
): string {
  return `${getStorageEnvSegment(nodeEnv)}/snapshot-repos/${cubeId}`;
}
