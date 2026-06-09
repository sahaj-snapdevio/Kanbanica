import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifySnapshotForHeal,
  snapshotCreateFailureAction,
} from "@/lib/snapshots/failure-policy";

test("create failure: auto deletes the row, manual keeps a dismissible note", () => {
  assert.equal(snapshotCreateFailureAction("auto"), "delete");
  assert.equal(snapshotCreateFailureAction("manual"), "mark-failed");
});

test("heal: a complete row is left alone", () => {
  assert.equal(
    classifySnapshotForHeal({
      status: "complete",
      kind: "manual",
      storagePath: "abc",
    }),
    "leave"
  );
});

test("heal: failed/restoring WITH data → heal back to complete (intact, wrongly marked)", () => {
  assert.equal(
    classifySnapshotForHeal({
      status: "failed",
      kind: "manual",
      storagePath: "abc",
    }),
    "heal-to-complete"
  );
  assert.equal(
    classifySnapshotForHeal({
      status: "restoring",
      kind: "auto",
      storagePath: "abc",
    }),
    "heal-to-complete"
  );
});

test("heal: auto failed/restoring WITHOUT data → delete (auto noise, no artifact)", () => {
  assert.equal(
    classifySnapshotForHeal({
      status: "failed",
      kind: "auto",
      storagePath: null,
    }),
    "delete"
  );
});

test("heal: manual failed WITHOUT data → leave as the dismissible note", () => {
  assert.equal(
    classifySnapshotForHeal({
      status: "failed",
      kind: "manual",
      storagePath: null,
    }),
    "leave"
  );
});

test("heal: pending/creating are left alone (not stuck)", () => {
  assert.equal(
    classifySnapshotForHeal({
      status: "pending",
      kind: "manual",
      storagePath: null,
    }),
    "leave"
  );
  assert.equal(
    classifySnapshotForHeal({
      status: "creating",
      kind: "auto",
      storagePath: null,
    }),
    "leave"
  );
});
