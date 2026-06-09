/**
 * Pure per-cube disk-QoS helpers (no I/O), the single source of truth for both
 * the boot-time Firecracker `rate_limiter` and the host cgroup `io.max` numbers
 * (Rule 14). Gated by `DISK_QOS_ENABLED` / `IO_CGROUP_ENABLED` at the call sites;
 * these helpers are always safe to call and return `null` on any invalid input
 * (the validation boundary — a malformed value must never reach a PUT body or a
 * cgroup write, per the never-brick-a-boot invariant).
 *
 * Sizing: the cube's tier is DERIVED from `cube.vcpus` against the
 * `DISK_RATE_LIMITER_TIERS` bands (there is no `cubes.tier` column — same
 * derivation as the credit multiplier in lib/cost-shared.ts). NVMe-class hosts
 * scale the caps by `DISK_QOS_NVME_MULTIPLIER` (adaptive). All bandwidth numbers
 * are bytes/sec.
 */

import {
  DISK_QOS_NVME_MULTIPLIER,
  DISK_RATE_LIMITER_TIERS,
  type DiskRateLimiterTier,
} from "@/config/platform";
import { type DiskTopology, hostIsNvmeClass } from "@/lib/server/disk-topology";

/** A Firecracker drive RateLimiter TokenBucket. */
type TokenBucket = {
  /** Token bucket size (BYTES for bandwidth, OPS for ops). */
  size: number;
  /** Refill window in MILLISECONDS (sustained = size / refill_time). */
  refill_time: number;
  /** Non-replenishing initial credit (burst into idle headroom). */
  one_time_burst: number;
};

/**
 * A Firecracker drive RateLimiter — bandwidth (bytes) bounds sequential hogs +
 * ops (operations) bounds random-write hogs; FC binds whichever hits first.
 * Each bucket is OPTIONAL: an unlimited axis (tier cap = null) omits its bucket,
 * and a fully-unlimited tier produces no limiter at all (builder returns null).
 */
export type DriveRateLimiter = {
  bandwidth?: TokenBucket;
  ops?: TokenBucket;
};

/**
 * Per-device cgroup io.max numbers, device-agnostic (bytes/sec + ops/sec). Each
 * axis is OPTIONAL — an unlimited cap omits it (cgroup treats an omitted key as
 * "max"), and a fully-unlimited tier writes no io.max line at all.
 */
export type CubeIoMax = {
  wbps?: number;
  rbps?: number;
  wiops?: number;
  riops?: number;
};

/**
 * Resolve the disk-QoS tier from a cube's vCPU count, mirroring the credit-tier
 * lookup in lib/cost-shared.ts. Returns `null` for a non-finite / non-positive
 * vcpus (the only invalid case — `cubes.vcpus` is `real NOT NULL` in practice).
 * A vcpus above every band falls to the last (unlimited) tier.
 */
export function diskTierForVcpus(
  vcpus: number,
  tiers: DiskRateLimiterTier[] = DISK_RATE_LIMITER_TIERS
): DiskRateLimiterTier | null {
  if (!Number.isFinite(vcpus) || vcpus <= 0 || tiers.length === 0) {
    return null;
  }
  return (
    tiers.find(
      (t) => vcpus >= t.minVcpus && (t.maxVcpus === null || vcpus <= t.maxVcpus)
    ) ?? tiers[tiers.length - 1]
  );
}

/**
 * Sustained per-cube caps (bytes/sec + ops/sec), adaptive to host class. Each
 * axis is `null` when the tier leaves it UNLIMITED (cap = null) or the computed
 * value is non-positive/non-finite (defensive). The whole result is `null` only
 * for invalid vcpus (no tier). `mult` is ×1 today (topology passed as null at the
 * call sites — see DISK_QOS_NVME_MULTIPLIER), so caps are literal + global.
 */
