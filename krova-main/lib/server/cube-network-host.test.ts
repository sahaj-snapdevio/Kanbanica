/**
 * Shell-syntax regression guard for the cube networking paths.
 *
 * The host + guest networking code builds bash command STRINGS that are
 * invisible to `tsc`/biome — a malformed one (e.g. the `; &&` join bug,
 * 2026-05-30) only surfaces when it runs on a live host. This test drives the
 * REAL command construction with a fake ssh client, captures every command,
 * and runs `bash -n` (parse-only) on each so any syntax error fails here
 * instead of in production. Requires `bash` on PATH (dev + CI both have it).
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyHostNetworking,
  buildForwardingSysctlScript,
  conntrackTuneCommand,
  mssClampCommand,
} from "@/lib/server/cube-network-host";
import { writeCubeGuestNetworkConfig } from "@/lib/ssh/cube-guest-network";

const dir = mkdtempSync(join(tmpdir(), "krova-shellcheck-"));
let seq = 0;

/** Parse-only (`bash -n`) syntax check of a single shell command string. */
function assertValidShell(cmd: string, label: string): void {
  const f = join(dir, `c${seq++}.sh`);
  writeFileSync(f, cmd);
  try {
    execFileSync("bash", ["-n", f], { stdio: "pipe" });
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    assert.fail(
      `bash -n rejected [${label}]:\n  CMD: ${cmd}\n  ERR: ${(err.stderr?.toString() ?? err.message ?? "").trim()}`
    );
  }
}

/** Fake ssh2 Client: records each command, resolves exit 0 so the real code
 *  runs through ALL of its steps. */
function makeFakeClient(captured: string[]): import("ssh2").Client {
  return {
    exec(command: string, cb: (err: unknown, stream: unknown) => void) {
      captured.push(command);
      const stream: Record<string, unknown> = {
        on(event: string, handler: (code?: number) => void) {
          if (event === "close") {
            queueMicrotask(() => handler(0));
          }
          return stream;
        },
        stderr: { on: () => stream },
      };
      cb(null, stream);
      return stream;
    },
  } as unknown as import("ssh2").Client;
}

test("applyHostNetworking emits only valid shell (all S + retrofit modes)", async () => {
  const captured: string[] = [];
  const client = makeFakeClient(captured);
  await applyHostNetworking(client, 5, { retrofit: true });
  await applyHostNetworking(client, 1, {}); // min subnet
  await applyHostNetworking(client, 511, {}); // max subnet
  assert.ok(captured.length > 0, "expected commands to be captured");
  for (const cmd of captured) {
    assertValidShell(cmd, "applyHostNetworking");
  }
});

test("writeCubeGuestNetworkConfig emits only valid shell", async () => {
  const captured: string[] = [];
  await writeCubeGuestNetworkConfig(
    makeFakeClient(captured),
    "/tmp/krova-mount-abc",
    "198.18.5.7" // was "10.0.5.7"
  );
  assert.ok(captured.length > 0);
  for (const cmd of captured) {
    assertValidShell(cmd, "writeCubeGuestNetworkConfig");
  }
});

test("buildForwardingSysctlScript derives the WAN from BOTH v6 AND v4 default routes", () => {
  const s = buildForwardingSysctlScript();
  // The fix: the v4 default's iface (always present) is in the derivation, so
  // accept_ra=2 is emitted even on a host with no v6 default route yet.
  assert.match(s, /ip -6 route show default/);
  assert.match(s, /ip -4 route show default/);
  assert.match(s, /accept_ra=2/);
  // Must be valid shell on its own.
  assertValidShell(s, "buildForwardingSysctlScript");
});

/** Run buildForwardingSysctlScript against a stubbed `ip` whose v6/v4 default
 *  route output is `v6Out`/`v4Out`, returning the emitted sysctl lines. The
 *  script uses POSIX awk (not `grep -oP`), so this behavioral proof runs on
 *  every platform (GNU + BSD), not only GNU-grep hosts. */
