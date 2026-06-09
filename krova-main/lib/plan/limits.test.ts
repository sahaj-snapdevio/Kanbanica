import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCanAddDomainV2,
  assertCanCreateCubeV2,
  assertCanInviteMemberV2,
  assertCanKeepBackupV2,
  assertCanWakeCubeV2,
  assertCubeWithinSizeV2,
  type EffectiveLimits,
  effectiveLimits,
  type SpaceOverrides,
  toClientLimits,
} from "@/lib/plan/limits";
import type { Plan } from "@/lib/plan/usage";

// PURE plan-limit guards + the effectiveLimits merge. No DB.

function limits(over: Partial<EffectiveLimits> = {}): EffectiveLimits {
  return {
    label: "TestPlan",
    maxConcurrentCubes: 3,
    maxVcpus: 4,
    maxRamMb: 8192,
    maxDiskGb: 50,
    maxSeats: 5,
    maxBackups: 2,
    maxDomains: 3,
    allowTopup: true,
    allowOverage: true,
    autoSnapshotCadenceHours: 6,
    autoSnapshotKeepLast: 4,
    autoSnapshotKeepDaily: 7,
    autoSnapshotKeepWeekly: 1,
    maxManualSnapshotsPerCube: 2,
    includedCreditUsd: 10,
    ...over,
  };
}

// ── effectiveLimits merge ────────────────────────────────────────────────────

function plan(over: Partial<Plan> = {}): Plan {
  return {
    name: "Pro",
    maxConcurrentCubes: 3,
    maxVcpus: 4,
    maxRamMb: 8192,
    maxDiskGb: 50,
    maxSeats: 5,
    maxBackups: 2,
    maxDomains: 3,
    allowTopup: true,
    allowOverage: true,
    autoSnapshotCadenceHours: 6,
    autoSnapshotKeepLast: 4,
    autoSnapshotKeepDaily: 7,
    autoSnapshotKeepWeekly: 1,
    maxManualSnapshotsPerCube: 2,
    includedCreditUsd: "10.0000",
    ...over,
  } as unknown as Plan;
}

const noOverrides: SpaceOverrides = {
  overrideAllowOverage: null,
  overrideAllowTopup: null,
  overrideIncludedCreditUsd: null,
  overrideMaxBackups: null,
  overrideMaxConcurrentCubes: null,
  overrideMaxDiskGb: null,
  overrideMaxDomains: null,
  overrideMaxRamMb: null,
  overrideMaxSeats: null,
  overrideMaxVcpus: null,
};

test("effectiveLimits: with no overrides, every field is the plan value", () => {
  const e = effectiveLimits(plan(), noOverrides);
  assert.equal(e.label, "Pro");
  assert.equal(e.maxConcurrentCubes, 3);
  assert.equal(e.maxVcpus, 4);
  assert.equal(e.maxRamMb, 8192);
  assert.equal(e.maxDiskGb, 50);
  assert.equal(e.maxSeats, 5);
  assert.equal(e.maxBackups, 2);
  assert.equal(e.maxDomains, 3);
  assert.equal(e.allowTopup, true);
  assert.equal(e.allowOverage, true);
  assert.equal(e.includedCreditUsd, 10, "numeric string parsed to number");
});

test("effectiveLimits: a set override wins over the plan value", () => {
  const e = effectiveLimits(plan(), {
    ...noOverrides,
    overrideMaxConcurrentCubes: 99,
    overrideMaxVcpus: 16,
    overrideAllowOverage: false,
    overrideIncludedCreditUsd: "250.0000",
  });
  assert.equal(e.maxConcurrentCubes, 99);
  assert.equal(e.maxVcpus, 16);
  assert.equal(e.allowOverage, false);
  assert.equal(e.includedCreditUsd, 250);
  // unset overrides still fall through to the plan
  assert.equal(e.maxRamMb, 8192);
});

test("effectiveLimits: override of 0 / false is honoured (not treated as unset)", () => {
  // `??` (not `||`) means 0 and false are real override values.
  const e = effectiveLimits(plan(), {
    ...noOverrides,
    overrideMaxBackups: 0,
    overrideAllowTopup: false,
  });
  assert.equal(e.maxBackups, 0, "0 override must NOT fall back to the plan");
  assert.equal(e.allowTopup, false, "false override must NOT fall back");
});

// ── assertCubeWithinSizeV2 ───────────────────────────────────────────────────

