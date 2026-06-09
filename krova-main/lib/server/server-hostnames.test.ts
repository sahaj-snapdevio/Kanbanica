import assert from "node:assert/strict";
import { test } from "node:test";
import { PLATFORM_BASE_DOMAIN } from "@/config/platform";
import {
  serverConnectDomain,
  serverLandingHosts,
  serverOriginHostname,
} from "@/lib/server/server-hostnames";

test("serverOriginHostname: <hostname>.<base>", () => {
  assert.equal(
    serverOriginHostname("banana"),
    `banana.${PLATFORM_BASE_DOMAIN}`
  );
});

test("serverConnectDomain: connect.<hostname>.<base>", () => {
  assert.equal(
    serverConnectDomain("banana"),
    `connect.banana.${PLATFORM_BASE_DOMAIN}`
  );
});

test("serverLandingHosts: pairs the two derivations consistently", () => {
  const hosts = serverLandingHosts("banana");
  assert.equal(hosts.originHostname, serverOriginHostname("banana"));
  assert.equal(hosts.connectDomain, serverConnectDomain("banana"));
  // The connect host is a subdomain of NOTHING shared with origin beyond base;
  // they must be distinct so Caddy can treat their TLS differently.
  assert.notEqual(hosts.originHostname, hosts.connectDomain);
});
