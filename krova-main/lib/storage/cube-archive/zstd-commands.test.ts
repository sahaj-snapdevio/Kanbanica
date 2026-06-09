import assert from "node:assert/strict";
import { test } from "node:test";
import {
  zstdCompressCommand,
  zstdDecompressCommand,
} from "@/lib/storage/cube-archive/zstd-commands";

const PREFIX = "ionice -c2 -n7 nice -n10 ";

test("zstdCompressCommand: zstd follows the nice prefix DIRECTLY (no VAR=val between)", () => {
  const cmd = zstdCompressCommand({
    ionicePrefix: PREFIX,
    rootfsPath: "/var/lib/krova/cubes/x/rootfs.ext4",
    compressedPath: "/var/lib/krova/x.cube.zst",
    level: 3,
    threads: 2,
  });
  // the structural guard: `nice -n10` immediately precedes `zstd` (this is what
  // made restic break — a VAR=val between nice and the command).
  assert.match(cmd, /nice -n10 zstd -3 -T2 -f /);
  assert.ok(cmd.includes("rootfs.ext4") && cmd.includes("x.cube.zst"));
  assert.ok(
    cmd.indexOf("zstd") < cmd.indexOf("rootfs.ext4"),
    "zstd before the source path"
  );
});

test("zstdCompressCommand: flag-off (no prefix) → plain zstd, paths shell-escaped", () => {
  const cmd = zstdCompressCommand({
    ionicePrefix: "",
    rootfsPath: "/has a space/r",
    compressedPath: "/o",
    level: 1,
    threads: 0,
  });
  assert.match(cmd, /^zstd -1 -T0 -f /);
  assert.doesNotMatch(cmd, /ionice|nice -n/);
  // shellEscape must quote the space so the path isn't split into two args.
  assert.doesNotMatch(cmd, /-f \/has a space/);
});

test("zstdDecompressCommand: -d, zstd after the prefix, escaped paths", () => {
  const cmd = zstdDecompressCommand({
    ionicePrefix: PREFIX,
    compressedPath: "/c.cube.zst",
    rootfsPath: "/var/lib/krova/cubes/x/rootfs.ext4",
  });
  assert.match(cmd, /nice -n10 zstd -d -f /);
  assert.ok(cmd.indexOf("zstd -d") < cmd.indexOf("c.cube.zst"));
  assert.ok(cmd.includes("rootfs.ext4"));
});

test("zstdDecompressCommand: flag-off byte-identical to plain zstd -d", () => {
  const cmd = zstdDecompressCommand({
    ionicePrefix: "",
    compressedPath: "/c",
    rootfsPath: "/r",
  });
  assert.match(cmd, /^zstd -d -f /);
  assert.doesNotMatch(cmd, /ionice|nice/);
});
