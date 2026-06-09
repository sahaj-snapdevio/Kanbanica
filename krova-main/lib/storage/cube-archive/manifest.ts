/**
 * `.cube` archive manifest — schema, builder, and parser.
 *
 * The manifest is a small UTF-8 JSON file bundled inside every `.cube`
 * archive next to the rootfs blob. It carries the cube's configuration
 * (vcpus, RAM, disk, image, userData) plus integrity metadata (rootfs
 * sha256, sizes, compression) so an imported archive can be validated
 * end-to-end without trusting the wrapper.
 *
 * Why a versioned format: future schema changes (e.g. adding fields,
 * tightening ranges) need to reject incompatible older archives
 * cleanly. `format: "krova-cube-v1"` is the wire-format tag — a hard
 * mismatch fails import with a clear error.
 *
 * The single source of truth for the schema is the Zod definition
 * below. Builder + parser both reference it.
 */

import { z } from "zod";

import { CPU_OPTIONS, DISK_OPTIONS, RAM_OPTIONS } from "@/config/platform";
import { isValidRangeValue } from "@/lib/cube-options";

/** Wire-format tag — bump only on incompatible changes. */
export const CUBE_ARCHIVE_FORMAT = "krova-cube-v1" as const;

/** Hard cap on manifest.json size. Anything above this is rejected at
 *  parse time as a defense against pathological archives. */
export const MAX_MANIFEST_BYTES = 64 * 1024;

const sha256Regex = /^[a-f0-9]{64}$/;

const manifestSchema = z.object({
  format: z.literal(CUBE_ARCHIVE_FORMAT),
  exportedAt: z.string().min(1).max(64),
  source: z.object({
    platform: z.string().min(1).max(64),
    platformVersion: z.string().min(1).max(128).optional().nullable(),
    cubeId: z.string().min(1).max(64),
    cubeName: z.string().min(1).max(128),
    spaceId: z.string().min(1).max(64),
  }),
  config: z.object({
    vcpus: z.number().int().positive(),
    ramMb: z.number().int().positive(),
    diskLimitGb: z.number().int().positive(),
    imageId: z.string().min(1).max(64),
    userData: z
      .string()
      .max(16 * 1024)
      .nullable(),
    kernelArgs: z
      .string()
      .max(4 * 1024)
      .nullable(),
  }),
  rootfs: z.object({
    filename: z.string().min(1).max(128),
    compressedSizeBytes: z.number().int().positive(),
    uncompressedSizeBytes: z.number().int().positive(),
    compression: z.literal("zstd"),
    sha256: z.string().regex(sha256Regex, "must be 64 lowercase hex chars"),
  }),
});

export type CubeArchiveManifest = z.infer<typeof manifestSchema>;

/** Inputs to build a manifest at export time. Mirrors the existing
 *  `cube_backups.cubeConfig` shape where it overlaps. */
export interface BuildManifestInput {
  config: {
    vcpus: number;
    ramMb: number;
    diskLimitGb: number;
    imageId: string;
    userData?: string | null;
    kernelArgs?: string | null;
  };
  exportedAt?: Date;
  rootfs: {
    filename: string;
    compressedSizeBytes: number;
    uncompressedSizeBytes: number;
    sha256: string;
  };
  source: {
    cubeId: string;
    cubeName: string;
    spaceId: string;
    platformVersion?: string | null;
  };
}

/**
 * Serialize a manifest object to canonical JSON. Two-space indentation
 * for readability (an operator inspecting a `.cube` shouldn't need a
 * parser to read the metadata).
 */
export function buildManifest(input: BuildManifestInput): string {
  const manifest: CubeArchiveManifest = {
    format: CUBE_ARCHIVE_FORMAT,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    source: {
      platform: "krova-cloud",
      platformVersion: input.source.platformVersion ?? null,
      cubeId: input.source.cubeId,
      cubeName: input.source.cubeName,
      spaceId: input.source.spaceId,
    },
    config: {
      vcpus: input.config.vcpus,
      ramMb: input.config.ramMb,
      diskLimitGb: input.config.diskLimitGb,
      imageId: input.config.imageId,
      userData: input.config.userData ?? null,
      kernelArgs: input.config.kernelArgs ?? null,
    },
    rootfs: {
      filename: input.rootfs.filename,
      compressedSizeBytes: input.rootfs.compressedSizeBytes,
      uncompressedSizeBytes: input.rootfs.uncompressedSizeBytes,
      compression: "zstd",
      sha256: input.rootfs.sha256,
    },
  };
  // Validate what we're about to write — guards against any builder bug
  // shipping a malformed archive that subsequent imports would reject.
  manifestSchema.parse(manifest);
  return JSON.stringify(manifest, null, 2);
}

/**
 * Result of `parseAndValidateManifest`. `value` is the validated
 * manifest; `rangeIssues` lists any out-of-range values that need
 * customer attention (these are flagged but do not throw — the import
 * UI surfaces them as live plan-limit warnings).
 */
export interface ParsedManifest {
  rangeIssues: string[];
  value: CubeArchiveManifest;
}

/**
 * Parse + validate a manifest.json string. Throws on hard structural
 * problems (missing fields, wrong format tag, oversized payload); the
 * range issues for vcpus/ramMb/diskLimitGb against the platform's
 * advertised ranges are returned as warnings so the import UI can show
 * them inline rather than failing the whole import.
 *
 * Plan-tier limits are NOT checked here — they are space-specific and
 * checked by the import server action against `EffectiveLimits`.
 */
export function parseAndValidateManifest(jsonText: string): ParsedManifest {
  if (jsonText.length > MAX_MANIFEST_BYTES) {
    throw new Error(
      `Manifest is ${jsonText.length} bytes; max ${MAX_MANIFEST_BYTES} bytes`
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Manifest is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const value = manifestSchema.parse(raw);

  // Platform-range validation (separate from plan-tier validation).
  const rangeIssues: string[] = [];
  if (!isValidRangeValue(value.config.vcpus, CPU_OPTIONS)) {
    rangeIssues.push(
      `vcpus=${value.config.vcpus} is outside the supported range`
    );
  }
  if (!isValidRangeValue(value.config.ramMb, RAM_OPTIONS)) {
    rangeIssues.push(
      `ramMb=${value.config.ramMb} is outside the supported range`
    );
  }
  if (!isValidRangeValue(value.config.diskLimitGb, DISK_OPTIONS)) {
    rangeIssues.push(
      `diskLimitGb=${value.config.diskLimitGb} is outside the supported range`
    );
  }

  // Rootfs size must match the disk limit exactly — a Firecracker rootfs
  // is a fixed-size ext4 image equal to the cube's disk limit. A
  // mismatch means the archive is corrupt or hand-crafted.
  const expectedUncompressed = value.config.diskLimitGb * 1024 * 1024 * 1024;
  if (value.rootfs.uncompressedSizeBytes !== expectedUncompressed) {
    rangeIssues.push(
      `rootfs.uncompressedSizeBytes (${value.rootfs.uncompressedSizeBytes}) ` +
        `does not match config.diskLimitGb (${expectedUncompressed} bytes)`
    );
  }

  return { value, rangeIssues };
}
