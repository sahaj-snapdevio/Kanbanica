import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availableDiskGb,
  effectiveDiskCapacityGb,
  serverHasDiskRoom,
} from "@/lib/server/disk-capacity";

test("effectiveDiskCapacityGb: total minus measured overhead", () => {
  assert.equal(
    effectiveDiskCapacityGb({
      totalDiskGb: 500,
      overheadDiskGb: 40,
      allocatedDiskGb: 0,
    }),
    460
  );
});

test("effectiveDiskCapacityGb: overhead 0 (never measured) = full partition", () => {
  assert.equal(
    effectiveDiskCapacityGb({
      totalDiskGb: 500,
      overheadDiskGb: 0,
      allocatedDiskGb: 0,
    }),
    500
  );
});

test("effectiveDiskCapacityGb: clamps at 0 when overhead exceeds the partition", () => {
  assert.equal(
    effectiveDiskCapacityGb({
      totalDiskGb: 50,
      overheadDiskGb: 80,
      allocatedDiskGb: 0,
    }),
    0
  );
});

test("availableDiskGb: effective minus already-reserved", () => {
  assert.equal(
    availableDiskGb({
      totalDiskGb: 500,
      overheadDiskGb: 40,
      allocatedDiskGb: 200,
    }),
    260
  );
});

test("availableDiskGb: clamps at 0 when over-reserved", () => {
  assert.equal(
    availableDiskGb({
      totalDiskGb: 100,
      overheadDiskGb: 0,
      allocatedDiskGb: 130,
    }),
    0
  );
});

test("serverHasDiskRoom: fits exactly at the effective ceiling (<=)", () => {
  // effective = 100, allocated 60, request 40 → exactly fills, allowed
  assert.equal(
    serverHasDiskRoom(
      { totalDiskGb: 100, overheadDiskGb: 0, allocatedDiskGb: 60 },
      40
    ),
    true
  );
});

test("serverHasDiskRoom: one GB over the ceiling is rejected (no overselling)", () => {
  assert.equal(
    serverHasDiskRoom(
      { totalDiskGb: 100, overheadDiskGb: 0, allocatedDiskGb: 60 },
      41
    ),
    false
  );
});

test("serverHasDiskRoom: overhead shrinks the usable room", () => {
  // effective = 100-30 = 70; allocated 50; request 25 → 75 > 70 → rejected
  assert.equal(
    serverHasDiskRoom(
      { totalDiskGb: 100, overheadDiskGb: 30, allocatedDiskGb: 50 },
      25
    ),
    false
  );
  // request 20 → 70 <= 70 → allowed
  assert.equal(
    serverHasDiskRoom(
      { totalDiskGb: 100, overheadDiskGb: 30, allocatedDiskGb: 50 },
      20
    ),
    true
  );
});
