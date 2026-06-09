/**
 * Client-side `.cube` manifest extractor.
 *
 * Reads the FIRST ~64 KB of a `.cube` file directly in the browser
 * (no upload) to extract `manifest.json`. Used by the import sheet
 * to preview the archive's configuration BEFORE the customer commits
 * to uploading multiple GB.
 *
 * The `.cube` archive is plain (uncompressed) tar with three entries
 * always written in this order by `host-build.ts`:
 *
 *   1. manifest.json     ← <2 KB, what we read here
 *   2. rootfs.ext4.zst   ← bulk
 *   3. checksums.txt
 *
 * USTAR header layout (512 bytes per entry):
 *   offset 0     name (100)
 *   offset 100   mode (8 octal)
 *   offset 108   uid (8 octal)
 *   offset 116   gid (8 octal)
 *   offset 124   size (12 octal)        ← what we need
 *   offset 136   mtime (12 octal)
 *   offset 148   checksum (8)
 *   offset 156   typeflag (1)
 *   offset 257   "ustar\0" magic (6)
 *
 * After the 512-byte header, the file content follows, rounded up to
 * the next 512-byte boundary.
 */

const TAR_BLOCK_SIZE = 512;
const MAX_READ_BYTES = 256 * 1024; // 256 KB — bigger than any reasonable manifest

/** Parsed manifest fields the UI needs to populate the form. The
 *  shape is intentionally narrow (only what the import sheet uses) —
 *  the full schema lives in `manifest.ts` and is re-validated
 *  server-side. */
export interface ClientPreviewManifest {
  config: {
    vcpus: number;
    ramMb: number;
    diskLimitGb: number;
    imageId: string;
    userData: string | null;
    kernelArgs: string | null;
  };
  exportedAt: string;
  format: string;
  rootfs: {
    filename: string;
    compressedSizeBytes: number;
    uncompressedSizeBytes: number;
    compression: string;
    sha256: string;
  };
  source: {
    cubeId: string;
    cubeName: string;
    spaceId: string;
  };
}

/**
 * Parse a chunk of a `.cube` file (the first N bytes) and return the
 * extracted manifest. Throws on malformed archives.
 *
 * Safe against pathological inputs: hard-bounded read window, every
 * length is checked against the buffer size, and the manifest entry
 * is rejected if it isn't literally the first file in the tar.
 */
export function parseCubeManifestFromBuffer(
  buffer: ArrayBuffer
): ClientPreviewManifest {
  if (buffer.byteLength < TAR_BLOCK_SIZE) {
    throw new Error("File is too small to be a valid .cube archive");
  }
  const view = new Uint8Array(buffer);

  // Read the first 512-byte tar header.
  const name = readNullTerminatedString(view, 0, 100);
  if (name !== "manifest.json") {
    throw new Error(
      `Expected first archive entry to be "manifest.json", got "${name}"`
    );
  }

  const ustarMagic = readNullTerminatedString(view, 257, 6);
  if (!ustarMagic.startsWith("ustar")) {
    throw new Error(
      "File is not a USTAR tar archive (missing ustar magic) — not a .cube file"
    );
  }

  const sizeStr = readNullTerminatedString(view, 124, 12);
  const manifestSize = Number.parseInt(sizeStr.trim(), 8);
  if (!Number.isFinite(manifestSize) || manifestSize <= 0) {
    throw new Error(`Invalid manifest.json size in tar header: "${sizeStr}"`);
  }
  if (manifestSize > 64 * 1024) {
    throw new Error(`manifest.json reports ${manifestSize} bytes; max 64 KB`);
  }
  const manifestEnd = TAR_BLOCK_SIZE + manifestSize;
  if (manifestEnd > view.length) {
    throw new Error(
      "Manifest extends past the read window — read more bytes or file is truncated"
    );
  }

  const manifestBytes = view.slice(TAR_BLOCK_SIZE, manifestEnd);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let manifestJson: string;
  try {
    manifestJson = decoder.decode(manifestBytes);
  } catch {
    throw new Error("manifest.json is not valid UTF-8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch (err) {
    throw new Error(
      `manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Narrow structural check — server-side does the full Zod
  // validation again, this just confirms enough is present that the
  // preview UI doesn't crash.
  const m = parsed as Partial<ClientPreviewManifest>;
  if (
    !m.format ||
    !m.source ||
    !m.config ||
    !m.rootfs ||
    typeof m.config.vcpus !== "number" ||
    typeof m.config.ramMb !== "number" ||
    typeof m.config.diskLimitGb !== "number" ||
    typeof m.config.imageId !== "string"
  ) {
    throw new Error(
      "Manifest is missing one or more required fields (format, source, config, rootfs)"
    );
  }

  return m as ClientPreviewManifest;
}

/**
 * Convenience wrapper that reads the first MAX_READ_BYTES of a
 * `File` and parses the manifest. Browser-only.
 */
export async function parseCubeManifestFromFile(
  file: File
): Promise<ClientPreviewManifest> {
  const readSize = Math.min(file.size, MAX_READ_BYTES);
  const blob = file.slice(0, readSize);
  const buffer = await blob.arrayBuffer();
  return parseCubeManifestFromBuffer(buffer);
}

function readNullTerminatedString(
  view: Uint8Array,
  offset: number,
  maxLen: number
): string {
  let end = offset;
  const max = Math.min(offset + maxLen, view.length);
  while (end < max && view[end] !== 0) {
    end++;
  }
  return new TextDecoder("utf-8").decode(view.slice(offset, end));
}
