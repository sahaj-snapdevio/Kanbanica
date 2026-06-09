import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type BuildManifestInput,
  buildManifest,
  CUBE_ARCHIVE_FORMAT,
  MAX_MANIFEST_BYTES,
  parseAndValidateManifest,
} from "@/lib/storage/cube-archive/manifest";

const GIB = 1024 * 1024 * 1024;
const SHA = "a".repeat(64);

function input(over: Partial<BuildManifestInput> = {}): BuildManifestInput {
  return {
    exportedAt: new Date("2026-05-31T00:00:00.000Z"),
    source: { cubeId: "c1", cubeName: "web", spaceId: "s1" },
    config: { vcpus: 2, ramMb: 2048, diskLimitGb: 10, imageId: "ubuntu-2404" },
    rootfs: {
      filename: "rootfs.ext4",
      compressedSizeBytes: 5 * GIB,
      uncompressedSizeBytes: 10 * GIB, // matches diskLimitGb=10
      sha256: SHA,
    },
    ...over,
  };
}

test("buildManifest → parseAndValidateManifest round-trips cleanly", () => {
  const json = buildManifest(input());
  const parsed = JSON.parse(json);
  assert.equal(parsed.format, CUBE_ARCHIVE_FORMAT);

  const { value, rangeIssues } = parseAndValidateManifest(json);
  assert.equal(
    rangeIssues.length,
    0,
    `unexpected range issues: ${rangeIssues}`
  );
  assert.equal(value.config.vcpus, 2);
  assert.equal(value.rootfs.compression, "zstd");
  assert.equal(value.source.platform, "krova-cloud");
});

test("parseAndValidateManifest: rejects a wrong format tag", () => {
  const json = buildManifest(input());
  const bad = JSON.parse(json);
  bad.format = "krova-cube-v999";
  assert.throws(() => parseAndValidateManifest(JSON.stringify(bad)));
});

test("parseAndValidateManifest: rejects a missing required field", () => {
  const json = buildManifest(input());
  const bad = JSON.parse(json);
  bad.config.imageId = undefined;
  assert.throws(() => parseAndValidateManifest(JSON.stringify(bad)));
});

test("parseAndValidateManifest: rejects a malformed sha256", () => {
  const json = buildManifest(input());
  const bad = JSON.parse(json);
  bad.rootfs.sha256 = "not-a-hash";
  assert.throws(() => parseAndValidateManifest(JSON.stringify(bad)), /hex/i);
});

test("parseAndValidateManifest: rejects non-JSON and oversize payloads", () => {
  assert.throws(() => parseAndValidateManifest("{not json"), /valid JSON/i);
  const huge = `"${"x".repeat(MAX_MANIFEST_BYTES + 10)}"`;
  assert.throws(() => parseAndValidateManifest(huge), /max/i);
});

test("parseAndValidateManifest: out-of-range vcpus is a WARNING, not a throw", () => {
  // vcpus=99 is a positive int (passes Zod) but outside CPU_OPTIONS → a range
  // issue the import UI surfaces, NOT a hard failure.
  const json = buildManifest(
    input({
      config: {
        vcpus: 99,
        ramMb: 2048,
        diskLimitGb: 10,
        imageId: "ubuntu-2404",
      },
    })
  );
  const { rangeIssues } = parseAndValidateManifest(json);
  assert.ok(
    rangeIssues.some((r) => r.includes("vcpus")),
    `missing vcpus warning: ${rangeIssues}`
  );
});

test("parseAndValidateManifest: rootfs size not matching diskLimitGb is a warning", () => {
  const json = buildManifest(
    input({
      config: {
        vcpus: 2,
        ramMb: 2048,
        diskLimitGb: 10,
        imageId: "ubuntu-2404",
      },
      rootfs: {
        filename: "rootfs.ext4",
        compressedSizeBytes: 5 * GIB,
        uncompressedSizeBytes: 9 * GIB, // ≠ 10 GiB
        sha256: SHA,
      },
    })
  );
  const { rangeIssues } = parseAndValidateManifest(json);
  assert.ok(
    rangeIssues.some((r) => r.includes("does not match")),
    `missing size-mismatch warning: ${rangeIssues}`
  );
});
