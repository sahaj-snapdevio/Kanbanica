import assert from "node:assert/strict";
import { test } from "node:test";
import { JAILER_CHROOT_BASE } from "@/config/platform";
import { buildJailerArgs, cubePaths, jailRoot } from "@/lib/ssh/jailer";

const CUBE = "abc123";

test("buildJailerArgs: uses cgroup-version 2 (never falls back to v1 on cgroup-v2-only hosts)", () => {
  const args = buildJailerArgs({ cubeId: CUBE, uid: 100_000, gid: 100_000 });
  const i = args.indexOf("--cgroup-version");
  assert.ok(i >= 0, "must pass --cgroup-version");
  assert.equal(args[i + 1], "2");
});

test("buildJailerArgs: WITHOUT a cgroup opt emits NO --cgroup/--parent-cgroup (flag-off = byte-identical legacy)", () => {
  const args = buildJailerArgs({ cubeId: CUBE, uid: 100_000, gid: 100_000 });
  // exact-element check: '--cgroup-version' must not be mistaken for '--cgroup'
  assert.equal(args.includes("--cgroup"), false);
  assert.equal(args.includes("--parent-cgroup"), false);
});

test("buildJailerArgs: WITH a cgroup opt emits --parent-cgroup krova + cpu.weight in a leaf (L1)", () => {
  const args = buildJailerArgs({
    cubeId: CUBE,
    uid: 100_000,
    gid: 100_000,
    cgroup: { cpuWeight: 800 },
  });
  const pi = args.indexOf("--parent-cgroup");
  assert.ok(
    pi >= 0 && args[pi + 1] === "krova",
    "expected --parent-cgroup krova"
  );
  assert.ok(
    args.includes("cpu.weight=800"),
    "expected --cgroup cpu.weight=800"
  );
  // cgroup args must follow --cgroup-version 2 and precede the -- exec separator
  assert.ok(args.indexOf("--cgroup-version") < args.indexOf("--cgroup"));
  assert.ok(args.indexOf("--cgroup") < args.indexOf("--"));
});

test("buildJailerArgs: WITH cpuset emits cpuset.cpus + cpuset.mems alongside cpu.weight (L2)", () => {
  const args = buildJailerArgs({
    cubeId: CUBE,
    uid: 100_000,
    gid: 100_000,
    cgroup: { cpuWeight: 200, cpuset: { cpus: "2-17,36-53", mems: "0" } },
  });
  assert.ok(args.includes("cpu.weight=200"), "keeps cpu.weight");
  assert.ok(args.includes("cpuset.cpus=2-17,36-53"), "binds cpuset.cpus");
  assert.ok(args.includes("cpuset.mems=0"), "binds cpuset.mems to the node");
  // all cgroup args precede the -- exec separator
  const sep = args.indexOf("--");
  assert.ok(args.indexOf("cpuset.mems=0") < sep);
});

test("buildJailerArgs: cpu.weight WITHOUT cpuset emits NO cpuset args (single-socket / flag-off-NUMA)", () => {
  const args = buildJailerArgs({
    cubeId: CUBE,
    uid: 100_000,
    gid: 100_000,
    cgroup: { cpuWeight: 200 },
  });
  assert.equal(
    args.some((a) => a.startsWith("cpuset.")),
    false
  );
});

test("buildJailerArgs: isolates via new PID namespace, NOT a network namespace", () => {
  const args = buildJailerArgs({ cubeId: CUBE, uid: 100_000, gid: 100_000 });
  assert.ok(args.includes("--new-pid-ns"), "must create a new PID namespace");
  // TAP/br0/NAT live in the host net ns — a --netns would break networking
  assert.equal(args.includes("--netns"), false);
  assert.equal(args.includes("--network-namespace"), false);
});

test("buildJailerArgs: drops to the per-cube uid/gid and tags the jail by cube id", () => {
  const args = buildJailerArgs({ cubeId: CUBE, uid: 100_007, gid: 100_007 });
  assert.equal(args[args.indexOf("--uid") + 1], "100007");
  assert.equal(args[args.indexOf("--gid") + 1], "100007");
  assert.equal(args[args.indexOf("--id") + 1], CUBE);
  assert.equal(args[args.indexOf("--chroot-base-dir") + 1], JAILER_CHROOT_BASE);
});

test("buildJailerArgs: forwards chroot-relative FC args after the -- separator", () => {
  const args = buildJailerArgs({ cubeId: CUBE, uid: 100_000, gid: 100_000 });
  const sep = args.indexOf("--");
  assert.ok(sep >= 0, "must have a -- separator");
  const fwd = args.slice(sep + 1);
  // these are interpreted RELATIVE TO THE CHROOT by Firecracker
  assert.equal(fwd[fwd.indexOf("--api-sock") + 1], "/run/firecracker.socket");
  assert.equal(fwd[fwd.indexOf("--log-path") + 1], "/fc.log");
});

test("cubePaths(jailed): all four host paths live under the chroot root", () => {
  const root = jailRoot(CUBE);
  const p = cubePaths(CUBE, "jailed");
  assert.equal(p.apiSock, `${root}/run/firecracker.socket`);
  assert.equal(p.vsockPath, `${root}/vsock.sock`);
  assert.equal(p.fcLog, `${root}/fc.log`);
  assert.equal(p.pidFile, `${root}/firecracker.pid`);
});

test("cubePaths(bare): returns the exact legacy /var/lib/krova/cubes paths", () => {
  const p = cubePaths(CUBE, "bare");
  const d = `/var/lib/krova/cubes/${CUBE}`;
  assert.equal(p.apiSock, `${d}/firecracker.sock`);
  assert.equal(p.vsockPath, `${d}/vsock.sock`);
  assert.equal(p.fcLog, `${d}/fc.log`);
  assert.equal(p.pidFile, `${d}/firecracker.pid`);
});

test("jailRoot: matches the documented chroot layout", () => {
  assert.equal(
    jailRoot(CUBE),
    `${JAILER_CHROOT_BASE}/firecracker/${CUBE}/root`
  );
});
