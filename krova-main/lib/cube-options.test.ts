import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CPU_OPTIONS,
  DISK_OPTIONS,
  RAM_OPTIONS,
  type RangeConfig,
} from "@/config/platform";
import {
  describeRange,
  formatRam,
  isValidRangeValue,
  rangeValues,
} from "@/lib/cube-options";

// ── isValidRangeValue ────────────────────────────────────────────────────────

test("isValidRangeValue: accepts in-range, step-aligned values", () => {
  assert.equal(isValidRangeValue(1, CPU_OPTIONS), true); // min
  assert.equal(isValidRangeValue(16, CPU_OPTIONS), true); // max
  assert.equal(isValidRangeValue(8, CPU_OPTIONS), true);
  assert.equal(isValidRangeValue(1024, RAM_OPTIONS), true);
  assert.equal(isValidRangeValue(32_768, RAM_OPTIONS), true);
  assert.equal(isValidRangeValue(15, DISK_OPTIONS), true); // 10 + 5
});

test("isValidRangeValue: rejects out-of-range values", () => {
  assert.equal(isValidRangeValue(0, CPU_OPTIONS), false);
  assert.equal(isValidRangeValue(17, CPU_OPTIONS), false);
  assert.equal(isValidRangeValue(512, RAM_OPTIONS), false);
  assert.equal(isValidRangeValue(101, DISK_OPTIONS), false);
});

test("isValidRangeValue: rejects step-misaligned values", () => {
  assert.equal(isValidRangeValue(2.5, CPU_OPTIONS), false); // step 1
  assert.equal(isValidRangeValue(1500, RAM_OPTIONS), false); // not a 1024 multiple
  assert.equal(isValidRangeValue(12, DISK_OPTIONS), false); // step 5 → 10,15,…
});

test("isValidRangeValue: rejects NaN / Infinity", () => {
  assert.equal(isValidRangeValue(Number.NaN, CPU_OPTIONS), false);
  assert.equal(isValidRangeValue(Number.POSITIVE_INFINITY, CPU_OPTIONS), false);
});

test("isValidRangeValue: tolerates float-step ranges (no precision false-negatives)", () => {
  const half: RangeConfig = { min: 0, max: 2, step: 0.5 };
  assert.equal(isValidRangeValue(0.5, half), true);
  assert.equal(isValidRangeValue(1.5, half), true);
  assert.equal(isValidRangeValue(0.3, half), false);
});

// ── rangeValues ──────────────────────────────────────────────────────────────

test("rangeValues: enumerates inclusive of both bounds with the right count", () => {
  const cpu = rangeValues(CPU_OPTIONS);
  assert.equal(cpu.length, 16);
  assert.equal(cpu[0], 1);
  assert.equal(cpu.at(-1), 16);

  const disk = rangeValues(DISK_OPTIONS); // 10..100 step 5
  assert.equal(disk.length, 19);
  assert.equal(disk[0], 10);
  assert.equal(disk.at(-1), 100);

  const ram = rangeValues(RAM_OPTIONS); // 1024..32768 step 1024
  assert.equal(ram.length, 32);
  assert.equal(ram.at(-1), 32_768);
});

test("rangeValues: float steps come back without drift", () => {
  assert.deepEqual(rangeValues({ min: 0, max: 1, step: 0.5 }), [0, 0.5, 1]);
});

// ── describeRange / formatRam ────────────────────────────────────────────────

test("describeRange: renders min–max (step N)", () => {
  assert.equal(describeRange(CPU_OPTIONS), "1–16 (step 1)");
});

test("formatRam: MB under 1 GB, GB at/over with trimmed decimals", () => {
  assert.equal(formatRam(512), "512 MB");
  assert.equal(formatRam(1024), "1 GB");
  assert.equal(formatRam(1536), "1.5 GB");
  assert.equal(formatRam(2048), "2 GB");
  assert.equal(formatRam(32_768), "32 GB");
});
