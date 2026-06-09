import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cachePurgeCooldownRemainingMs,
  cachePurgeCooldownRemainingSeconds,
} from "@/lib/domains/cache-purge";

const COOLDOWN = 60; // seconds

test("cache purge cooldown: never purged → allowed now", () => {
  assert.equal(
    cachePurgeCooldownRemainingMs(
      null,
      new Date("2026-06-02T00:00:00Z"),
      COOLDOWN
    ),
    0
  );
  assert.equal(
    cachePurgeCooldownRemainingSeconds(null, new Date(), COOLDOWN),
    0
  );
});

test("cache purge cooldown: just purged → full window remaining", () => {
  const last = new Date("2026-06-02T00:00:00Z");
  const now = new Date("2026-06-02T00:00:00Z"); // same instant
  assert.equal(cachePurgeCooldownRemainingMs(last, now, COOLDOWN), 60_000);
  assert.equal(cachePurgeCooldownRemainingSeconds(last, now, COOLDOWN), 60);
});

test("cache purge cooldown: partway through → remaining counts down", () => {
  const last = new Date("2026-06-02T00:00:00Z");
  const now = new Date("2026-06-02T00:00:25Z"); // 25s later
  assert.equal(cachePurgeCooldownRemainingMs(last, now, COOLDOWN), 35_000);
  assert.equal(cachePurgeCooldownRemainingSeconds(last, now, COOLDOWN), 35);
});

test("cache purge cooldown: rounds partial seconds UP (retry-after is safe)", () => {
  const last = new Date("2026-06-02T00:00:00.000Z");
  const now = new Date("2026-06-02T00:00:59.300Z"); // 0.7s left
  assert.equal(cachePurgeCooldownRemainingMs(last, now, COOLDOWN), 700);
  assert.equal(cachePurgeCooldownRemainingSeconds(last, now, COOLDOWN), 1);
});

test("cache purge cooldown: exactly elapsed → allowed", () => {
  const last = new Date("2026-06-02T00:00:00Z");
  const now = new Date("2026-06-02T00:01:00Z"); // exactly 60s
  assert.equal(cachePurgeCooldownRemainingMs(last, now, COOLDOWN), 0);
});

test("cache purge cooldown: well past window → allowed", () => {
  const last = new Date("2026-06-02T00:00:00Z");
  const now = new Date("2026-06-02T01:00:00Z");
  assert.equal(cachePurgeCooldownRemainingMs(last, now, COOLDOWN), 0);
  assert.equal(cachePurgeCooldownRemainingSeconds(last, now, COOLDOWN), 0);
});

test("cache purge cooldown: clock skew (now < last) never goes negative", () => {
  const last = new Date("2026-06-02T00:01:00Z");
  const now = new Date("2026-06-02T00:00:00Z"); // 60s before last
  const remaining = cachePurgeCooldownRemainingMs(last, now, COOLDOWN);
  assert.ok(remaining >= 0);
  assert.equal(remaining, 120_000); // cooldown + the 60s skew
});
