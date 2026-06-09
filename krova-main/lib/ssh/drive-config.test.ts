import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRootfsDriveBody } from "@/lib/ssh/drive-config";

test("flag-off (cacheWriteback=false, no limiter) → byte-identical 4-key body", () => {
  const body = buildRootfsDriveBody({
    pathOnHost: "/var/lib/krova/cubes/x/rootfs.ext4",
    cacheWriteback: false,
  });
  // Exactly the keys the inline PUT body has today — no cache_type, no io_engine,
  // no rate_limiter. Deep-equal asserts there are no extra keys.
  assert.deepEqual(body, {
    drive_id: "rootfs",
    path_on_host: "/var/lib/krova/cubes/x/rootfs.ext4",
    is_root_device: true,
    is_read_only: false,
  });
  assert.equal("cache_type" in body, false);
  assert.equal("io_engine" in body, false);
  assert.equal("rate_limiter" in body, false);
});

test("flag-on (cacheWriteback=true) adds cache_type:Writeback, nothing else", () => {
  const body = buildRootfsDriveBody({ pathOnHost: "/x", cacheWriteback: true });
  assert.deepEqual(body, {
    drive_id: "rootfs",
    path_on_host: "/x",
    is_root_device: true,
    is_read_only: false,
    cache_type: "Writeback",
  });
});

test("rate_limiter is spread only when a (pre-validated) object is supplied", () => {
  const rl = {
    bandwidth: { size: 1000, refill_time: 1000, one_time_burst: 2000 },
    ops: { size: 100, refill_time: 1000, one_time_burst: 200 },
  };
  const withRl = buildRootfsDriveBody({
    pathOnHost: "/x",
    cacheWriteback: true,
    rateLimiter: rl,
  });
  assert.deepEqual(withRl.rate_limiter, rl);
  // null/undefined limiter → omitted (no key)
  assert.equal(
    "rate_limiter" in
      buildRootfsDriveBody({
        pathOnHost: "/x",
        cacheWriteback: true,
        rateLimiter: null,
      }),
    false
  );
});

test("is_read_only honored (read-only attach paths)", () => {
  const body = buildRootfsDriveBody({
    pathOnHost: "/x",
    cacheWriteback: false,
    isReadOnly: true,
  });
  assert.equal(body.is_read_only, true);
});
