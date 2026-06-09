import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CreditRateTier,
  calculateHourlyCost,
  calculateSleepHourlyCost,
  getTierMultiplier,
} from "@/lib/cost-shared";

// Deterministic rates for the tests — NOT imported from config so a future
// rate change can't silently move these expected values.
const RATES = { vcpuRate: 0.001, ramRate: 0.0025, diskRate: 0.000_05 };

const TIERS: CreditRateTier[] = [
  {
    id: "t1",
    label: "Standard",
    minVcpus: 1,
    maxVcpus: 2,
    multiplier: 1.0,
    sortOrder: 0,
  },
  {
    id: "t2",
    label: "Plus",
    minVcpus: 3,
    maxVcpus: 4,
    multiplier: 0.95,
    sortOrder: 1,
  },
  {
    id: "t3",
    label: "Pro",
    minVcpus: 5,
    maxVcpus: 8,
    multiplier: 0.85,
    sortOrder: 2,
  },
  {
    id: "t4",
    label: "Ent",
    minVcpus: 9,
    maxVcpus: null,
    multiplier: 0.8,
    sortOrder: 3,
  },
];

// ── getTierMultiplier ────────────────────────────────────────────────────────

test("getTierMultiplier: no tiers configured → 1.0", () => {
  assert.equal(getTierMultiplier(8, []), 1.0);
});

test("getTierMultiplier: picks the matching tier (inclusive bounds)", () => {
  assert.equal(getTierMultiplier(1, TIERS), 1.0);
  assert.equal(getTierMultiplier(2, TIERS), 1.0); // upper bound inclusive
  assert.equal(getTierMultiplier(3, TIERS), 0.95); // lower bound inclusive
  assert.equal(getTierMultiplier(8, TIERS), 0.85);
});

test("getTierMultiplier: maxVcpus null = unlimited top tier", () => {
  assert.equal(getTierMultiplier(9, TIERS), 0.8);
  assert.equal(getTierMultiplier(64, TIERS), 0.8);
});

test("getTierMultiplier: a count below every tier's min → 1.0 fallback", () => {
  const gapped: CreditRateTier[] = [
    {
      id: "g",
      label: "G",
      minVcpus: 4,
      maxVcpus: 8,
      multiplier: 0.5,
      sortOrder: 0,
    },
  ];
  assert.equal(getTierMultiplier(1, gapped), 1.0);
});

// ── calculateHourlyCost ──────────────────────────────────────────────────────

test("calculateHourlyCost: exact value at multiplier 1.0", () => {
  // vcpu 2*0.001=0.002 ; ram (2048/1024)*0.0025=0.005 ; disk 20*0.00005=0.001
  const c = calculateHourlyCost(
    { vcpus: 2, ramMb: 2048, diskLimitGb: 20 },
    RATES,
    1.0
  );
  assert.equal(c, 0.008);
});

test("calculateHourlyCost: multiplier defaults to 1.0 when omitted", () => {
  const explicit = calculateHourlyCost(
    { vcpus: 4, ramMb: 4096, diskLimitGb: 40 },
    RATES,
    1.0
  );
  const implicit = calculateHourlyCost(
    { vcpus: 4, ramMb: 4096, diskLimitGb: 40 },
    RATES
  );
  assert.equal(implicit, explicit);
});

test("calculateHourlyCost: a discount multiplier never increases the cost", () => {
  const full = calculateHourlyCost(
    { vcpus: 8, ramMb: 8192, diskLimitGb: 50 },
    RATES,
    1.0
  );
  const disc = calculateHourlyCost(
    { vcpus: 8, ramMb: 8192, diskLimitGb: 50 },
    RATES,
    0.85
  );
  assert.ok(disc < full, "discounted cost must be lower");
  assert.ok(disc > 0);
});

test("calculateHourlyCost: zero resources cost nothing", () => {
  assert.equal(
    calculateHourlyCost({ vcpus: 0, ramMb: 0, diskLimitGb: 0 }, RATES),
    0
  );
});

// ── calculateSleepHourlyCost ────────────────────────────────────────────────

test("calculateSleepHourlyCost: bills disk only (no vcpu/ram term)", () => {
  // 20 GB * 0.00005 = 0.001
  assert.equal(
    calculateSleepHourlyCost({ diskLimitGb: 20 }, RATES, 1.0),
    0.001
  );
});

test("calculateSleepHourlyCost: equals the running-cost DISK component", () => {
  const disk = 50;
  const sleep = calculateSleepHourlyCost({ diskLimitGb: disk }, RATES, 1.0);
  const runDiskOnly = calculateHourlyCost(
    { vcpus: 0, ramMb: 0, diskLimitGb: disk },
    RATES,
    1.0
  );
  assert.equal(sleep, runDiskOnly);
});

test("calculateSleepHourlyCost: DISK_RATE 0 disables sleep storage", () => {
  assert.equal(
    calculateSleepHourlyCost({ diskLimitGb: 100 }, { diskRate: 0 }, 1.0),
    0
  );
});

test("calculateSleepHourlyCost: applies the tier multiplier", () => {
  const full = calculateSleepHourlyCost({ diskLimitGb: 100 }, RATES, 1.0);
  const disc = calculateSleepHourlyCost({ diskLimitGb: 100 }, RATES, 0.8);
  assert.ok(disc < full && disc > 0);
});
