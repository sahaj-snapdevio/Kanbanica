import assert from "node:assert/strict";
import { test } from "node:test";

import { isAnalyticsAllowedPath, isOrbitPath } from "@/lib/analytics-scope";

test("isOrbitPath: matches the Orbit admin route group exactly", () => {
  assert.equal(isOrbitPath("/orbit"), true);
  assert.equal(isOrbitPath("/orbit/"), true);
  assert.equal(isOrbitPath("/orbit/spaces"), true);
  assert.equal(isOrbitPath("/orbit/cubes/abc123"), true);
  assert.equal(isOrbitPath("/orbit/platform-settings"), true);
});

test("isOrbitPath: does not match look-alike or customer paths", () => {
  assert.equal(isOrbitPath("/"), false);
  // Prefix without a path boundary must NOT match.
  assert.equal(isOrbitPath("/orbital"), false);
  assert.equal(isOrbitPath("/orbiter/x"), false);
  assert.equal(isOrbitPath("/pricing"), false);
  assert.equal(isOrbitPath("/login"), false);
  assert.equal(isOrbitPath("/space1/cubes/cube1"), false);
  // "orbit" only counts when it is the first segment.
  assert.equal(isOrbitPath("/space1/orbit"), false);
});

test("isAnalyticsAllowedPath: allows every customer surface, blocks Orbit", () => {
  // Customer-facing — GTM loads.
  assert.equal(isAnalyticsAllowedPath("/"), true);
  assert.equal(isAnalyticsAllowedPath("/pricing"), true);
  assert.equal(isAnalyticsAllowedPath("/login"), true);
  assert.equal(isAnalyticsAllowedPath("/signup"), true);
  assert.equal(isAnalyticsAllowedPath("/space1"), true);
  assert.equal(isAnalyticsAllowedPath("/space1/cubes/cube1"), true);
  assert.equal(isAnalyticsAllowedPath("/space1/cubes/cube1/terminal"), true);
  assert.equal(isAnalyticsAllowedPath("/profile"), true);

  // Operator admin — GTM stays off.
  assert.equal(isAnalyticsAllowedPath("/orbit"), false);
  assert.equal(isAnalyticsAllowedPath("/orbit/subscriptions"), false);
  assert.equal(isAnalyticsAllowedPath("/orbit/users"), false);
});
