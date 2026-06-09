import assert from "node:assert/strict";
import { test } from "node:test";
import { isDiskCanaryCube } from "@/lib/cubes/disk-canary";

test("isDiskCanaryCube: empty allowlist (default) → always false (byte-identical off)", () => {
  // DISK_CANARY_CUBE_IDS defaults to [] — no cube is a canary unless the operator
  // explicitly adds it + deploys, so the default behavior is unchanged.
  assert.equal(isDiskCanaryCube("cube-anything"), false);
  assert.equal(isDiskCanaryCube(""), false);
});
