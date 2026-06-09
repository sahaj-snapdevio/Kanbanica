import assert from "node:assert/strict";
import { test } from "node:test";
import { buildResticForgetArgs } from "@/lib/snapshots/forget-args";

const BUCKETS = {
  autoSnapshotKeepLast: 4,
  autoSnapshotKeepDaily: 7,
  autoSnapshotKeepWeekly: 1,
};

test("buildResticForgetArgs: scopes the policy to the auto snapshots via repeated --tag", () => {
  const args = buildResticForgetArgs(BUCKETS, ["auto1", "auto2"]);
  // shellEscape single-quotes every tag id (defensive — ids are CUID2 but the
  // escape is unconditional). One --tag per auto snapshot, then the policy.
  assert.equal(
    args,
    "--tag 'auto1' --tag 'auto2' --keep-last 4 --keep-daily 7 --keep-weekly 1"
  );
});

test("buildResticForgetArgs: never emits the non-existent --keep-id flag", () => {
  const args = buildResticForgetArgs(BUCKETS, ["auto1"]);
  assert.ok(args !== null);
  assert.ok(
    !args.includes("--keep-id"),
    "must not use the rustic-only --keep-id"
  );
});

test("buildResticForgetArgs: returns null when every retention bucket is 0", () => {
  const args = buildResticForgetArgs(
    {
      autoSnapshotKeepLast: 0,
      autoSnapshotKeepDaily: 0,
      autoSnapshotKeepWeekly: 0,
    },
    ["auto1", "auto2"]
  );
  assert.equal(args, null);
});

test("buildResticForgetArgs: returns null when there are no auto snapshots (SAFETY — never tag-less forget)", () => {
  // A tag-less `forget --keep-* --prune` would apply the policy to the whole
  // repo, including manual/pinned snapshots. The empty-autoTagIds guard MUST
  // short-circuit so a manual snapshot can never be forgotten.
  const args = buildResticForgetArgs(BUCKETS, []);
  assert.equal(args, null);
});

test("buildResticForgetArgs: omits zero buckets but keeps the tag scope", () => {
  const args = buildResticForgetArgs(
    {
      autoSnapshotKeepLast: 4,
      autoSnapshotKeepDaily: 0,
      autoSnapshotKeepWeekly: 0,
    },
    ["auto1"]
  );
  assert.equal(args, "--tag 'auto1' --keep-last 4");
});

test("buildResticForgetArgs: shell-escapes tag ids", () => {
  const args = buildResticForgetArgs(BUCKETS, ["a b"]);
  assert.ok(args !== null);
  // The id with a space must be quoted so it stays one --tag argument.
  assert.ok(args.includes("'a b'") || args.includes('"a b"'));
});