test("assertCubeWithinSizeV2: a size at the caps passes; over any cap fails", () => {
  const l = limits();
  assert.equal(
    assertCubeWithinSizeV2(l, { vcpus: 4, ramMb: 8192, diskGb: 50 }).ok,
    true
  );
  assert.equal(
    assertCubeWithinSizeV2(l, { vcpus: 5, ramMb: 8192, diskGb: 50 }).ok,
    false
  );
  assert.equal(
    assertCubeWithinSizeV2(l, { vcpus: 4, ramMb: 8193, diskGb: 50 }).ok,
    false
  );
  assert.equal(
    assertCubeWithinSizeV2(l, { vcpus: 4, ramMb: 8192, diskGb: 51 }).ok,
    false
  );
});

// ── assertCanCreateCubeV2 ────────────────────────────────────────────────────

test("assertCanCreateCubeV2: size check runs first, then the concurrent cap", () => {
  const l = limits({ maxConcurrentCubes: 2 });
  const size = { vcpus: 4, ramMb: 8192, diskGb: 50 };
  // over-size fails even with 0 active cubes
  assert.equal(assertCanCreateCubeV2(l, 0, { ...size, vcpus: 99 }).ok, false);
  // within size, under cap → ok
  assert.equal(assertCanCreateCubeV2(l, 1, size).ok, true);
  // within size, at cap → deny
  assert.equal(assertCanCreateCubeV2(l, 2, size).ok, false);
});

test("assertCanCreateCubeV2: null concurrent cap = unlimited", () => {
  const l = limits({ maxConcurrentCubes: null });
  assert.equal(
    assertCanCreateCubeV2(l, 9999, { vcpus: 4, ramMb: 8192, diskGb: 50 }).ok,
    true
  );
});

// ── assertCanWakeCubeV2 ──────────────────────────────────────────────────────

test("assertCanWakeCubeV2: blocks at the concurrent cap, unlimited when null", () => {
  assert.equal(
    assertCanWakeCubeV2(limits({ maxConcurrentCubes: 3 }), 2).ok,
    true
  );
  assert.equal(
    assertCanWakeCubeV2(limits({ maxConcurrentCubes: 3 }), 3).ok,
    false
  );
  assert.equal(
    assertCanWakeCubeV2(limits({ maxConcurrentCubes: null }), 1000).ok,
    true
  );
});

// ── assertCanInviteMemberV2 ──────────────────────────────────────────────────

test("assertCanInviteMemberV2: caps seats, unlimited when null", () => {
  assert.equal(assertCanInviteMemberV2(limits({ maxSeats: 5 }), 4).ok, true);
  assert.equal(assertCanInviteMemberV2(limits({ maxSeats: 5 }), 5).ok, false);
  assert.equal(
    assertCanInviteMemberV2(limits({ maxSeats: null }), 1000).ok,
    true
  );
});

// ── assertCanKeepBackupV2 ────────────────────────────────────────────────────

test("assertCanKeepBackupV2: 0 = not included (distinct message), >0 = cap, null = unlimited", () => {
  const zero = assertCanKeepBackupV2(limits({ maxBackups: 0 }), 0);
  assert.equal(zero.ok, false);
  if (!zero.ok) {
    assert.match(zero.error, /does not include/i);
  }

  const capped = assertCanKeepBackupV2(limits({ maxBackups: 2 }), 2);
  assert.equal(capped.ok, false);
  if (!capped.ok) {
    assert.match(capped.error, /at most 2/i);
  }

  assert.equal(assertCanKeepBackupV2(limits({ maxBackups: 2 }), 1).ok, true);
  assert.equal(
    assertCanKeepBackupV2(limits({ maxBackups: null }), 999).ok,
    true
  );
});

// ── assertCanAddDomainV2 ─────────────────────────────────────────────────────

test("assertCanAddDomainV2: 0 = not included, >0 = cap, null = unlimited", () => {
  const zero = assertCanAddDomainV2(limits({ maxDomains: 0 }), 0);
  assert.equal(zero.ok, false);
  if (!zero.ok) {
    assert.match(zero.error, /does not include/i);
  }

  assert.equal(assertCanAddDomainV2(limits({ maxDomains: 3 }), 3).ok, false);
  assert.equal(assertCanAddDomainV2(limits({ maxDomains: 3 }), 2).ok, true);
  assert.equal(
    assertCanAddDomainV2(limits({ maxDomains: null }), 999).ok,
    true
  );
});

// ── toClientLimits ───────────────────────────────────────────────────────────

test("toClientLimits: projects only the four client-safe size fields", () => {
  const c = toClientLimits(limits());
  assert.deepEqual(c, {
    planName: "TestPlan",
    maxVcpus: 4,
    maxRamMb: 8192,
    maxDiskGb: 50,
  });
});
