/**
 * Unit tests for the live-fleet guest-network retrofit (Rule 59). The script
 * scripts/install-guest-network-fleet.ts writes into the RUNNING guest of every
 * customer cube — its highest-blast-radius behavior. These tests lock its
 * load-bearing SAFETY guarantee mechanically (not via a comment): it issues
 * exactly the two file writes and NOTHING that re-applies config to the live
 * link (which could drop eth0 / a session), plus the idempotency + fail-loud
 * behaviors. A fake guestExec captures every command — no SSH, no DB, no host.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Client } from "ssh2";
import { buildGuestNetworkFiles } from "@/lib/ssh/cube-guest-network";
import { retrofitCubeGuestNetwork } from "@/lib/ssh/guest-network-retrofit";

const IP = "198.18.2.17";
const FAKE_CLIENT = {} as Client;

/** Captures every guest command; returns `probeStdout` for the resolv.conf probe. */
function fakeGuestExec(captured: string[], probeStdout = "") {
  return async (_client: Client, _cubeId: string, command: string) => {
    captured.push(command);
    if (command.startsWith("cat /etc/resolv.conf")) {
      return { exitCode: 0, stdout: probeStdout, stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
}

// Exact-shape allow-list for the only two commands the retrofit may issue. An
// allow-list (vs a deny-list) is the strongest guard: a command matching one of
// these provably contains nothing else — no networkctl/systemctl/ip-link.
const RESOLV_WRITE =
  /^rm -f \/etc\/resolv\.conf && echo '[A-Za-z0-9+/=]+' \| base64 -d > \/etc\/resolv\.conf$/;
const UNIT_WRITE =
  /^mkdir -p \/etc\/systemd\/network && echo '[A-Za-z0-9+/=]+' \| base64 -d > \/etc\/systemd\/network\/10-eth0\.network$/;

// Defense-in-depth deny-list (applied with the base64 blob masked so it can't
// false-positive): anything that re-applies config to the live link is banned.
const LIVE_LINK_TOUCH =
  /networkctl|systemctl\s+(restart|reload)|\bip\s+(link|addr|-6|-4)\b|reboot|shutdown|nmcli|ifup|ifdown/;

function maskB64(cmd: string): string {
  return cmd.replace(/'[A-Za-z0-9+/=]+'/g, "'<b64>'");
}

test("retrofit writes exactly resolv.conf + 10-eth0.network and NEVER touches the live link", async () => {
  const captured: string[] = [];
  const outcome = await retrofitCubeGuestNetwork(
    FAKE_CLIENT,
    { id: "c1", internalIp: IP },
    true,
    fakeGuestExec(captured)
  );
  assert.equal(outcome, "updated");
  // force=true → no probe → exactly the two file writes, in order.
  assert.equal(captured.length, 2);
  assert.match(captured[0], RESOLV_WRITE);
  assert.match(captured[1], UNIT_WRITE);
  for (const cmd of captured) {
    assert.doesNotMatch(
      maskB64(cmd),
      LIVE_LINK_TOUCH,
      `command must not touch the live link: ${cmd}`
    );
  }
});

test("retrofit writes the exact buildGuestNetworkFiles bytes (base64 round-trip)", async () => {
  const captured: string[] = [];
  await retrofitCubeGuestNetwork(
    FAKE_CLIENT,
    { id: "c1", internalIp: IP },
    true,
    fakeGuestExec(captured)
  );
  const { resolvConf, networkUnit } = buildGuestNetworkFiles(IP);
  const decode = (cmd: string): string => {
    const m = cmd.match(/echo '([A-Za-z0-9+/=]+)' \| base64 -d/);
    assert.ok(m, `expected a base64 payload in: ${cmd}`);
    return Buffer.from(m[1], "base64").toString("utf-8");
  };
  assert.equal(decode(captured[0]), resolvConf);
  assert.equal(decode(captured[1]), networkUnit);
});

test("retrofit skips when the live resolv.conf already matches (idempotent)", async () => {
  const captured: string[] = [];
  const { resolvConf } = buildGuestNetworkFiles(IP);
  const outcome = await retrofitCubeGuestNetwork(
    FAKE_CLIENT,
    { id: "c1", internalIp: IP },
    false,
    fakeGuestExec(captured, resolvConf)
  );
  assert.equal(outcome, "skipped");
  // Only the probe ran; NO writes.
  assert.equal(captured.length, 1);
  assert.ok(captured[0].startsWith("cat /etc/resolv.conf"));
});

test("--force bypasses the idempotency skip even when resolv.conf already matches", async () => {
  const captured: string[] = [];
  const { resolvConf } = buildGuestNetworkFiles(IP);
  const outcome = await retrofitCubeGuestNetwork(
    FAKE_CLIENT,
    { id: "c1", internalIp: IP },
    true,
    fakeGuestExec(captured, resolvConf)
  );
  assert.equal(outcome, "updated");
  assert.equal(captured.length, 2); // no probe, two writes
});

test("retrofit returns skipped when the cube has no IPv4 (no commands issued)", async () => {
  const captured: string[] = [];
  const outcome = await retrofitCubeGuestNetwork(
    FAKE_CLIENT,
    { id: "c1", internalIp: null },
    false,
    fakeGuestExec(captured)
  );
  assert.equal(outcome, "skipped");
  assert.equal(captured.length, 0);
});

test("retrofit propagates the subnetOf throw on a legacy 10.x IP (never writes a guessed config)", async () => {
  const captured: string[] = [];
  await assert.rejects(
    () =>
      retrofitCubeGuestNetwork(
        FAKE_CLIENT,
        { id: "c1", internalIp: "10.0.5.7" },
        true,
        fakeGuestExec(captured)
      ),
    /not in the cube IPv4 range/
  );
  assert.equal(captured.length, 0); // threw before any write
});
