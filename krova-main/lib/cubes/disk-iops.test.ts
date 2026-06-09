import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiskRateLimiterTier } from "@/config/platform";
import {
  buildDriveRateLimiter,
  cubeIoMax,
  diskTierForVcpus,
} from "@/lib/cubes/disk-iops";
import { parseDiskTopology } from "@/lib/server/disk-topology";

const SATA = parseDiskTopology("sda\t0\tsata\tmq-deadline\t0");
const NVME = parseDiskTopology("nvme0n1\t0\tnvme\tnone\t0");
const MB = 1024 * 1024;

// Explicit CAPPED tiers (the shipped DEFAULT tiers are now UNLIMITED — null caps —
// so a capped fixture is needed to exercise the throttle math).
const CAPPED: DiskRateLimiterTier[] = [
  {
    minVcpus: 1,
    maxVcpus: 2,
    label: "Standard",
    bandwidthMbps: 60,
    iops: 8000,
    burstMultiplier: 2,
    recommendedBandwidthMbps: 60,
    recommendedIops: 8000,
  },
  {
    minVcpus: 3,
    maxVcpus: null,
    label: "Plus",
    bandwidthMbps: 120,
    iops: 14_000,
    burstMultiplier: 2,
    recommendedBandwidthMbps: 120,
    recommendedIops: 14_000,
  },
];

function tier(over: Partial<DiskRateLimiterTier>): DiskRateLimiterTier[] {
  return [
    {
      minVcpus: 1,
      maxVcpus: null,
      label: "T",
      bandwidthMbps: 60,
      iops: 8000,
      burstMultiplier: 2,
      recommendedBandwidthMbps: 60,
      recommendedIops: 8000,
      ...over,
    },
  ];
}

test("diskTierForVcpus maps vcpus to the CREDIT_RATE_TIERS-aligned band (default tiers)", () => {
  assert.equal(diskTierForVcpus(1)?.label, "Standard");
  assert.equal(diskTierForVcpus(2)?.label, "Standard");
  assert.equal(diskTierForVcpus(3)?.label, "Plus");
  assert.equal(diskTierForVcpus(8)?.label, "Pro");
  assert.equal(diskTierForVcpus(9)?.label, "Enterprise");
  assert.equal(diskTierForVcpus(64)?.label, "Enterprise");
});

test("diskTierForVcpus returns null for invalid vcpus (validation boundary)", () => {
  assert.equal(diskTierForVcpus(0), null);
  assert.equal(diskTierForVcpus(-1), null);
  assert.equal(diskTierForVcpus(Number.NaN), null);
  assert.equal(diskTierForVcpus(Number.POSITIVE_INFINITY), null);
});

test("DEFAULT tiers are UNLIMITED → buildDriveRateLimiter + cubeIoMax return null (no throttle)", () => {
  // Shipped defaults: null caps → a customer uses the full disk; no rate_limiter,
  // no io.max — byte-identical to QoS-off for that cube.
  assert.equal(buildDriveRateLimiter({ vcpus: 1 }, SATA), null);
  assert.equal(buildDriveRateLimiter({ vcpus: 8 }, NVME), null);
  assert.equal(cubeIoMax({ vcpus: 1 }, SATA), null);
  assert.equal(cubeIoMax({ vcpus: 64 }, null), null);
});

test("buildDriveRateLimiter: capped tier → 60 MB/s + 8k IOPS buckets, refill 1000ms, 2x burst", () => {
  const rl = buildDriveRateLimiter({ vcpus: 1 }, SATA, CAPPED);
  assert.deepEqual(rl, {
    bandwidth: { size: 60 * MB, refill_time: 1000, one_time_burst: 120 * MB },
    ops: { size: 8000, refill_time: 1000, one_time_burst: 16_000 },
  });
});

test("buildDriveRateLimiter: NVMe topology scales BOTH buckets by the multiplier (×4)", () => {
  const sata = buildDriveRateLimiter({ vcpus: 1 }, SATA, CAPPED);
  const nvme = buildDriveRateLimiter({ vcpus: 1 }, NVME, CAPPED);
  assert.equal(nvme?.bandwidth?.size, (sata?.bandwidth?.size ?? 0) * 4);
  assert.equal(nvme?.ops?.size, (sata?.ops?.size ?? 0) * 4);
  assert.equal(nvme?.ops?.size, 32_000);
});

test("buildDriveRateLimiter: PARTIAL cap — bandwidth set, iops unlimited → only a bandwidth bucket", () => {
  const rl = buildDriveRateLimiter({ vcpus: 1 }, SATA, tier({ iops: null }));
  // deepEqual pins the EXACT shape — no `ops` key (iops unlimited).
  assert.deepEqual(rl, {
    bandwidth: { size: 60 * MB, refill_time: 1000, one_time_burst: 120 * MB },
  });
});

test("buildDriveRateLimiter: PARTIAL cap — iops set, bandwidth unlimited → only an ops bucket", () => {
  const rl = buildDriveRateLimiter(
    { vcpus: 1 },
    SATA,
    tier({ bandwidthMbps: null })
  );
  // deepEqual pins the EXACT shape — no `bandwidth` key (bandwidth unlimited).
  assert.deepEqual(rl, {
    ops: { size: 8000, refill_time: 1000, one_time_burst: 16_000 },
  });
});

test("buildDriveRateLimiter: fully-unlimited explicit tier → null", () => {
  assert.equal(
    buildDriveRateLimiter(
      { vcpus: 1 },
      SATA,
      tier({ bandwidthMbps: null, iops: null })
    ),
    null
  );
});

test("buildDriveRateLimiter: invalid vcpus → null (byte-identical flag-off body)", () => {
  assert.equal(buildDriveRateLimiter({ vcpus: 0 }, SATA, CAPPED), null);
  assert.equal(
    buildDriveRateLimiter({ vcpus: Number.NaN }, SATA, CAPPED),
    null
  );
});

test("cubeIoMax: capped tier → symmetric bytes/sec + ops/sec; partial omits an axis", () => {
  assert.deepEqual(cubeIoMax({ vcpus: 1 }, SATA, CAPPED), {
    wbps: 60 * MB,
    rbps: 60 * MB,
    wiops: 8000,
    riops: 8000,
  });
  assert.deepEqual(cubeIoMax({ vcpus: 1 }, NVME, CAPPED), {
    wbps: 240 * MB,
    rbps: 240 * MB,
    wiops: 32_000,
    riops: 32_000,
  });
  // bandwidth-only cap → no wiops/riops keys
  assert.deepEqual(cubeIoMax({ vcpus: 1 }, SATA, tier({ iops: null })), {
    wbps: 60 * MB,
    rbps: 60 * MB,
  });
  assert.equal(cubeIoMax({ vcpus: 0 }, SATA, CAPPED), null);
});
