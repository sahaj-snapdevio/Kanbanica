import assert from "node:assert/strict";
import { test } from "node:test";
import { DISK_IO_STORAGE_TUNING_ENABLED } from "@/config/platform";
import { ioNicePrefix } from "@/lib/io-nice";

test("ioNicePrefix: tracks DISK_IO_STORAGE_TUNING_ENABLED + has the exact shape", () => {
  const p = ioNicePrefix();
  if (DISK_IO_STORAGE_TUNING_ENABLED) {
    // exact string — a command appended to it (e.g. `${ioNicePrefix()}e2fsck …`)
    // must place the command DIRECTLY after `nice -n10 ` (trailing space), with no
    // env assignment between (the 2026-06-06 ordering rule).
    assert.equal(p, "ionice -c2 -n7 nice -n10 ");
    assert.ok(
      p.endsWith("nice -n10 "),
      "trailing space so the command follows"
    );
  } else {
    assert.equal(p, "", "flag off → empty prefix (byte-identical)");
  }
});

test("ioNicePrefix: when present, ionice precedes nice precedes the wrapped command", () => {
  const p = ioNicePrefix();
  if (!p) {
    return; // flag off — nothing to order
  }
  const cmd = `${p}e2fsck -fy /var/lib/krova/cubes/x/rootfs.ext4`;
  assert.ok(cmd.indexOf("ionice") < cmd.indexOf("nice -n10"));
  assert.ok(cmd.indexOf("nice -n10") < cmd.indexOf("e2fsck"));
  assert.match(cmd, /nice -n10 e2fsck /); // command directly after the prefix
});