function runSysctlScript(v6Out: string, v4Out: string): string {
  const bin = mkdtempSync(join(tmpdir(), "krova-fakebin-"));
  writeFileSync(
    join(bin, "ip"),
    `#!/usr/bin/env bash\nif [ "$1" = "-6" ]; then printf '%s\\n' ${JSON.stringify(v6Out)}; else printf '%s\\n' ${JSON.stringify(v4Out)}; fi\n`,
    { mode: 0o755 }
  );
  return execFileSync("bash", ["-c", buildForwardingSysctlScript()], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: "utf-8",
  });
}

test("buildForwardingSysctlScript emits accept_ra=2 for the v4 WAN even with NO v6 default route", () => {
  // The NONE-state root cause: empty v6 default, v4 default via eth0. The prior
  // code derived WANS from `ip -6 route` ALONE → empty → no accept_ra line →
  // forwarding host ignores RAs → permanent v6 blackhole for every cube on it.
  const out = runSysctlScript("", "default via 1.2.3.4 dev eth0 proto static");
  assert.match(out, /net\.ipv6\.conf\.eth0\.accept_ra=2/);
  assert.match(out, /net\.ipv4\.ip_forward=1/);
  assert.match(out, /net\.ipv6\.conf\.all\.forwarding=1/);
  assert.match(out, /net\.ipv6\.conf\.br0\.accept_ra=0/);
});

test("buildForwardingSysctlScript unions + dedups the v6 and v4 WAN (same iface → one accept_ra line)", () => {
  const out = runSysctlScript(
    "default via fe80::1 dev eth0 proto ra metric 1024",
    "default via 1.2.3.4 dev eth0 proto static"
  );
  const accept = out.split("\n").filter((l) => l.includes("accept_ra=2"));
  assert.deepEqual(accept, ["net.ipv6.conf.eth0.accept_ra=2"]);
});

test("conntrackTuneCommand + mssClampCommand emit valid shell (audit W2/W3)", () => {
  assertValidShell(conntrackTuneCommand(), "conntrackTuneCommand");
  assertValidShell(mssClampCommand("iptables"), "mssClampCommand v4");
  assertValidShell(mssClampCommand("ip6tables"), "mssClampCommand v6");
});

test("mssClampCommand uses the mangle table (filter FORWARD's egress ACCEPT would short-circuit it)", () => {
  const v4 = mssClampCommand("iptables");
  assert.match(v4, /-t mangle/);
  assert.match(v4, /TCPMSS --clamp-mss-to-pmtu/);
  // No `-i br0`: clamp both directions of forwarded handshakes.
  assert.ok(!v4.includes("-i br0"), "clamp should not be interface-scoped");
});

test("conntrackTuneCommand raises both UDP timeouts above the kernel defaults", () => {
  const c = conntrackTuneCommand();
  // Above the 30/120 kernel defaults so idle UDP overlays don't drop (W2).
  assert.match(c, /nf_conntrack_udp_timeout=180/);
  assert.match(c, /nf_conntrack_udp_timeout_stream=600/);
  // Loaded at boot so the sysctl.d keys exist when applied.
  assert.match(c, /modules-load\.d\/krova-conntrack\.conf/);
});

test("applyHostNetworking applies conntrack timeouts + MSS clamp on BOTH families", async () => {
  const captured: string[] = [];
  await applyHostNetworking(makeFakeClient(captured), 5, {});
  const all = captured.join("\n");
  assert.match(all, /nf_conntrack_udp_timeout=180/);
  assert.match(all, /nf_conntrack_udp_timeout_stream=600/);
  assert.ok(
    captured.some(
      (c) =>
        c.includes("iptables") &&
        c.includes("-t mangle") &&
        c.includes("TCPMSS")
    ),
    "expected an iptables (v4) TCPMSS clamp in the mangle table"
  );
  assert.ok(
    captured.some(
      (c) =>
        c.includes("ip6tables") &&
        c.includes("-t mangle") &&
        c.includes("TCPMSS")
    ),
    "expected an ip6tables (v6) TCPMSS clamp in the mangle table"
  );
});
