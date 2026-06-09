import assert from "node:assert/strict";
import { test } from "node:test";
import { JAILER_UID_BASE } from "@/config/platform";
import { lowestFreeUid } from "@/lib/server/jailer-uids";

const B = JAILER_UID_BASE;

test("lowestFreeUid: returns the base when nothing is in use", () => {
  assert.equal(lowestFreeUid(B, []), B);
});

test("lowestFreeUid: skips a contiguous run from the base", () => {
  assert.equal(lowestFreeUid(B, [B, B + 1, B + 2]), B + 3);
});

test("lowestFreeUid: fills the lowest gap, not the next-after-max", () => {
  assert.equal(lowestFreeUid(B, [B, B + 1, B + 3]), B + 2);
});

test("lowestFreeUid: tolerates duplicates and out-of-order input", () => {
  assert.equal(lowestFreeUid(B, [B + 1, B, B + 1, B + 2]), B + 3);
});

test("lowestFreeUid: ignores values below the base", () => {
  assert.equal(lowestFreeUid(B, [B - 5, B - 1]), B);
});
