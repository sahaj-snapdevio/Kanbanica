import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  cpuCgroupPrepScript,
  cpuCgroupReadyCommand,
  cpusetPreflightCommand,
  cpusetReadyCommand,
  cubeDiskDeviceCommand,
  ioCgroupReadyCommand,
} from "@/lib/ssh/cpu-cgroup";

const dir = mkdtempSync(join(tmpdir(), "krova-cgroup-"));
let seq = 0;
function validShell(cmd: string, label: string): void {
  const f = join(dir, `c${seq++}.sh`);
  writeFileSync(f, cmd);
  try {
    execFileSync("bash", ["-n", f], { stdio: "pipe" });
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    assert.fail(
      `bash -n rejected [${label}]: ${(err.stderr?.toString() ?? err.message ?? "").trim()}`
    );
  }
}

function decodePrep(cmd: string): string {
  const m = cmd.match(/echo '([A-Za-z0-9+/=]+)'/);
  assert.ok(m, "expected a single-quoted base64 payload");
  return Buffer.from(m[1], "base64").toString("utf-8");
}

test("cpuCgroupPrepScript (L1-only, numa off): preps krova + delegates cpu, NO cpuset", () => {
  // Pass numa explicitly so the assertion is independent of the live flag value.
  const cmd = cpuCgroupPrepScript({ numa: false });
  validShell(cmd, "wrapper");
  const decoded = decodePrep(cmd);
  validShell(decoded, "payload");
  assert.match(decoded, /\/sys\/fs\/cgroup\/krova/);
  assert.match(decoded, /\+cpu/);
  assert.match(decoded, /subtree_control/);
  assert.match(decoded, /krova-cgroup-prep\.service/);
  assert.match(decoded, /systemctl enable krova-cgroup-prep\.service/);
  // Flag-off prep is byte-identical to L1 — NO cpuset delegation.
  assert.doesNotMatch(decoded, /\+cpuset/);
  assert.doesNotMatch(decoded, /cpuset\.cpus/);
});

test("cpuCgroupPrepScript (L2 on, numa on): additionally delegates + seeds cpuset", () => {
  const cmd = cpuCgroupPrepScript({ numa: true });
  validShell(cmd, "wrapper");
  const decoded = decodePrep(cmd);
  validShell(decoded, "payload");
  // L1 lines still present.
  assert.match(decoded, /\+cpu\b/);
  assert.match(decoded, /krova-cgroup-prep\.service/);
  // L2 cpuset delegation + seed lines appear (root→krova→leaves).
  assert.match(decoded, /\+cpuset/);
  assert.match(decoded, /cpuset\.cpus\.effective/);
  assert.match(decoded, /cpuset\.mems\.effective/);
});

test("cpusetPreflightCommand: read-only, reports delegation + parent effective cpus/mems", () => {
  const c = cpusetPreflightCommand();
  validShell(c, "cpuset-preflight");
  assert.match(c, /DELEGATED/);
  assert.match(c, /cpuset\.cpus\.effective/);
  assert.match(c, /cpuset\.mems\.effective/);
  // read-only: no mkdir / sysfs write / controller enable
  assert.ok(!/mkdir|>\s*\/sys|echo \+/.test(c), "preflight must be read-only");
});

test("cpuCgroupReadyCommand: read-only probe, valid shell, never writes", () => {
  const c = cpuCgroupReadyCommand();
  validShell(c, "ready");
  assert.match(c, /\/sys\/fs\/cgroup\/krova/);
  assert.match(c, /cpu/);
  assert.ok(
    !/mkdir|>\s*\/sys|echo \+/.test(c),
    "ready probe must be read-only (no mkdir / no sysfs write)"
  );
});

test("cpusetReadyCommand: read-only probe for cpuset delegation, never writes", () => {
  const c = cpusetReadyCommand();
  validShell(c, "cpuset-ready");
  assert.match(c, /\/sys\/fs\/cgroup\/krova/);
  assert.match(c, /cpuset/);
  assert.ok(
    !/mkdir|>\s*\/sys|echo \+/.test(c),
    "cpuset ready probe must be read-only"
  );
});

test("cpuCgroupPrepScript (io off): byte-identical — NO +io / +memory delegation", () => {
  const decoded = decodePrep(cpuCgroupPrepScript({ numa: false, io: false }));
  assert.doesNotMatch(decoded, /\+io\b/);
  assert.doesNotMatch(decoded, /\+memory\b/);
});

test("cpuCgroupPrepScript (io on): delegates +io and +memory (root→krova)", () => {
  const cmd = cpuCgroupPrepScript({ numa: false, io: true });
  validShell(cmd, "wrapper");
  const decoded = decodePrep(cmd);
  validShell(decoded, "payload");
  // io alone throttles buffered writeback on 6.8; memory is cross-kernel insurance.
  assert.match(decoded, /\+io\b/);
  assert.match(decoded, /\+memory\b/);
  // root delegation precedes krova delegation (both present).
  assert.match(decoded, /\/sys\/fs\/cgroup\/cgroup\.subtree_control[^\n]*\+io/);
  assert.match(decoded, /krova\/cgroup\.subtree_control[^\n]*\+io/);
});

test("ioCgroupReadyCommand: read-only probe for io delegation, never writes", () => {
  const c = ioCgroupReadyCommand();
  validShell(c, "io-ready");
  assert.match(c, /\/sys\/fs\/cgroup\/krova/);
  assert.match(c, /\bio\b/);
  assert.ok(
    !/mkdir|>\s*\/sys|echo \+/.test(c),
    "io ready probe must be read-only"
  );
});

test("cubeDiskDeviceCommand: read-only, resolves the rootfs FILE's backing maj:min (LVM/partition-aware)", () => {
  const c = cubeDiskDeviceCommand("/var/lib/krova/cubes/x/rootfs.ext4");
  validShell(c, "disk-device");
  // df the file → device → KNAME; partition uses the PARENT gendisk (../dev),
  // dm/whole-disk uses its own dev. Read-only (no writes to /sys).
  assert.match(
    c,
    /df --output=source \/var\/lib\/krova\/cubes\/x\/rootfs\.ext4/
  );
  assert.match(c, /lsblk -no KNAME/);
  assert.match(c, /\/sys\/class\/block\/\$kname\/partition/);
  assert.match(c, /\/sys\/class\/block\/\$kname\/\.\.\/dev/);
  assert.ok(
    !/mkdir|>\s*\/sys|echo \+/.test(c),
    "device probe must be read-only"
  );
});
