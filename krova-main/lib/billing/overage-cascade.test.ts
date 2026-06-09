import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CascadeInput,
  computeOverageCascade,
  prepaidChargeSplit,
} from "@/lib/billing/overage-cascade";

const sum = (xs: number[]) =>
  Math.round(xs.reduce((a, b) => a + b, 0) * 10_000) / 10_000;

// Base space: overage fully enabled with an active sub and a $10 cap, $0 used.
function space(
  overrides: Partial<CascadeInput["space"]> = {}
): CascadeInput["space"] {
  return {
    id: "sp_1",
    creditBalance: "0.0000",
    allowOverage: true,
    overageEnabled: true,
    overageCapUsd: "10.0000",
    thisPeriodOverageUsd: "0.0000",
    subscriptionStatus: "active",
    ...overrides,
  };
}

test("prepaid covers the whole tick → no overage, no refusal", () => {
  const r = computeOverageCascade({
    space: space({ creditBalance: "5.0000" }),
    totalCost: 2,
  });
  assert.equal(r.fromPrepaid, 2);
  assert.equal(r.fromOverage, 0);
  assert.equal(r.refused, 0);
  assert.equal(r.newCreditBalance, "3.0000");
  assert.equal(r.newThisPeriodOverageUsd, "0.0000");
});

test("prepaid partial + overage covers the remainder", () => {
  const r = computeOverageCascade({
    space: space({ creditBalance: "1.5000" }),
    totalCost: 4,
  });
  assert.equal(r.fromPrepaid, 1.5);
  assert.equal(r.fromOverage, 2.5);
  assert.equal(r.refused, 0);
  assert.equal(r.newCreditBalance, "0.0000");
  assert.equal(r.newThisPeriodOverageUsd, "2.5000");
});

test("no prepaid, overage funds the full tick", () => {
  const r = computeOverageCascade({ space: space(), totalCost: 3 });
  assert.equal(r.fromPrepaid, 0);
  assert.equal(r.fromOverage, 3);
  assert.equal(r.refused, 0);
});

test("overage disabled → remainder refused (auto-sleep)", () => {
  const r = computeOverageCascade({
    space: space({ creditBalance: "1.0000", overageEnabled: false }),
    totalCost: 3,
  });
  assert.equal(r.fromPrepaid, 1);
  assert.equal(r.fromOverage, 0);
  assert.equal(r.refused, 2);
});

test("allowOverage=false (plan forbids) → refused even if overageEnabled (defense in depth)", () => {
  const r = computeOverageCascade({
    space: space({ allowOverage: false }),
    totalCost: 5,
  });
  assert.equal(r.fromOverage, 0);
  assert.equal(r.refused, 5);
});

test("non-active subscription → no overage accrual", () => {
  for (const status of ["past_due", "unpaid", "canceled", null]) {
    const r = computeOverageCascade({
      space: space({ subscriptionStatus: status }),
      totalCost: 2,
    });
    assert.equal(r.fromOverage, 0, `status=${status} must not accrue overage`);
    assert.equal(r.refused, 2);
  }
});

test("overage cap already reached → capRemaining 0 → refused", () => {
  const r = computeOverageCascade({
    space: space({ overageCapUsd: "10.0000", thisPeriodOverageUsd: "10.0000" }),
    totalCost: 2,
  });
  assert.equal(r.fromOverage, 0);
  assert.equal(r.refused, 2);
});

test("overage cap partially used → funds only up to the cap, refuses the rest", () => {
  const r = computeOverageCascade({
    space: space({ overageCapUsd: "10.0000", thisPeriodOverageUsd: "9.0000" }),
    totalCost: 3,
  });
  assert.equal(r.fromOverage, 1); // only $1 of cap left
  assert.equal(r.refused, 2);
  assert.equal(r.newThisPeriodOverageUsd, "10.0000");
});

test("negative balance is clamped (no free top-up, no over-draw)", () => {
  const r = computeOverageCascade({
    space: space({ creditBalance: "-3.0000" }),
    totalCost: 2,
  });
  // fromPrepaid clamped to 0; balance must not become more positive than it was
  assert.equal(r.fromPrepaid, 0);
  assert.equal(r.newCreditBalance, "-3.0000");
  // the full $2 falls to overage (sub active, enabled), not silently absorbed
  assert.equal(r.fromOverage, 2);
  assert.equal(r.refused, 0);
});

test("balance exactly equals cost → fully prepaid, nothing refused", () => {
  const r = computeOverageCascade({
    space: space({ creditBalance: "2.0000" }),
    totalCost: 2,
  });
  assert.equal(r.fromPrepaid, 2);
  assert.equal(r.fromOverage, 0);
  assert.equal(r.refused, 0);
  assert.equal(r.newCreditBalance, "0.0000");
});

test("zero-cost tick is a no-op", () => {
  const r = computeOverageCascade({
    space: space({ creditBalance: "5.0000" }),
    totalCost: 0,
  });
  assert.equal(r.fromPrepaid, 0);
  assert.equal(r.fromOverage, 0);
  assert.equal(r.refused, 0);
  assert.equal(r.newCreditBalance, "5.0000");
});

// ── prepaidChargeSplit (ledger double-count fix) ─────────────────────────────

test("prepaidChargeSplit: no overage (prepaid covers all) → per-item costs unchanged", () => {
  const costs = [0.005, 0.003, 0.001];
  const r = prepaidChargeSplit(costs, 0.009, 0.009);
  assert.deepEqual(r, costs);
});

test("prepaidChargeSplit: fromPrepaid overshoot is still treated as full coverage", () => {
  const costs = [0.005, 0.003];
  assert.deepEqual(prepaidChargeSplit(costs, 1.0, 0.008), costs);
});

test("prepaidChargeSplit: partial overage scales items and the sum equals fromPrepaid", () => {
  // total 0.008, prepaid funds 0.004 (half), overage covers the other 0.004
  const r = prepaidChargeSplit([0.005, 0.003], 0.004, 0.008);
  assert.equal(sum(r), 0.004, "per-item rows must sum to fromPrepaid");
  assert.ok(r.every((x) => x >= 0));
});

test("prepaidChargeSplit: fully overage-funded (fromPrepaid 0) → all-zero rows", () => {
  const r = prepaidChargeSplit([0.005, 0.003], 0, 0.008);
  assert.equal(sum(r), 0);
  // caller drops $0 rows; the single overage_charge row carries the whole tick
});

test("prepaidChargeSplit: the ledger invariant holds (sum + fromOverage = fromPrepaid + fromOverage)", () => {
  const costs = [0.0123, 0.0077, 0.0301];
  const total = sum(costs); // 0.0501
  const cascade = computeOverageCascade({
    space: space({ creditBalance: "0.0200" }), // prepaid funds 0.02
    totalCost: total,
  });
  const rows = prepaidChargeSplit(costs, cascade.fromPrepaid, total);
  // sum(hourly rows) + overage_charge must equal fromPrepaid + fromOverage,
  // and must NOT include the refused amount
  assert.equal(sum(rows), cascade.fromPrepaid);
  assert.equal(
    sum([...rows, cascade.fromOverage]),
    Math.round((cascade.fromPrepaid + cascade.fromOverage) * 10_000) / 10_000
  );
});

test("prepaidChargeSplit: empty input → empty output", () => {
  assert.deepEqual(prepaidChargeSplit([], 0, 0), []);
});

test("prepaidChargeSplit: totalCost 0 → no division, rounded passthrough", () => {
  assert.deepEqual(prepaidChargeSplit([0, 0], 0, 0), [0, 0]);
});
