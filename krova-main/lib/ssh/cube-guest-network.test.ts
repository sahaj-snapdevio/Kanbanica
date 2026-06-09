/**
 * Pure unit tests for the guest network file builder (Rule 59).
 *
 * These pin the two long-term-stability fixes against regression — the v4-first
 * fast-fail /etc/resolv.conf and the IPv6AcceptRA=no flap fix — and mechanically
 * enforce that the baked rootfs resolv.conf (setup/images/build-all-images.sh)
 * stays byte-identical to the runtime writer (Rule 14 — this replaces the old
 * comment-only "keep in sync", whose drift was an audited latent risk).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildGuestNetworkFiles } from "@/lib/ssh/cube-guest-network";

// 198.18.2.17 → S=2, octet=17 → v6 fd00:c0be:2::11. (octet 17 = 0x11.)
const SAMPLE_IP = "198.18.2.17";

const EXPECTED_RESOLV =
  "nameserver 1.1.1.1\n" +
  "nameserver 2606:4700:4700::1111\n" +
  "nameserver 2001:4860:4860::8888\n" +
  "options timeout:1 attempts:2 single-request-reopen\n";

test("resolv.conf is IPv4-first with the glibc fast-fail options line", () => {
  const { resolvConf } = buildGuestNetworkFiles(SAMPLE_IP);
  assert.equal(resolvConf, EXPECTED_RESOLV);
  // The v4 resolver MUST precede both v6 resolvers — the whole point of the fix.
  assert.equal(resolvConf.split("\n")[0], "nameserver 1.1.1.1");
});

test("network unit pins IPv6AcceptRA=no and keeps both families static", () => {
  const { networkUnit } = buildGuestNetworkFiles(SAMPLE_IP);
  assert.ok(
    networkUnit.includes("IPv6AcceptRA=no"),
    "IPv6AcceptRA=no must be present to stop the RA-client reconfigure churn"
  );
  assert.ok(networkUnit.includes("Address=198.18.2.17/24"));
  assert.ok(networkUnit.includes("Gateway=198.18.2.1"));
  assert.ok(networkUnit.includes("Address=fd00:c0be:2::11/64"));
  assert.ok(networkUnit.includes("Gateway=fd00:c0be:2::1"));
  // DNS= lines mirror CUBE_DNS_SERVERS (v4-first).
  assert.ok(networkUnit.includes("DNS=1.1.1.1"));
});

test("baked rootfs resolv.conf (build-all-images.sh) is byte-identical to the builder", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const buildScript = readFileSync(
    join(repoRoot, "setup/images/build-all-images.sh"),
    "utf-8"
  );
  const m = buildScript.match(/printf "([^"]*)" > \$R\/etc\/resolv\.conf/);
  assert.ok(m, "could not find the resolv.conf printf in build-all-images.sh");
  const baked = m[1].replace(/\\n/g, "\n");
  assert.equal(
    baked,
    buildGuestNetworkFiles(SAMPLE_IP).resolvConf,
    "build-all-images.sh resolv.conf drifted from buildGuestNetworkFiles — edit BOTH (kept byte-identical by design)"
  );
});

test("buildGuestNetworkFiles throws on a legacy non-198.18 IPv4 (fail-loud)", () => {
  assert.throws(
    () => buildGuestNetworkFiles("10.0.5.7"),
    /not in the cube IPv4 range/
  );
});
