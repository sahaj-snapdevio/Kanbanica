import assert from "node:assert/strict";
import { test } from "node:test";
import { lowestFreeSubnet } from "@/lib/server/bridge-subnets";

test("returns MIN when nothing is in use", () => {
  assert.equal(lowestFreeSubnet(1, 0xff_ff, []), 1);
});

test("fills the lowest gap", () => {
  assert.equal(lowestFreeSubnet(1, 0xff_ff, [1, 2, 4]), 3);
  assert.equal(lowestFreeSubnet(1, 0xff_ff, [1, 2, 3]), 4);
});

test("ignores out-of-range / duplicate in-use values", () => {
  assert.equal(lowestFreeSubnet(1, 0xff_ff, [1, 1, 2, 999_999]), 3);
});

test("THROWS on exhaustion instead of returning MAX+1 (audit N-L1)", () => {
  assert.throws(() => lowestFreeSubnet(1, 3, [1, 2, 3]));
});

test("can allocate the very last slot", () => {
  assert.equal(lowestFreeSubnet(1, 3, [1, 2]), 3);
});
