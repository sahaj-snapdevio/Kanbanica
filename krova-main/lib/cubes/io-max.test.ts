import assert from "node:assert/strict";
import { test } from "node:test";
import { buildIoMaxLine } from "@/lib/cubes/io-max";

const L = { wbps: 62_914_560, rbps: 62_914_560, wiops: 8000, riops: 8000 };

test("buildIoMaxLine joins device + bytes + iops in one line (cgroup merges partials)", () => {
  assert.equal(
    buildIoMaxLine("253:0", L),
    "253:0 wbps=62914560 rbps=62914560 wiops=8000 riops=8000"
  );
});

test("buildIoMaxLine rounds fractional values", () => {
  assert.equal(
    buildIoMaxLine("253:0", {
      wbps: 62_914_560.7,
      rbps: 62_914_560.2,
      wiops: 8000.9,
      riops: 8000.1,
    }),
    "253:0 wbps=62914561 rbps=62914560 wiops=8001 riops=8000"
  );
});

test("buildIoMaxLine: malformed device → null (write nothing, never a bad cgroup line)", () => {
  assert.equal(buildIoMaxLine("sda", L), null);
  assert.equal(buildIoMaxLine("", L), null);
  assert.equal(buildIoMaxLine(null, L), null);
  assert.equal(buildIoMaxLine("253", L), null);
  assert.equal(buildIoMaxLine("253:0:1", L), null);
});

test("buildIoMaxLine: no valid axis → null", () => {
  assert.equal(buildIoMaxLine("253:0", null), null);
  assert.equal(
    buildIoMaxLine("253:0", { wbps: 0, rbps: 0, wiops: 0, riops: 0 }),
    null
  );
  assert.equal(buildIoMaxLine("253:0", {}), null);
});

test("buildIoMaxLine: bandwidth-only cap (iops unlimited) → only wbps/rbps", () => {
  assert.equal(
    buildIoMaxLine("253:0", { wbps: 62_914_560, rbps: 62_914_560 }),
    "253:0 wbps=62914560 rbps=62914560"
  );
});

test("buildIoMaxLine: iops-only cap (bandwidth unlimited) → only wiops/riops", () => {
  assert.equal(
    buildIoMaxLine("253:0", { wiops: 8000, riops: 8000 }),
    "253:0 wiops=8000 riops=8000"
  );
});

test("buildIoMaxLine: a half-specified axis is dropped (both keys of an axis required)", () => {
  // wbps valid but rbps missing → bandwidth axis omitted; ops axis still emits.
  assert.equal(
    buildIoMaxLine("253:0", { wbps: 1, wiops: 8000, riops: 8000 }),
    "253:0 wiops=8000 riops=8000"
  );
  // a NaN in one axis drops that axis only, not the whole line.
  assert.equal(
    buildIoMaxLine("253:0", { wbps: Number.NaN, rbps: 1, wiops: 5, riops: 5 }),
    "253:0 wiops=5 riops=5"
  );
});
