import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getWebhookEventDefinition,
  groupedWebhookEvents,
  isValidWebhookEvent,
  WEBHOOK_EVENT_CATEGORIES,
  WEBHOOK_EVENT_VALUES,
  WEBHOOK_EVENTS,
} from "@/lib/webhook-events";

test("WEBHOOK_EVENT_VALUES: non-empty and all unique", () => {
  assert.ok(WEBHOOK_EVENT_VALUES.length > 0);
  assert.equal(
    new Set(WEBHOOK_EVENT_VALUES).size,
    WEBHOOK_EVENT_VALUES.length,
    "duplicate event value"
  );
});

test("WEBHOOK_EVENT_VALUES mirrors WEBHOOK_EVENTS exactly (no orphans either way)", () => {
  const fromDefs = WEBHOOK_EVENTS.map((e) => e.value).sort();
  const fromValues = [...WEBHOOK_EVENT_VALUES].sort();
  assert.deepEqual(fromValues, fromDefs);
});

test("every event has a non-empty label + description + a known category", () => {
  const cats = new Set(WEBHOOK_EVENT_CATEGORIES.map((c) => c.category));
  for (const e of WEBHOOK_EVENTS) {
    assert.ok(e.label.length > 0, `${e.value} missing label`);
    assert.ok(e.description.length > 0, `${e.value} missing description`);
    assert.ok(
      cats.has(e.category),
      `${e.value} has unknown category ${e.category}`
    );
  }
});

test("isValidWebhookEvent / getWebhookEventDefinition behave for known + unknown", () => {
  assert.equal(isValidWebhookEvent("cube.created"), true);
  assert.equal(isValidWebhookEvent("not.an.event"), false);
  assert.ok(getWebhookEventDefinition("cube.created"));
  assert.equal(getWebhookEventDefinition("not.an.event"), undefined);
});

test("groupedWebhookEvents: every event in exactly one group, no losses", () => {
  const grouped = groupedWebhookEvents();
  const seen = new Set<string>();
  let total = 0;
  for (const g of grouped) {
    for (const e of g.events) {
      assert.equal(
        e.category,
        g.category,
        `${e.value} grouped under wrong category`
      );
      assert.ok(!seen.has(e.value), `${e.value} appears in two groups`);
      seen.add(e.value);
      total++;
    }
  }
  assert.equal(
    total,
    WEBHOOK_EVENTS.length,
    "grouping lost or duplicated events"
  );
});

test("billing events are NOT exposed as webhooks (codebase invariant)", () => {
  // Billing telemetry is intentionally NOT delivered via webhooks — customers
  // query the billing endpoints. Guard against a future leak.
  const banned = [
    "hourly_charge",
    "prorated_charge",
    "top_up",
    "topup",
    "overage",
    "plan_credit",
    "low_balance",
    "sleep_storage",
    "backup_storage_charge",
    "credit_refund",
  ];
  for (const v of WEBHOOK_EVENT_VALUES) {
    for (const b of banned) {
      assert.ok(
        !v.includes(b),
        `webhook event "${v}" looks like a billing event (matched "${b}")`
      );
    }
  }
});
