import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPurgeByHostnameBody,
  PURGE_CACHE_MAX_HOSTS,
} from "@/lib/cloudflare/cache";

test("buildPurgeByHostnameBody: single hostname → { hosts: [host] }", () => {
  assert.deepEqual(buildPurgeByHostnameBody(["app.customer.com"]), {
    hosts: ["app.customer.com"],
  });
});

test("buildPurgeByHostnameBody: trims + lowercases + de-dupes", () => {
  assert.deepEqual(
    buildPurgeByHostnameBody(["  App.Customer.com ", "app.customer.com"]),
    { hosts: ["app.customer.com"] }
  );
});

test("buildPurgeByHostnameBody: empty / blank-only input throws", () => {
  assert.throws(() => buildPurgeByHostnameBody([]), /at least one hostname/);
  assert.throws(
    () => buildPurgeByHostnameBody(["   "]),
    /at least one hostname/
  );
});

test("buildPurgeByHostnameBody: rejects > 30 hostnames", () => {
  const tooMany = Array.from(
    { length: PURGE_CACHE_MAX_HOSTS + 1 },
    (_, i) => `h${i}.example.com`
  );
  assert.throws(
    () => buildPurgeByHostnameBody(tooMany),
    /at most 30 hostnames/
  );
});

test("buildPurgeByHostnameBody: exactly 30 hostnames is allowed", () => {
  const exactly = Array.from(
    { length: PURGE_CACHE_MAX_HOSTS },
    (_, i) => `h${i}.example.com`
  );
  assert.equal(buildPurgeByHostnameBody(exactly).hosts.length, 30);
});

test("buildPurgeByHostnameBody: rejects wildcard hostnames (CF can't purge them)", () => {
  assert.throws(
    () => buildPurgeByHostnameBody(["*.example.com"]),
    /wildcard hostnames are not supported/
  );
  // Even mixed in with a concrete host, a wildcard is refused.
  assert.throws(
    () => buildPurgeByHostnameBody(["app.example.com", "*.example.com"]),
    /wildcard hostnames are not supported/
  );
});
