import assert from "node:assert/strict";
import { test } from "node:test";
import {
  serverCpuRamCapacity,
  serverHasCpuRamRoom,
} from "@/lib/server/cpu-ram-capacity";

const srv = {
  totalCpus: 72,
  totalRamMb: 256_000,
  maxCpuOvercommit: "2.00",
  maxRamOvercommit: "1.00",
  allocatedCpus: 70,
  allocatedRamMb: 250_000,
};

test("serverCpuRamCapacity multiplies totals by the overcommit ratios", () => {
  const cap = serverCpuRamCapacity(srv);
  assert.equal(cap.maxCpu, 144); // 72 * 2.00
  assert.equal(cap.maxRam, 256_000); // 256000 * 1.00
});

test("serverCpuRamCapacity parses numeric-string ratios", () => {
  const cap = serverCpuRamCapacity({
    totalCpus: 10,
    totalRamMb: 1000,
    maxCpuOvercommit: 1.5,
    maxRamOvercommit: "1.25",
  });
  assert.equal(cap.maxCpu, 15);
  assert.equal(cap.maxRam, 1250);
});

test("serverHasCpuRamRoom: fits when adding stays within both caps", () => {
  // 70+2=72 <= 144, 250000+5000=255000 <= 256000
  assert.equal(serverHasCpuRamRoom(srv, 2, 5000), true);
});

test("serverHasCpuRamRoom: rejects when RAM would exceed the cap", () => {
  // 250000+10000=260000 > 256000
  assert.equal(serverHasCpuRamRoom(srv, 2, 10_000), false);
});

test("serverHasCpuRamRoom: rejects when CPU would exceed the cap", () => {
  // 70+80=150 > 144
  assert.equal(serverHasCpuRamRoom(srv, 80, 0), false);
});

test("serverHasCpuRamRoom: exact-fit boundary is allowed (<=)", () => {
  // 70+74=144 == maxCpu, 250000+6000=256000 == maxRam
  assert.equal(serverHasCpuRamRoom(srv, 74, 6000), true);
});
