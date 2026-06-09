import assert from "node:assert/strict";
import { test } from "node:test";
import { QUEUE_OPTIONS } from "@/lib/worker/ensure-queues";
import { JOB_NAMES } from "@/lib/worker/job-types";

// Double-fire guard (2026-05-31 audit): every queue whose enqueue site passes a
// per-entity singletonKey to dedupe a double-click MUST be policy:"exclusive".
// On the default "standard" policy pg-boss treats singletonKey as a LABEL ONLY
// and does NOT dedupe — a second click silently enqueues a second job (the
// reported cold-restart bug: two kernel reboots + two prorated charges). This
// test fails the moment one of these queues loses its exclusive policy.
const MUST_BE_EXCLUSIVE = [
  // fixed in the double-fire audit
  JOB_NAMES.CUBE_COLD_RESTART,
  JOB_NAMES.CUBE_RESIZE,
  JOB_NAMES.CUBE_TRANSFER,
  JOB_NAMES.SERVER_UPDATE_IMAGES,
  // already correct before the audit — guard against regression
  JOB_NAMES.CUBE_AUTO_RELAUNCH,
  JOB_NAMES.CUBE_ERROR_RECOVERY,
  JOB_NAMES.CUBE_TRANSFER_CANCEL,
  JOB_NAMES.SERVER_UPDATE_CADDY,
  JOB_NAMES.SERVER_REFRESH_CADDY,
  JOB_NAMES.SERVER_REFRESH_HARDWARE,
] as const;

test("dedup-critical queues are policy:'exclusive' (singletonKey only dedupes there)", () => {
  for (const q of MUST_BE_EXCLUSIVE) {
    assert.equal(
      QUEUE_OPTIONS[q]?.policy,
      "exclusive",
      `${q} must be policy:"exclusive" — its enqueue site passes a singletonKey, which is a no-op on "standard" (double-fire risk)`
    );
  }
});

test("every job in JOB_NAMES has a QUEUE_OPTIONS entry (Rule 56)", () => {
  for (const name of Object.values(JOB_NAMES)) {
    assert.ok(
      QUEUE_OPTIONS[name] !== undefined,
      `${name} is missing a QUEUE_OPTIONS entry`
    );
  }
});
