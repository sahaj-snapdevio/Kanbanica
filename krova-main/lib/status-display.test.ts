import assert from "node:assert/strict";
import { test } from "node:test";
import {
  billingEventType,
  creditPurchaseStatus,
  cubeImportStatus,
  domainStatus,
  serverSetupPhase,
  serverStatus,
  snapshotStatus,
} from "@/db/schema";
import { CUBE_STATUS_VALUES } from "@/db/schema/types";
import {
  BILLING_EVENT_TYPE_CLASSES,
  CREDIT_PURCHASE_STATUS_OPTIONS,
  CUBE_STATUS_CONFIG,
  capitalizeStatus,
  cloudflareStatusVariant,
  creditPurchaseStatusVariant,
  cubeImportStatusVariant,
  domainStatusVariant,
  isActiveTransferState,
  SERVER_STATUS_CLASSES,
  SETUP_PHASE_CONFIG,
  snapshotStatusVariant,
  subscriptionStatusVariant,
} from "@/lib/status-display";

test("capitalizeStatus: capitalizes + underscores → spaces", () => {
  assert.equal(capitalizeStatus("running"), "Running");
  assert.equal(capitalizeStatus("past_due"), "Past due");
  assert.equal(capitalizeStatus("pending_validation"), "Pending validation");
});

test("isActiveTransferState: only in-flight transfer states are active", () => {
  for (const s of ["snapshotting", "restoring", "finalizing", "cancelling"]) {
    assert.equal(isActiveTransferState(s), true, `${s} should be active`);
  }
  for (const s of ["idle", "completed", "failed"]) {
    assert.equal(isActiveTransferState(s), false, `${s} should NOT be active`);
  }
  assert.equal(isActiveTransferState(null), false);
  assert.equal(isActiveTransferState(undefined), false);
  assert.equal(isActiveTransferState("bogus"), false);
});

// ── completeness: every enum value has a display mapping (Rule 44) ────────────

test("CUBE_STATUS_CONFIG covers every cube status value", () => {
  for (const v of CUBE_STATUS_VALUES) {
    const cfg = CUBE_STATUS_CONFIG[v];
    assert.ok(cfg, `missing config for cube status ${v}`);
    assert.ok(cfg.label.length > 0 && cfg.className.length > 0);
  }
});

test("snapshotStatusVariant maps every snapshot enum value", () => {
  for (const v of snapshotStatus.enumValues) {
    assert.ok(snapshotStatusVariant(v), `no variant for snapshot ${v}`);
  }
});

test("creditPurchaseStatusVariant maps every credit-purchase enum value", () => {
  for (const v of creditPurchaseStatus.enumValues) {
    assert.ok(creditPurchaseStatusVariant(v), `no variant for ${v}`);
  }
});

test("cubeImportStatusVariant maps every cube-import enum value", () => {
  for (const v of cubeImportStatus.enumValues) {
    assert.ok(cubeImportStatusVariant(v), `no variant for ${v}`);
  }
});

test("domainStatusVariant maps every domain enum value", () => {
  for (const v of domainStatus.enumValues) {
    assert.ok(domainStatusVariant(v), `no variant for ${v}`);
  }
});

test("SERVER_STATUS_CLASSES covers every server status value", () => {
  for (const v of serverStatus.enumValues) {
    assert.ok(SERVER_STATUS_CLASSES[v], `missing class for server ${v}`);
  }
});

test("SETUP_PHASE_CONFIG covers every setup phase value", () => {
  for (const v of serverSetupPhase.enumValues) {
    assert.ok(SETUP_PHASE_CONFIG[v]?.label, `missing config for phase ${v}`);
  }
});

test("BILLING_EVENT_TYPE_CLASSES covers every billing event type", () => {
  for (const v of billingEventType.enumValues) {
    assert.ok(BILLING_EVENT_TYPE_CLASSES[v], `missing class for ${v}`);
  }
});

// ── filter options include 'all' + every value ───────────────────────────────

test("filter options carry an 'all' sentinel + each enum value", () => {
  assert.equal(CREDIT_PURCHASE_STATUS_OPTIONS[0]?.value, "all");
  assert.equal(
    CREDIT_PURCHASE_STATUS_OPTIONS.length,
    creditPurchaseStatus.enumValues.length + 1
  );
});

// ── free-form (non-pgEnum) status mappers handle null + unknown ───────────────

test("subscriptionStatusVariant / cloudflareStatusVariant tolerate null + unknown", () => {
  assert.equal(subscriptionStatusVariant(null), "outline");
  assert.equal(subscriptionStatusVariant("active"), "default");
  assert.equal(subscriptionStatusVariant("past_due"), "destructive");
  assert.equal(subscriptionStatusVariant("unpaid"), "destructive");
  assert.ok(subscriptionStatusVariant("something-new"));

  assert.equal(cloudflareStatusVariant(null), "outline");
  assert.equal(cloudflareStatusVariant("active"), "default");
  assert.ok(cloudflareStatusVariant("blocked_failed"));
});
