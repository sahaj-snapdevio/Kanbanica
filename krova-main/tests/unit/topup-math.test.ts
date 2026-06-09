import assert from "node:assert/strict";
import { test } from "node:test";
import { paymentBreakdown } from "@/components/billing/topup-math";

// The processing-fee gross-up (client-safe mirror of computeTopupCents). The
// shared formula is totalCents = ceil((baseCents + flatCents) / (1 - percent)).
// The cross-check that computeTopupCents (DB-backed) AGREES with this lives in
// tests/integration/topup-grossup.test.ts.

test("paymentBreakdown: non-positive / non-finite base → all zeros", () => {
  assert.deepEqual(paymentBreakdown(0, { percent: 0.029, flatUsd: 0.3 }), {
    baseUsd: 0,
    feeUsd: 0,
    totalUsd: 0,
  });
  assert.deepEqual(paymentBreakdown(-5, { percent: 0.029, flatUsd: 0.3 }), {
    baseUsd: 0,
    feeUsd: 0,
    totalUsd: 0,
  });
  assert.deepEqual(
    paymentBreakdown(Number.NaN, { percent: 0.029, flatUsd: 0.3 }),
    { baseUsd: 0, feeUsd: 0, totalUsd: 0 }
  );
});

test("paymentBreakdown: zero fee → customer pays exactly base", () => {
  assert.deepEqual(paymentBreakdown(50, { percent: 0, flatUsd: 0 }), {
    baseUsd: 50,
    feeUsd: 0,
    totalUsd: 50,
  });
});

test("paymentBreakdown: percent-only gross-up (2.9% on $100)", () => {
  // ceil(10000 / 0.971) = ceil(10298.66) = 10299
  assert.deepEqual(paymentBreakdown(100, { percent: 0.029, flatUsd: 0 }), {
    baseUsd: 100,
    feeUsd: 2.99,
    totalUsd: 102.99,
  });
});

test("paymentBreakdown: flat-only gross-up ($0.30 on $100)", () => {
  // ceil(10030 / 1) = 10030
  assert.deepEqual(paymentBreakdown(100, { percent: 0, flatUsd: 0.3 }), {
    baseUsd: 100,
    feeUsd: 0.3,
    totalUsd: 100.3,
  });
});

test("paymentBreakdown: combined percent + flat (2.9% + $0.30 on $100)", () => {
  // ceil((10000 + 30) / 0.971) = ceil(10329.55) = 10330
  assert.deepEqual(paymentBreakdown(100, { percent: 0.029, flatUsd: 0.3 }), {
    baseUsd: 100,
    feeUsd: 3.3,
    totalUsd: 103.3,
  });
});

test("paymentBreakdown: the space always receives the full base as credit", () => {
  // Invariant: feeUsd = totalUsd - baseUsd, and the platform breaks even on
  // the processor fee (customer pays total, space gets base).
  for (const base of [5, 25, 100, 999]) {
    const b = paymentBreakdown(base, { percent: 0.035, flatUsd: 0.5 });
    assert.equal(b.baseUsd, base);
    assert.ok(Math.abs(b.feeUsd - (b.totalUsd - b.baseUsd)) < 1e-9);
    assert.ok(b.totalUsd >= b.baseUsd);
  }
});
