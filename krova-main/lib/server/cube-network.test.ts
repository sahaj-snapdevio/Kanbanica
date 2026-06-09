import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cubeIpv4Address,
  cubeIpv4Gateway,
  cubeIpv4Subnet,
  cubeIpv6Address,
  octetOf,
  subnetOf,
} from "@/lib/server/cube-network";

test("cube IPv4 maps S→198.18.0.0/15 (base + S*256 + octet)", () => {
  assert.equal(cubeIpv4Address(1, 2), "198.18.1.2");
  assert.equal(cubeIpv4Gateway(1), "198.18.1.1");
  assert.equal(cubeIpv4Subnet(1), "198.18.1.0/24");
  assert.equal(cubeIpv4Address(255, 254), "198.18.255.254");
  assert.equal(cubeIpv4Address(256, 2), "198.19.0.2"); // crosses into 198.19
  assert.equal(cubeIpv4Address(511, 254), "198.19.255.254"); // last /24 in the /15
});

test("subnetOf / octetOf round-trip on the new range", () => {
  for (const s of [1, 5, 255, 256, 511]) {
    for (const o of [2, 100, 254]) {
      const ip = cubeIpv4Address(s, o);
      assert.equal(subnetOf(ip), s, `subnetOf(${ip})`);
      assert.equal(octetOf(ip), o, `octetOf(${ip})`);
    }
  }
  assert.equal(subnetOf("198.19.0.2"), 256);
  assert.equal(octetOf("198.19.255.254"), 254);
});

test("subnetOf rejects an address outside 198.18.0.0/15 (e.g. legacy 10.x)", () => {
  assert.throws(() => subnetOf("10.0.1.5"));
});

test("cubeIpv4Address rejects S beyond the /15 capacity (511)", () => {
  assert.throws(() => cubeIpv4Address(512, 2));
});

test("IPv6 derivation is unchanged", () => {
  assert.equal(cubeIpv6Address(1, 2), "fd00:c0be:1::2");
  assert.equal(cubeIpv6Address(256, 254), "fd00:c0be:100::fe");
});