function cubeQosSizing(
  vcpus: number,
  topology: DiskTopology | null | undefined,
  tiers: DiskRateLimiterTier[]
): {
  tier: DiskRateLimiterTier;
  bytesPerSec: number | null;
  opsPerSec: number | null;
} | null {
  const tier = diskTierForVcpus(vcpus, tiers);
  if (!tier) {
    return null;
  }
  const mult = hostIsNvmeClass(topology) ? DISK_QOS_NVME_MULTIPLIER : 1;
  const rawBytes =
    tier.bandwidthMbps === null
      ? null
      : Math.round(tier.bandwidthMbps * 1024 * 1024 * mult);
  const rawOps = tier.iops === null ? null : Math.round(tier.iops * mult);
  const bytesPerSec =
    rawBytes !== null && Number.isFinite(rawBytes) && rawBytes > 0
      ? rawBytes
      : null;
  const opsPerSec =
    rawOps !== null && Number.isFinite(rawOps) && rawOps > 0 ? rawOps : null;
  return { tier, bytesPerSec, opsPerSec };
}

/**
 * Build the Firecracker drive `rate_limiter` for a cube — a bandwidth bucket
 * (bytes, bounds sequential) AND an ops bucket (operations, bounds random);
 * reads+writes share each. `refill_time = 1000` ms so `size` == per-second rate.
 * `one_time_burst` = burstMultiplier × size (always ≥ size, so a single request
 * up to the burst never serializes — FC #259). Returns `null` on invalid vcpus →
 * caller spreads nothing → byte-identical flag-off body.
 */
export function buildDriveRateLimiter(
  cube: { vcpus: number },
  topology: DiskTopology | null | undefined,
  tiers: DiskRateLimiterTier[] = DISK_RATE_LIMITER_TIERS
): DriveRateLimiter | null {
  const s = cubeQosSizing(cube.vcpus, topology, tiers);
  if (!s) {
    return null;
  }
  const limiter: DriveRateLimiter = {};
  if (s.bytesPerSec !== null) {
    limiter.bandwidth = {
      size: s.bytesPerSec,
      refill_time: 1000,
      one_time_burst: s.bytesPerSec * s.tier.burstMultiplier,
    };
  }
  if (s.opsPerSec !== null) {
    limiter.ops = {
      size: s.opsPerSec,
      refill_time: 1000,
      one_time_burst: s.opsPerSec * s.tier.burstMultiplier,
    };
  }
  // Fully-unlimited tier (both axes null) → no rate_limiter at all (the customer
  // uses the full disk; byte-identical to QoS-off for that cube).
  if (!(limiter.bandwidth || limiter.ops)) {
    return null;
  }
  return limiter;
}

/**
 * Host cgroup `io.max` numbers for a cube — DEVICE-AGNOSTIC bytes/sec + ops/sec
 * (symmetric: read+write share the tier's caps). The `<maj:min>` device and the
 * final `io.max` line are assembled separately (lib/cubes/io-max.ts +
 * cubeDiskDeviceCommand), since `io.max` is per-device and the device is resolved
 * at runtime from the rootfs path. Returns `null` on invalid vcpus.
 */
export function cubeIoMax(
  cube: { vcpus: number },
  topology: DiskTopology | null | undefined,
  tiers: DiskRateLimiterTier[] = DISK_RATE_LIMITER_TIERS
): CubeIoMax | null {
  const s = cubeQosSizing(cube.vcpus, topology, tiers);
  if (!s) {
    return null;
  }
  const out: CubeIoMax = {};
  if (s.bytesPerSec !== null) {
    out.wbps = s.bytesPerSec;
    out.rbps = s.bytesPerSec;
  }
  if (s.opsPerSec !== null) {
    out.wiops = s.opsPerSec;
    out.riops = s.opsPerSec;
  }
  // Fully-unlimited tier → no io.max line (cgroup leaves the device unthrottled).
  if (out.wbps === undefined && out.wiops === undefined) {
    return null;
  }
  return out;
}
