import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldScheduleAutoSnapshot } from "@/lib/worker/handlers/snapshot-scheduler";

// Pure cadence-gate decision for auto-snapshots. Drives the hourly
// snapshot.scheduler cron; no DB.

const PLAN = { autoSnapshotCadenceHours: 6 };
const NOW = new Date("2026-05-31T12:00:00.000Z");

function hoursAgo(h: number): Date {
  return new Date(NOW.getTime() - h * 3600 * 1000);
}

test("plan with no cadence (e.g. Trial) → never scheduled", () => {
  assert.equal(
    shouldScheduleAutoSnapshot(
      {
        status: "running",
        lastAutoSnapshotAt: null,
        snapshottedSinceSleep: false,
      },
      { autoSnapshotCadenceHours: null },
      NOW
    ),
    false
  );
});

test("non running/sleeping statuses are never scheduled", () => {
  for (const status of ["error", "booting", "pending", "stopping", "deleted"]) {
    assert.equal(
      shouldScheduleAutoSnapshot(
        { status, lastAutoSnapshotAt: null, snapshottedSinceSleep: false },
        PLAN,
        NOW
      ),
      false,
      `${status} must not schedule`
    );
  }
});

test("running: due when never snapshotted, or cadence elapsed; not before", () => {
  assert.equal(
    shouldScheduleAutoSnapshot(
      {
        status: "running",
        lastAutoSnapshotAt: null,
        snapshottedSinceSleep: true,
      },
      PLAN,
      NOW
    ),
    true,
    "never snapshotted → due"
  );
  assert.equal(
    shouldScheduleAutoSnapshot(
      {
        status: "running",
        lastAutoSnapshotAt: hoursAgo(3),
        snapshottedSinceSleep: true,
      },
      PLAN,
      NOW
    ),
    false,
    "3h < 6h cadence → not due"
  );
  assert.equal(
    shouldScheduleAutoSnapshot(
      {
        status: "running",
        lastAutoSnapshotAt: hoursAgo(6),
        snapshottedSinceSleep: true,
      },
      PLAN,
      NOW
    ),
    true,
    "exactly cadence → due (>=)"
  );
  assert.equal(
    shouldScheduleAutoSnapshot(
      {
        status: "running",
        lastAutoSnapshotAt: hoursAgo(9),
        snapshottedSinceSleep: true,
      },
      PLAN,
      NOW
    ),
    true,
    "past cadence → due"
  );
});

test("sleeping: one snapshot per sleep cycle (gated on snapshottedSinceSleep)", () => {
  assert.equal(
    shouldScheduleAutoSnapshot(
      {
        status: "sleeping",
        lastAutoSnapshotAt: hoursAgo(100),
        snapshottedSinceSleep: false,
      },
      PLAN,
      NOW
    ),
    true,
    "not yet snapshotted since entering sleep → due once"
  );
  assert.equal(
    shouldScheduleAutoSnapshot(
      {
        status: "sleeping",
        lastAutoSnapshotAt: hoursAgo(100),
        snapshottedSinceSleep: true,
      },
      PLAN,
      NOW
    ),
    false,
    "already snapshotted this sleep cycle → skip (rootfs unchanged)"
  );
});
