import assert from "node:assert/strict";
import { test } from "node:test";
import { DISK_IO_STORAGE_TUNING_ENABLED } from "@/config/platform";
import { assembleRcloneCopyto, rcloneFlags } from "@/lib/storage/s3-transfer";

const ENV =
  "RCLONE_CONFIG_BOX_TYPE=s3 RCLONE_CONFIG_BOX_ACCESS_KEY_ID=k RCLONE_CONFIG_BOX_SECRET_ACCESS_KEY=s";

test("assembleRcloneCopyto: env LEADS, then `rclone copyto SRC DST`, then flags", () => {
  const cmd = assembleRcloneCopyto(ENV, "/local/file", "box:bucket/key");
  // env MUST lead so the shell exports the RCLONE_CONFIG_BOX_* assignments
  // (same env-ordering rule the restic incident proved load-bearing).
  assert.ok(cmd.startsWith("RCLONE_CONFIG_BOX_TYPE="), "env leads the command");
  assert.ok(
    cmd.indexOf("RCLONE_CONFIG_BOX_") < cmd.indexOf("rclone"),
    "env before rclone"
  );
  assert.match(cmd, /rclone copyto /);
  // positionals before the flags (rclone intersperses — verified live on 1.74.2)
  assert.ok(
    cmd.indexOf("rclone copyto") < cmd.indexOf("--multi-thread-streams"),
    "copyto + positionals before flags"
  );
  // both endpoints present + shell-escaped
  assert.ok(cmd.includes("/local/file") && cmd.includes("box:bucket/key"));
});

test("rcloneFlags: emits the documented rclone 1.74.2 flags, capped when tuning is ON", () => {
  const f = rcloneFlags();
  assert.match(f, /--multi-thread-streams \d/);
  assert.match(f, /--s3-upload-concurrency \d/);
  assert.match(f, /--s3-chunk-size 64M/);
  assert.match(f, /--retries 2/);
  if (DISK_IO_STORAGE_TUNING_ENABLED) {
    // serialized to ONE stream / one s3 thread under tuning
    assert.match(f, /--multi-thread-streams 1\b/);
    assert.match(f, /--s3-upload-concurrency 1\b/);
  } else {
    assert.match(f, /--multi-thread-streams 4\b/);
    assert.match(f, /--s3-upload-concurrency 4\b/);
  }
});
