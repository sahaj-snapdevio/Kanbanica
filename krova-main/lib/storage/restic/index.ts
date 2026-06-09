/**
 * Restic snapshot subsystem — per-cube content-addressed dedup'd
 * backups against the platform's active S3 storage backend.
 *
 * Snapshots (chunked, dedup'd) and full-blob backups (`.cube`
 * archives) coexist in the same S3 bucket under distinct prefixes:
 *
 *   <bucket>/
 *     <env>/
 *       backups/<spaceId>/<backupId>.cube           ← portable archive
 *       imports/<spaceId>/<importId>.cube           ← customer uploads
 *       snapshot-repos/<cubeId>/                    ← restic repo
 *         config keys/ data/ index/ snapshots/ locks/
 *
 * Public API in this module:
 *
 *   `loadResticRepoConfig(cubeId, override?)` — fetches backend creds +
 *     per-cube password and returns a `ResticRepoConfig` ready to
 *     pass to the command wrappers. Backend resolution:
 *       1. If `override` is passed (specific backend id OR a fully
 *          loaded connection), use that — for snapshot-restore /
 *          snapshot-delete which carry the snapshot's backend id.
 *       2. Else look up the cube's existing snapshot rows. If any
 *          exist, use the backend they live on (so a cube's repo
 *          stays pinned to its FIRST snapshot's backend, even after
 *          the operator adds a higher-capacity second backend).
 *       3. Else fall back to `selectBackend()` — first snapshot ever.
 *
 *   `ensureResticRepo` / `resticBackup` / `resticRestore` /
 *   `resticForgetSnapshot` / `resticPrune` / `resticCheck` /
 *   `resticListSnapshots` — shell-out wrappers that run `restic`
 *     on a bare-metal host over SSH.
 *
 *   `getResticRepoKeyPrefix(cubeId)` — S3 key prefix for the
 *     cube's repo, used by `cube.delete` cleanup to wipe every
 *     chunk after a cube is deleted.
 */

import { and, eq, isNotNull } from "drizzle-orm";

import { cubeSnapshots } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getBackendConnection, selectBackend } from "@/lib/storage/backends";
import { getOrCreateRepoPasswordForCube } from "@/lib/storage/restic/password";
import { getResticRepoUrl } from "@/lib/storage/restic/repo-path";
import type { ResticRepoConfig } from "@/lib/storage/restic/types";
import type { StorageBackendConnection } from "@/lib/storage/types";

/**
 * Result of `loadResticRepoConfig` — the wire-format the command
 * wrappers need (`config`) plus the resolved backend connection
 * (`backend`) so callers that ALSO need to write `storageBackendId`
 * on a new snapshot row or call `adjustBackendUsage` don't have to
 * resolve the backend twice.
 */
export interface LoadedResticRepoConfig {
  backend: StorageBackendConnection;
  config: ResticRepoConfig;
}

/**
 * Resolve everything a `restic` command needs for a given cube:
 * the backend (creds, endpoint, bucket), the cube's encryption
 * password (creating one on first use), and the full repo URL.
 *
 * `override` — accept either a `backendId` string or an already-loaded
 * `StorageBackendConnection`. Pass it whenever the caller knows which
 * backend the cube's repo lives on (snapshot-restore + snapshot-delete
 * read `cube_snapshots.storageBackendId`; cube-delete sweeps every
 * active backend). Without an override, we look up the cube's
 * existing snapshot rows to pin the backend; if none exist (first
 * snapshot ever), we fall back to `selectBackend()`.
 *
 * Throws if no backend can be resolved (no active backends + no
 * existing snapshots).
 */
export async function loadResticRepoConfig(
  cubeId: string,
  override?: string | StorageBackendConnection
): Promise<LoadedResticRepoConfig> {
  let backend: StorageBackendConnection | null;
  if (override) {
    if (typeof override === "string") {
      backend = await getBackendConnection(override);
      if (!backend) {
        throw new Error(
          `Storage backend ${override} not found for cube ${cubeId}`
        );
      }
    } else {
      backend = override;
    }
  } else {
    // Pin the cube to its existing repo backend. We don't filter on
    // status (`complete` vs `failed`) because any row with a
    // `storageBackendId` was written by snapshot-create AFTER the
    // backend was selected — that's the backend that holds the repo
    // scaffolding (config/keys/), regardless of whether the
    // individual snapshot succeeded.
    const [existing] = await db
      .select({ storageBackendId: cubeSnapshots.storageBackendId })
      .from(cubeSnapshots)
      .where(
        and(
          eq(cubeSnapshots.cubeId, cubeId),
          // Defensive: storageBackendId is nullable in the schema
          // (cleared via `onDelete: set null` if a backend row is
          // removed). Ignore rows with no backend so we don't crash
          // trying to load a null backend.
          isNotNull(cubeSnapshots.storageBackendId)
        )
      )
      .limit(1);
    if (existing?.storageBackendId) {
      backend = await getBackendConnection(existing.storageBackendId);
      if (!backend) {
        throw new Error(
          `Storage backend ${existing.storageBackendId} (referenced by cube ${cubeId} snapshots) not found`
        );
      }
    } else {
      backend = await selectBackend();
      if (!backend) {
        throw new Error("No active storage backend configured");
      }
    }
  }
  const password = await getOrCreateRepoPasswordForCube(cubeId);
  return {
    config: {
      repoUrl: getResticRepoUrl(cubeId, backend, env.NODE_ENV),
      repoPassword: password,
      accessKeyId: backend.accessKeyId.unwrap(),
      secretAccessKey: backend.secretAccessKey.unwrap(),
    },
    backend,
  };
}

export {
  ensureResticRepo,
  type ResticBackupResult,
  resticBackup,
  resticCatLock,
  resticCheck,
  resticDump,
  resticForgetSnapshot,
  resticForgetWithRetention,
  resticListLocks,
  resticListSnapshots,
  resticPrune,
  resticRestore,
  resticUnlock,
} from "@/lib/storage/restic/commands";
export { getOrCreateRepoPasswordForCube } from "@/lib/storage/restic/password";
export {
  getResticRepoKeyPrefix,
  getResticRepoUrl,
  getStorageEnvSegment,
} from "@/lib/storage/restic/repo-path";
export type {
  ResticLockInfo,
  ResticRepoConfig,
  ResticSnapshotInfo,
} from "@/lib/storage/restic/types";
