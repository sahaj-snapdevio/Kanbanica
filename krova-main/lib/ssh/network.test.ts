import assert from "node:assert/strict";
import { test } from "node:test";
import { dnatDeleteSpecsForHostPort } from "@/lib/ssh/network";

// dnatDeleteSpecsForHostPort drives the flush-on-reuse path in
// addTcpPortForward: given `iptables -t nat -S PREROUTING` output, it returns
// the exact `-D` delete specs for EVERY DNAT rule on a host port — so a stale
// rule left by a deleted cube (host unreachable at delete time) can't survive
// to hijack a reused port. The matching must be exact: no `30002` vs `300020`
// bleed, DNAT rules only, and the destination port digits must never be
// mistaken for the --dport.

const DUMP = [
  "-P PREROUTING ACCEPT",
  "-A PREROUTING -p tcp -m tcp --dport 30002 -j DNAT --to-destination 198.18.1.8:22",
  "-A PREROUTING -p tcp -m tcp --dport 30004 -j DNAT --to-destination 198.18.1.9:22",
  "-A PREROUTING -p tcp -m tcp --dport 30002 -j DNAT --to-destination 198.18.1.250:22",
].join("\n");

test("dnatDeleteSpecsForHostPort: returns a -D spec for the single DNAT on the port", () => {
  const specs = dnatDeleteSpecsForHostPort(DUMP, 30_004);
  assert.deepEqual(specs, [
    "-D PREROUTING -p tcp -m tcp --dport 30004 -j DNAT --to-destination 198.18.1.9:22",
  ]);
});

test("dnatDeleteSpecsForHostPort: returns BOTH specs when a stale + new rule share the port (the misroute bug)", () => {
  const specs = dnatDeleteSpecsForHostPort(DUMP, 30_002);
  assert.deepEqual(specs, [
    "-D PREROUTING -p tcp -m tcp --dport 30002 -j DNAT --to-destination 198.18.1.8:22",
    "-D PREROUTING -p tcp -m tcp --dport 30002 -j DNAT --to-destination 198.18.1.250:22",
  ]);
});

test("dnatDeleteSpecsForHostPort: does NOT match a longer port that shares a prefix", () => {
  const dump =
    "-A PREROUTING -p tcp -m tcp --dport 300020 -j DNAT --to-destination 198.18.1.8:22";
  assert.deepEqual(dnatDeleteSpecsForHostPort(dump, 30_002), []);
});

test("dnatDeleteSpecsForHostPort: does NOT match the destination port digits", () => {
  // --dport is 40000 but the destination happens to be :30002 — must not match.
  const dump =
    "-A PREROUTING -p tcp -m tcp --dport 40000 -j DNAT --to-destination 198.18.1.8:30002";
  assert.deepEqual(dnatDeleteSpecsForHostPort(dump, 30_002), []);
});

test("dnatDeleteSpecsForHostPort: ignores non-DNAT rules on the same port", () => {
  const dump = [
    "-A PREROUTING -p tcp -m tcp --dport 30002 -j ACCEPT",
    "-A PREROUTING -p tcp -m tcp --dport 30002 -j REDIRECT --to-ports 8080",
  ].join("\n");
  assert.deepEqual(dnatDeleteSpecsForHostPort(dump, 30_002), []);
});

test("dnatDeleteSpecsForHostPort: empty / no-match dump returns []", () => {
  assert.deepEqual(dnatDeleteSpecsForHostPort("", 30_002), []);
  assert.deepEqual(
    dnatDeleteSpecsForHostPort("-P PREROUTING ACCEPT", 30_002),
    []
  );
});
