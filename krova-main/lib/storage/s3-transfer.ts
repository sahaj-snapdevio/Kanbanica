/**
 * Server-side S3 transfers via `rclone` orchestrated over SSH.
 *
 * For uploads and downloads of multi-GB cube rootfs blobs we never want
 * the worker process to hold file bytes. The worker SSHes into the
 * bare-metal host that owns the cube, and `rclone` runs there — opening
 * its S3 multipart streams directly from the host's uplink to the
 * provider. The worker just orchestrates and tails progress.
 *
 * Credentials are passed to `rclone` via inline environment variables on
 * the bash command line. This avoids writing a config file to disk on
 * the bare-metal host. The env vars only enter the rclone child process
 * — they are not stored, not logged via `ps`, and not exported into the
 * shell's parent state.
 *
 * Tunings come from the iDrive E2 EU benchmark (`docs/...`):
 * `--multi-thread-streams 4 --s3-upload-concurrency 4 --s3-chunk-size 64M`
 * gave the best sustained throughput on a same-continent endpoint. The
 * aggressive 16×16 setting performed identically against EU and worse
 * against US, so we stick with 4×4 to leave headroom for concurrent ops.
 */

import type { Client } from "ssh2";
import {
  DISK_IO_STORAGE_TUNING_ENABLED,
  RCLONE_BWLIMIT_MB,
} from "@/config/platform";
import { execCommand, shellEscape } from "@/lib/ssh";
import type { StorageBackendConnection } from "@/lib/storage/types";

/**
 * Build the inline `RCLONE_CONFIG_*` env block. Each variable is
 * shell-escaped. The remote name is fixed (`box`) — `rclone` resolves
 * `box:bucket/key` against these env vars without ever touching disk.
 */
function rcloneEnvBlock(conn: StorageBackendConnection): string {
  return [
    "RCLONE_CONFIG_BOX_TYPE=s3",
    "RCLONE_CONFIG_BOX_PROVIDER=Other",
    `RCLONE_CONFIG_BOX_ENDPOINT=${shellEscape(conn.endpoint)}`,
    `RCLONE_CONFIG_BOX_REGION=${shellEscape(conn.region)}`,
    `RCLONE_CONFIG_BOX_ACCESS_KEY_ID=${shellEscape(conn.accessKeyId.unwrap())}`,
    `RCLONE_CONFIG_BOX_SECRET_ACCESS_KEY=${shellEscape(conn.secretAccessKey.unwrap())}`,
    // path-style addressing — most S3-compatible providers need it.
    "RCLONE_CONFIG_BOX_FORCE_PATH_STYLE=true",
  ].join(" ");
}

export function rcloneFlags(): string {
  // Disk overhaul F: when enabled, serialize the .cube blob transfer to ONE
  // stream + one s3-upload thread (cap BOTH — s3-upload-concurrency overrides
  // multi-thread-streams when larger) and add an optional --bwlimit, so a
  // backup/redeploy/export can't saturate the host disk + uplink against live
  // cubes. Flag-off keeps the original 4x4 benchmark tuning (byte-identical).
  if (DISK_IO_STORAGE_TUNING_ENABLED) {
    return [
      "--multi-thread-streams 1",
      "--multi-thread-cutoff 100M",
      "--s3-upload-concurrency 1",
      "--s3-chunk-size 64M",
      "--retries 2",
      "--low-level-retries 5",
      "--stats 0",
      ...(RCLONE_BWLIMIT_MB > 0 ? [`--bwlimit ${RCLONE_BWLIMIT_MB}M`] : []),
    ].join(" ");
  }
  return [
    "--multi-thread-streams 4",
    "--multi-thread-cutoff 100M",
    "--s3-upload-concurrency 4",
    "--s3-chunk-size 64M",
    "--retries 2",
    "--low-level-retries 5",
    "--stats 0",
  ].join(" ");
}

/**
 * Assemble the host-side `rclone copyto` command. EXPORTED + pure so the structure
 * is locked by a unit test (s3-transfer.test.ts): the `RCLONE_CONFIG_BOX_*` env
 * assignments LEAD (the shell must export them — same env-ordering rule the
 * 2026-06-06 restic incident proved load-bearing), then `rclone copyto SRC DST`,
 * then the tuning flags. rclone (cobra/pflag) intersperses flags, so trailing
 * flags are honored — verified live on rclone 1.74.2.
 */
export function assembleRcloneCopyto(
  env: string,
  src: string,
  dst: string
): string {
  return `${env} rclone copyto ${shellEscape(src)} ${shellEscape(dst)} ${rcloneFlags()}`;
}

/**
 * Upload a local file on the bare-metal host to the S3 backend. Uses
 * `rclone copyto` to allow specifying the exact destination key. Throws
 * if rclone exits non-zero; the caller is responsible for cleaning up
 * the local file afterwards.
 */
export async function s3HostUpload(
  client: Client,
  localPath: string,
  key: string,
  conn: StorageBackendConnection,
  timeoutMs = 1_800_000
): Promise<void> {
  const env = rcloneEnvBlock(conn);
  const dst = `box:${conn.bucket}/${key}`;
  const cmd = assembleRcloneCopyto(env, localPath, dst);

  const result = await execCommand(client, cmd, timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error(`S3 upload failed: ${sanitize(result.stderr, conn)}`);
  }
}

/**
 * Download an S3 object to a local path on the bare-metal host. Mirrors
 * `s3HostUpload` flow: rclone runs on the host, bytes flow host-side.
 */
export async function s3HostDownload(
  client: Client,
  key: string,
  localPath: string,
  conn: StorageBackendConnection,
  timeoutMs = 1_800_000
): Promise<void> {
  const env = rcloneEnvBlock(conn);
  const src = `box:${conn.bucket}/${key}`;
  const cmd = assembleRcloneCopyto(env, src, localPath);

  const result = await execCommand(client, cmd, timeoutMs);
  if (result.exitCode !== 0) {
    throw new Error(`S3 download failed: ${sanitize(result.stderr, conn)}`);
  }
}

/**
 * Strip any accidental credential leakage out of rclone stderr before
 * it bubbles up into job logs, audit entries, or user-facing errors.
 */
function sanitize(stderr: string, conn: StorageBackendConnection): string {
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return stderr
    .replace(new RegExp(escapeRegex(conn.accessKeyId.unwrap()), "g"), "***")
    .replace(new RegExp(escapeRegex(conn.secretAccessKey.unwrap()), "g"), "***")
    .slice(0, 1000);
}
