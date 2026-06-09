/**
 * Executable assertions for the pure jailer helpers. Krova has no unit-test
 * runner, so this `tsx` script IS the verification for the path resolver, the
 * jailer arg builder, and the uid math. Run: `pnpm tsx scripts/jailer-pure-checks.ts`
 *
 * Imports only pure modules (config constants + drizzle schema definitions +
 * pure functions) — no DB connection is opened, so it runs without env.
 */

import assert from "node:assert/strict";
import { lowestFreeUid } from "@/lib/server/jailer-uids";
import { buildJailerArgs, cubePaths, jailRoot } from "@/lib/ssh/jailer";

// ── chroot root ──────────────────────────────────────────────────────────
assert.equal(jailRoot("abc"), "/var/lib/krova/jail/firecracker/abc/root");

// ── bare paths (legacy, unchanged) ─────────────────────────────────────────
const bare = cubePaths("abc", "bare");
assert.equal(bare.apiSock, "/var/lib/krova/cubes/abc/firecracker.sock");
assert.equal(bare.pidFile, "/var/lib/krova/cubes/abc/firecracker.pid");
assert.equal(bare.vsockPath, "/var/lib/krova/cubes/abc/vsock.sock");
assert.equal(bare.fcLog, "/var/lib/krova/cubes/abc/fc.log");

// ── jailed paths (CONFIRMED on canary banana 2026-05-29) ───────────────────
const jailed = cubePaths("abc", "jailed");
assert.equal(
  jailed.apiSock,
  "/var/lib/krova/jail/firecracker/abc/root/run/firecracker.socket"
);
assert.equal(
  jailed.pidFile,
  "/var/lib/krova/jail/firecracker/abc/root/firecracker.pid"
);
assert.equal(
  jailed.vsockPath,
  "/var/lib/krova/jail/firecracker/abc/root/vsock.sock"
);
assert.equal(jailed.fcLog, "/var/lib/krova/jail/firecracker/abc/root/fc.log");

// ── jailer argv (exact shape that booted the API on the canary) ────────────
const args = buildJailerArgs({ cubeId: "abc", uid: 100_000, gid: 108 });
assert.deepEqual(args.slice(0, 4), [
  "--id",
  "abc",
  "--exec-file",
  "/usr/local/bin/firecracker",
]);
assert.ok(args.includes("--new-pid-ns"));
assert.equal(args[args.indexOf("--cgroup-version") + 1], "2");
const dd = args.indexOf("--");
assert.ok(dd > 0);
assert.equal(
  args.slice(dd).join(" "),
  "-- --api-sock /run/firecracker.socket --log-path /fc.log --level Info"
);

// ── uid math ───────────────────────────────────────────────────────────────
assert.equal(lowestFreeUid(100_000, []), 100_000);
assert.equal(lowestFreeUid(100_000, [100_001]), 100_000);
assert.equal(lowestFreeUid(100_000, [100_000, 100_001]), 100_002);
assert.equal(lowestFreeUid(100_000, [100_000, 100_002]), 100_001);

console.log("OK — jailer pure checks passed");
