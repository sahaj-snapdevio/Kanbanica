import assert from "node:assert/strict";
import { test } from "node:test";
import { billingEventType } from "@/db/schema/billing";
import {
  BILLING_DEBIT_TYPES,
  billingEventKind,
  isBillingDebit,
} from "@/lib/billing-events";

const DEBITS = [
  "hourly_charge",
  "prorated_charge",
  "backup_storage_charge",
  "sleep_storage_charge",
  "overage_charge",
] as const;

const CREDITS = [
  "credit_grant",
  "credit_topup",
  "credit_refund",
  "plan_credit",
] as const;

test("every known charge type classifies as a debit", () => {
  for (const t of DEBITS) {
    assert.equal(isBillingDebit(t), true, `${t} must be a debit`);
    assert.equal(billingEventKind(t), "debit");
  }
});

test("every money-in type classifies as a credit", () => {
  for (const t of CREDITS) {
    assert.equal(isBillingDebit(t), false, `${t} must be a credit`);
    assert.equal(billingEventKind(t), "credit");
  }
});

test("Rule 54 regression: sleep_storage_charge + overage_charge are DEBITS, not credits", () => {
  // The original bug painted these green/+ (incoming money). They are auto-debits.
  assert.equal(billingEventKind("sleep_storage_charge"), "debit");
  assert.equal(billingEventKind("overage_charge"), "debit");
});

test("the debit/credit split exactly partitions the pgEnum (no value unclassified or duplicated)", () => {
  const all = billingEventType.enumValues;
  // every enum value is exactly one of debit/credit
  const debitsFromEnum = all.filter((t) => isBillingDebit(t));
  const creditsFromEnum = all.filter((t) => !isBillingDebit(t));
  assert.equal(debitsFromEnum.length + creditsFromEnum.length, all.length);
  // the declared lists match the live enum (catches an enum addition that
  // forgot to update billing-events.ts, or a typo in the Set)
  assert.deepEqual([...debitsFromEnum].sort(), [...DEBITS].sort());
  assert.deepEqual([...creditsFromEnum].sort(), [...CREDITS].sort());
});

test("BILLING_DEBIT_TYPES contains only valid enum values (no typos)", () => {
  const all = new Set<string>(billingEventType.enumValues);
  for (const t of BILLING_DEBIT_TYPES) {
    assert.ok(
      all.has(t),
      `${t} in the debit set is not a real billing_event_type`
    );
  }
});

test("unknown types default to credit (never silently a debit)", () => {
  assert.equal(billingEventKind("totally_made_up"), "credit");
  assert.equal(isBillingDebit("totally_made_up"), false);
});
