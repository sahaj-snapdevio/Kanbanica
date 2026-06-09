/**
 * Pure builder for the Firecracker `PUT /drives/rootfs` request body (no I/O), so
 * the durability (`cache_type`) + QoS (`rate_limiter`) additions are unit-testable
 * and the flag-OFF body is provably byte-identical to today's inline object.
 *
 * The flag is passed EXPLICITLY (like `cubeCpuWeight(vcpus)`), not read from
 * config here, so both flag states are testable without flipping a const.
 *
 * Invariants (the never-brick-a-boot rule):
 *  - flag off  → exactly { drive_id, path_on_host, is_root_device, is_read_only }
 *    (no `cache_type`, and NO `io_engine` key — FC defaults to Sync; adding the
 *    key would change the body and is never wanted).
 *  - `cache_type:"Writeback"` advertises VIRTIO_BLK_F_FLUSH so a guest fsync is
 *    durable to the backing .ext4 (FC v1.15.1, live-validated 2026-06-05).
 *  - `rate_limiter` is spread ONLY when a pre-validated object is supplied
 *    (built by buildDriveRateLimiter, which returns null on any bad value), so a
 *    malformed limiter can never reach the body.
 */

import type { DriveRateLimiter } from "@/lib/cubes/disk-iops";

export type RootfsDriveBody = {
  drive_id: "rootfs";
  path_on_host: string;
  is_root_device: true;
  is_read_only: boolean;
  cache_type?: "Writeback";
  rate_limiter?: DriveRateLimiter;
};

export function buildRootfsDriveBody(opts: {
  pathOnHost: string;
  isReadOnly?: boolean;
  /** Pass `DISK_WRITEBACK_CACHE_ENABLED` at the call site. */
  cacheWriteback: boolean;
  /** Pre-validated limiter (or null/undefined → omitted). */
  rateLimiter?: DriveRateLimiter | null;
}): RootfsDriveBody {
  return {
    drive_id: "rootfs",
    path_on_host: opts.pathOnHost,
    is_root_device: true,
    is_read_only: opts.isReadOnly ?? false,
    ...(opts.cacheWriteback ? { cache_type: "Writeback" as const } : {}),
    ...(opts.rateLimiter ? { rate_limiter: opts.rateLimiter } : {}),
  };
}
