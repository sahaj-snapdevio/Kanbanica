import assert from "node:assert/strict";
import { test } from "node:test";
import { DISK_RATE_LIMITER_TIERS } from "@/config/platform";
import {
  resolveDiskQosTiers,
  validDiskQosOverride,
} from "@/lib/cubes/disk-qos-tiers";

test("resolveDiskQosTiers: null/empty/undefined → config defaults verbatim", () => {
  assert.deepEqual(resolveDiskQosTiers(null), DISK_RATE_LIMITER_TIERS);
  assert.deepEqual(resolveDiskQosTiers(undefined), DISK_RATE_LIMITER_TIERS);
  assert.deepEqual(resolveDiskQosTiers([]), DISK_RATE_LIMITER_TIERS);
});

test("resolveDiskQosTiers: a valid override changes only that tier's caps, never its band", () => {
  const out = resolveDiskQosTiers([
    { label: "Standard", bandwidthMbps: 90, iops: 9000, burstMultiplier: 3 },
  ]);
  const std = out.find((t) => t.label === "Standard");
  const cfgStd = DISK_RATE_LIMITER_TIERS.find((t) => t.label === "Standard");
  assert.equal(std?.bandwidthMbps, 90);
  assert.equal(std?.iops, 9000);
  assert.equal(std?.burstMultiplier, 3);
  // bands come from config, never the override
  assert.equal(std?.minVcpus, cfgStd?.minVcpus);
  assert.equal(std?.maxVcpus, cfgStd?.maxVcpus);
  // other tiers untouched
  const plus = out.find((t) => t.label === "Plus");
  const cfgPlus = DISK_RATE_LIMITER_TIERS.find((t) => t.label === "Plus");
  assert.deepEqual(plus, cfgPlus);
});

test("resolveDiskQosTiers: malformed / out-of-bounds override → that tier falls back to config", () => {
  const cfgStd = DISK_RATE_LIMITER_TIERS.find((t) => t.label === "Standard");
  // negative bandwidth, zero iops, missing burst, NaN — all rejected → config
  for (const bad of [
    { label: "Standard", bandwidthMbps: -1, iops: 9000, burstMultiplier: 2 },
    { label: "Standard", bandwidthMbps: 60, iops: 0, burstMultiplier: 2 },
    { label: "Standard", bandwidthMbps: 60, iops: 9000, burstMultiplier: 0 },
    {
      label: "Standard",
      bandwidthMbps: 200_000,
      iops: 9000,
      burstMultiplier: 2,
    },
    {
      label: "Standard",
      bandwidthMbps: Number.NaN,
      iops: 9000,
      burstMultiplier: 2,
    },
  ]) {
    const std = resolveDiskQosTiers([bad]).find((t) => t.label === "Standard");
    assert.deepEqual(std, cfgStd, `bad override ${JSON.stringify(bad)}`);
  }
});

test("resolveDiskQosTiers: null caps (UNLIMITED) are a VALID override, not a fallback", () => {
  // A fully-unlimited override is honored (null caps applied), and a partial
  // override (bandwidth set, iops unlimited) keeps the null on the other axis.
  const out = resolveDiskQosTiers([
    { label: "Standard", bandwidthMbps: null, iops: null, burstMultiplier: 2 },
    { label: "Plus", bandwidthMbps: 120, iops: null, burstMultiplier: 2 },
  ]);
  const std = out.find((t) => t.label === "Standard");
  assert.equal(std?.bandwidthMbps, null);
  assert.equal(std?.iops, null);
  const plus = out.find((t) => t.label === "Plus");
  assert.equal(plus?.bandwidthMbps, 120);
  assert.equal(plus?.iops, null);
});

test("validDiskQosOverride: null caps accepted (unlimited); burst still required", () => {
  assert.equal(
    validDiskQosOverride({
      label: "Standard",
      bandwidthMbps: null,
      iops: null,
      burstMultiplier: 2,
    }),
    true
  );
  assert.equal(
    validDiskQosOverride({
      label: "Standard",
      bandwidthMbps: 60,
      iops: null,
      burstMultiplier: 2,
    }),
    true
  );
  // burst is never nullable
  assert.equal(
    validDiskQosOverride({
      label: "Standard",
      bandwidthMbps: null,
      iops: null,
      burstMultiplier: null,
    }),
    false
  );
});

test("resolveDiskQosTiers: unknown label is ignored (no extra tier, no crash)", () => {
  const out = resolveDiskQosTiers([
    { label: "Ultra", bandwidthMbps: 999, iops: 99_999, burstMultiplier: 2 },
  ]);
  assert.deepEqual(out, DISK_RATE_LIMITER_TIERS);
});

test("validDiskQosOverride: accepts a well-formed cap, rejects junk", () => {
  assert.equal(
    validDiskQosOverride({
      label: "Standard",
      bandwidthMbps: 60,
      iops: 8000,
      burstMultiplier: 2,
    }),
    true
  );
  assert.equal(validDiskQosOverride(null), false);
  assert.equal(validDiskQosOverride("nope"), false);
  assert.equal(validDiskQosOverride({ label: "x" }), false);
  assert.equal(
    validDiskQosOverride({
      label: "x",
      bandwidthMbps: 0,
      iops: 1,
      burstMultiplier: 1,
    }),
    false
  );
});
