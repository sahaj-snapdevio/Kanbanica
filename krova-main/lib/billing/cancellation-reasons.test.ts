import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANCELLATION_REASON_LABELS,
  CANCELLATION_REASON_OPTIONS,
  CANCELLATION_REASON_VALUES,
  type CancellationReason,
} from "@/lib/billing/cancellation-reasons";

// These values must match Polar's documented `customer_cancellation_reason`
// enum EXACTLY — Polar dashboard churn analytics + the
// subscriptions.list({customer_cancellation_reason}) filter key on them.
// https://polar.sh/docs/api-reference/subscriptions/update
const POLAR_ENUM = [
  "too_expensive",
  "missing_features",
  "switched_service",
  "unused",
  "customer_service",
  "low_quality",
  "too_complex",
  "other",
];

test("values match Polar's documented enum exactly", () => {
  assert.deepEqual(
    [...CANCELLATION_REASON_VALUES].sort(),
    [...POLAR_ENUM].sort()
  );
});

test("values are unique", () => {
  assert.equal(
    new Set(CANCELLATION_REASON_VALUES).size,
    CANCELLATION_REASON_VALUES.length
  );
});

test("every value has a non-empty label", () => {
  for (const v of CANCELLATION_REASON_VALUES) {
    const label = CANCELLATION_REASON_LABELS[v as CancellationReason];
    assert.ok(label && label.length > 0, `missing label for ${v}`);
  }
});

test("OPTIONS mirror VALUES 1:1 in order, with labels", () => {
  assert.equal(
    CANCELLATION_REASON_OPTIONS.length,
    CANCELLATION_REASON_VALUES.length
  );
  CANCELLATION_REASON_OPTIONS.forEach((opt, i) => {
    assert.equal(opt.value, CANCELLATION_REASON_VALUES[i]);
    assert.equal(opt.label, CANCELLATION_REASON_LABELS[opt.value]);
  });
});
