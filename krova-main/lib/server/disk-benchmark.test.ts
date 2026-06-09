import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DISK_BENCH_SKIP_MARKER,
  deriveDiskTuning,
  diskBenchmarkCommand,
  parseDiskWriteMbps,
} from "@/lib/server/disk-benchmark";

test("diskBenchmarkCommand: clean-guard + O_DIRECT write + cleanup", () => {
  const cmd = diskBenchmarkCommand();
  // refuses if the cube dir is non-empty (never benchmark a host with tenants)
  assert.match(cmd, /ls -A "\/var\/lib\/krova\/cubes"/);
  assert.match(cmd, new RegExp(`echo ${DISK_BENCH_SKIP_MARKER}`));
  // O_DIRECT bypasses the page cache so we measure the device, not RAM
  assert.match(cmd, /dd if=\/dev\/zero .* oflag=direct conv=fdatasync/);
  // writes under the storage root + cleans up
  assert.match(cmd, /\/var\/lib\/krova\/\.krova-diskbench\.tmp/);
  assert.match(cmd, /rm -f/);
});

test("parseDiskWriteMbps: computes MB/s from bytes + seconds (unit-proof)", () => {
  // 2147483648 bytes / 4.50631 s = 476.5 MB/s
  assert.equal(
    parseDiskWriteMbps(
      "2147483648 bytes (2.1 GB, 2.0 GiB) copied, 4.50631 s, 477 MB/s"
    ),
    477
  );
  // a GB/s rate field is ignored — we use bytes/seconds (2147483648 / 1.0 = 2147)
  assert.equal(
    parseDiskWriteMbps("2147483648 bytes (2.1 GB) copied, 1.0 s, 2.1 GB/s"),
    2147
  );
});

test("parseDiskWriteMbps: skip marker / junk / zero → null", () => {
  assert.equal(parseDiskWriteMbps(DISK_BENCH_SKIP_MARKER), null);
  assert.equal(parseDiskWriteMbps(""), null);
  assert.equal(parseDiskWriteMbps(null), null);
  assert.equal(parseDiskWriteMbps("dd: failed to open"), null);
  assert.equal(parseDiskWriteMbps("100 bytes copied, 0 s, x"), null); // div by 0
});

test("deriveDiskTuning: ~500 MB/s SATA reproduces the validated 256 MiB / 50 MB/s", () => {
  const t = deriveDiskTuning(500);
  // 500 * 1e6 * 0.5 = 250 MB (within [64 MiB, 2 GiB])
  assert.equal(t?.dirtyBytes, 250_000_000);
  assert.equal(t?.backgroundBytes, 62_500_000);
  // 500 * 1000 * 0.1 = 50000 KB/s = 50 MB/s
  assert.equal(t?.scrubKbps, 50_000);
});

test("deriveDiskTuning: NVMe scales up but the dirty pool is capped at 2 GiB", () => {
  const t = deriveDiskTuning(8000); // 8 GB/s NVMe: 8000*1e6*0.5 = 4 GB → cap 2 GiB
  assert.equal(t?.dirtyBytes, 2_147_483_648);
  assert.equal(t?.scrubKbps, 800_000); // 8000*1000*0.1
});

test("deriveDiskTuning: slow disk floored; invalid input → null", () => {
  const t = deriveDiskTuning(50); // 50*1e6*0.5 = 25 MB < 64 MiB floor
  assert.equal(t?.dirtyBytes, 67_108_864);
  assert.equal(t?.scrubKbps, 10_000); // 50*1000*0.1 = 5000 < 10000 floor
  assert.equal(deriveDiskTuning(0), null);
  assert.equal(deriveDiskTuning(-1), null);
  assert.equal(deriveDiskTuning(Number.NaN), null);
});
