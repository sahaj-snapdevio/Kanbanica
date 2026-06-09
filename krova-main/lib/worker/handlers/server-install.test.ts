/**
 * Unit guard for the host CPU performance-governor installer (2026-06-02 audit
 * C1). cpuPerformanceScript() base64-encodes a multi-line bash payload with
 * heredocs; a quoting/syntax slip is invisible to tsc and only surfaces on a
 * live host. This decodes the payload and runs `bash -n` (parse-only) on both
 * the inner script and the outer wrapper, and asserts it actually targets the
 * governor + turbo knobs. Requires `bash` on PATH (dev + CI both have it).
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  cpuPerformanceScript,
  diskHostTuningScript,
} from "@/lib/worker/handlers/server-install";

const dir = mkdtempSync(join(tmpdir(), "krova-cpu-perf-"));
let seq = 0;

function assertValidShell(cmd: string, label: string): void {
  const f = join(dir, `c${seq++}.sh`);
  writeFileSync(f, cmd);
  try {
    execFileSync("bash", ["-n", f], { stdio: "pipe" });
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    assert.fail(
      `bash -n rejected [${label}]:\n  ERR: ${(err.stderr?.toString() ?? err.message ?? "").trim()}`
    );
  }
}

test("cpuPerformanceScript decodes to valid shell that sets performance governor + turbo", () => {
  const cmd = cpuPerformanceScript();

  // Outer wrapper (`echo '<b64>' | base64 -d | bash`) is itself valid shell.
  assertValidShell(cmd, "cpuPerformanceScript wrapper");

  // Extract + decode the base64 payload and prove the inner bash parses too —
  // the heredocs are the part most likely to break (Rule 39).
  const m = cmd.match(/echo '([A-Za-z0-9+/=]+)'/);
  assert.ok(m, "expected a single-quoted base64 payload");
  const decoded = Buffer.from(m[1], "base64").toString("utf-8");
  assertValidShell(decoded, "cpuPerformanceScript payload");

  // It must actually target the governor + turbo + install the persisting unit.
  assert.match(decoded, /scaling_governor/);
  assert.match(decoded, /echo performance/);
  assert.match(decoded, /no_turbo/);
  assert.match(decoded, /krova-cpu-perf\.service/);
  assert.match(decoded, /systemctl enable krova-cpu-perf\.service/);
});

test("diskHostTuningScript is valid shell + targets the four host disk knobs", () => {
  const cmd = diskHostTuningScript();
  // Not base64-wrapped — run bash -n on the script directly (heredocs, Rule 39).
  assertValidShell(cmd, "diskHostTuningScript");
  // Dirty-page caps + scrub throttle are now picked ON THE HOST from the detected
  // disk class — the script carries a per-class case + writes the chosen shell var.
  assert.match(cmd, /case "\$CLASS" in/);
  assert.match(cmd, /nvme\*\) CLASS=nvme/);
  assert.match(cmd, /queue\/rotational/);
  // The per-class values are present (ssd keeps the validated 256/64 MiB + 50 MB/s).
  assert.match(cmd, /DB=268435456/); // ssd dirty 256 MiB
  assert.match(cmd, /DB=1073741824/); // nvme dirty 1 GiB
  assert.match(cmd, /DB=100663296/); // hdd dirty 96 MiB
  assert.match(cmd, /SCRUB=50000/); // ssd scrub 50 MB/s
  assert.match(cmd, /SCRUB=300000/); // nvme scrub 300 MB/s
  assert.match(cmd, /vm\.dirty_bytes = \$DB/);
  assert.match(cmd, /vm\.dirty_background_bytes = \$DBG/);
  assert.match(cmd, /vm\.dirty_expire_centisecs = 1500/); // time-based — literal
  assert.match(cmd, /dev\.raid\.speed_limit_max = \$SCRUB/);
  assert.match(cmd, /\/etc\/sysctl\.d\/98-krova-disk\.conf/);
  assert.match(cmd, /sysctl --system/);
  // Adaptive scheduler: mq-deadline ONLY on rotational==0 sd* (SATA-SSD); NVMe
  // is deliberately not matched by the scheduler rule (keeps its `none` default).
  assert.match(cmd, /KERNEL=="sd\[a-z\]\*"/);
  assert.match(cmd, /ATTR\{queue\/rotational\}=="0"/);
  assert.match(cmd, /ATTR\{queue\/scheduler\}="mq-deadline"/);
  assert.match(cmd, /udevadm trigger/);
  // Weekly host fstrim (replaces guest inline discard).
  assert.match(cmd, /fstrim\.timer/);
  // Per-cube serial.log / fcLog rotation (copytruncate keeps FC's open fd valid).
  assert.match(cmd, /\/etc\/logrotate\.d\/krova-cube-logs/);
  assert.match(cmd, /\/var\/lib\/krova\/cubes\/\*\/serial\.log/);
  assert.match(cmd, /copytruncate/);
});

test("diskHostTuningScript(measuredMbps): derives LITERAL values, no on-host detection", () => {
  const cmd = diskHostTuningScript(500);
  assertValidShell(cmd, "diskHostTuningScript(measured)");
  // 500 MB/s → deriveDiskTuning: 250 MB dirty / 62.5 MB bg / 50000 KB/s scrub.
  assert.match(cmd, /derived from a measured 500 MB\/s/);
  assert.match(cmd, /vm\.dirty_bytes = 250000000/);
  assert.match(cmd, /vm\.dirty_background_bytes = 62500000/);
  assert.match(cmd, /vm\.dirty_expire_centisecs = 1500/);
  assert.match(cmd, /dev\.raid\.speed_limit_max = 50000/);
  // measured branch writes literals — it does NOT detect the class on the host.
  assert.doesNotMatch(cmd, /case "\$CLASS"/);
  // still applies the shared tail (scheduler, fstrim, logrotate).
  assert.match(cmd, /KERNEL=="sd\[a-z\]\*"/);
  assert.match(cmd, /fstrim\.timer/);
});

test("diskHostTuningScript(null): falls back to on-host class detection", () => {
  const cmd = diskHostTuningScript(null);
  assertValidShell(cmd, "diskHostTuningScript(null)");
  assert.match(cmd, /case "\$CLASS" in/);
  assert.match(cmd, /DB=268435456/); // ssd class default present
});
