/**
 * Restic repository connection — everything a `restic ...` shell
 * invocation on a bare-metal host needs to talk to the cube's per-cube
 * S3-backed repo.
 *
 * The repo URL follows the format documented at
 * https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html
 * for custom S3 endpoints:
 *
 *   s3:https://<endpoint-host>/<bucket>/<repo-prefix>
 *
 * `repoPassword` is the per-cube encryption password (random UUID
 * generated on first init, stored AES-256-GCM-encrypted in
 * `cubes.snapshot_repo_password_enc`).
 *
 * `accessKeyId` / `secretAccessKey` come from the platform's active
 * `storage_backends` row — same iDrive E2 bucket used for full-blob
 * backups, just under a different `snapshot-repos/<cubeId>/` prefix.
 */
export interface ResticRepoConfig {
  /** S3 access-key id (plaintext, only held in memory). */
  accessKeyId: string;
  /** Per-cube encryption password (plaintext, only held in memory). */
  repoPassword: string;
  /** Fully-qualified restic repo URL, including the `s3:` scheme. */
  repoUrl: string;
  /** S3 secret access key (plaintext, only held in memory). */
  secretAccessKey: string;
}

/**
 * Metadata of a single restic repository lock, as returned by
 * `restic cat lock <id>`. Used by the `restic:unlock` operator script to show
 * who holds a lock before removing it.
 */
export interface ResticLockInfo {
  /** Exclusive (backup/forget/prune) vs shared (read) lock. */
  exclusive?: boolean;
  /** Hostname of the machine that created the lock. */
  hostname?: string;
  /** Short lock id (from `restic list locks`). */
  id: string;
  /** PID of the process that created the lock. */
  pid?: number;
  /** ISO timestamp the lock was created. */
  time?: string;
  username?: string;
}

/**
 * Single entry in the JSON array `restic snapshots --json` returns.
 * We only project the fields we actually use; restic emits more.
 */
export interface ResticSnapshotInfo {
  /** Full snapshot id (64 hex chars). */
  id: string;
  paths?: string[];
  /** First 8 chars — what `restic` shows by default. */
  short_id: string;
  summary?: {
    /** Bytes added to the repo by this snapshot (post-dedup). */
    data_added?: number;
    /** Total bytes of source files scanned. */
    total_bytes_processed?: number;
  };
  tags?: string[];
  time: string;
}
