import assert from "node:assert/strict";
import { test } from "node:test";
import { cubeCpuWeight } from "@/lib/cubes/cpu-weight";

test("cubeCpuWeight is vcpus*100, clamped to [1, 10000]", () => {
  assert.equal(cubeCpuWeight(1), 100);
  assert.equal(cubeCpuWeight(2), 200);
  assert.equal(cubeCpuWeight(8), 800);
  assert.equal(cubeCpuWeight(16), 1600);
  // defensive floor (vcpus is >=1 in practice, but never emit 0/negative weight)
  assert.equal(cubeCpuWeight(0), 1);
  // ceiling — cgroup-v2 cpu.weight max is 10000
  assert.equal(cubeCpuWeight(1000), 10_000);
});

test("cubeCpuWeight never emits a non-finite weight (would brick a flag-ON boot)", () => {
  // A NaN vcpus must NOT slip through the clamp as `cpu.weight=NaN` (jailer
  // rejects it). Unreachable today, but the helper claims to be always-safe.
  assert.equal(cubeCpuWeight(Number.NaN), 100);
  assert.equal(cubeCpuWeight(Number.POSITIVE_INFINITY), 100);
  assert.equal(cubeCpuWeight(Number.NEGATIVE_INFINITY), 100);
});
