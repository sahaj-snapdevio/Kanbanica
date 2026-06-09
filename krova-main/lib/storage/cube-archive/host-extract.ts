/**
 * Host-side `.cube` archive extraction.
 *
 * Counterpart to `host-build.ts`. Given a `.cube` file already on the
 * host (downloaded from S3 via rclone), this orchestrator:
 *
 *   1. Lists the archive's contents and verifies it contains EXACTLY
 *      the three expected files with no nested directories and no
 *      path-traversal entries (`..`, absolute paths, etc.). A bad
 *      archive is rejected before any extraction touches the host fs.
 *   2. Extracts into a dedicated work directory.
 *   3. Verifies `checksums.txt` (covers both the compressed rootfs
 *      and the manifest).
 *   4. Reads + parses the manifest via the shared Zod schema.
 *   5. Decompresses the rootfs to `<targetDir>/rootfs.ext4`.
 *   6. Runs `file rootfs.ext4` as a sanity check that the decompressed
 *      payload is genuinely ext4.
 *   7. Cleans up the intermediate files (compressed blob + manifest +
 *      checksums + the archive itself if `keepArchive=false`).
 *
 * On any failure, intermediate files are removed before re-throwing.
 */

import type { Client } from "ssh2";

import { ioNicePrefix } from "@/lib/io-nice";
import { execCommand, shellEscape } from "@/lib/ssh";
import {
  CUBE_ARCHIVE_FORMAT,
  MAX_MANIFEST_BYTES,
  type ParsedManifest,
  parseAndValidateManifest,
} from "@/lib/storage/cube-archive/manifest";
import { zstdDecompressCommand } from "@/lib/storage/cube-archive/zstd-commands";

export interface ExtractCubeArchiveInput {
  /** Absolute path to the `.cube` on the host. */
  archivePath: string;
  /** If true, leave `archivePath` in place after extraction. Default
   *  false — the archive is consumed and removed once decompressed. */
  keepArchive?: boolean;
  /** Final destination dir for `rootfs.ext4`. Created if missing. */
  targetDir: string;
  timeoutMs?: number;
  /** Dir to extract intermediate files into. Created if missing. */
  workDir: string;
}

export interface ExtractCubeArchiveResult {
  manifest: ParsedManifest["value"];
  rangeIssues: string[];
  rootfsPath: string;
  rootfsSizeBytes: number;
}

const EXPECTED_ENTRIES = ["manifest.json", "checksums.txt"] as const;

// Strict allowlist of characters that may appear in a `.cube` archive
// entry name. We control archive authoring, so legitimate entries only
// ever contain `[a-zA-Z0-9._-]`. Anything else (NULs, control chars,
// Unicode look-alikes, glob metachars, leading dots, embedded `..`) is
// rejected before extraction. Matches manifest.json, checksums.txt,
// rootfs.ext4.zst (audit L3, 2026-05-24).
const SAFE_ENTRY_NAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,126}[a-zA-Z0-9])?$/;

function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.length > 128) {
    return false;
  }
  // Belt and suspenders — even though the regex below catches these, the
  // explicit checks make intent obvious to a future reader.
  if (name.startsWith("/") || name.startsWith("./") || name.startsWith("../")) {
    return false;
  }
  if (name.includes("..")) {
    return false;
  }
  if (name.includes("/")) {
    return false;
  }
  if (!SAFE_ENTRY_NAME_RE.test(name)) {
    return false;
  }
  return true;
}

export async function extractCubeArchive(
  client: Client,
  input: ExtractCubeArchiveInput
): Promise<ExtractCubeArchiveResult> {
  const archivePath = input.archivePath;
  const workDir = input.workDir;
  const targetDir = input.targetDir;
  const timeoutMs = input.timeoutMs ?? 1_800_000;

  const manifestPath = `${workDir}/manifest.json`;
  const checksumsPath = `${workDir}/checksums.txt`;
  const rootfsPath = `${targetDir}/rootfs.ext4`;

  // Locate the compressed rootfs filename. Whatever the manifest
  // declares (typically `rootfs.ext4.zst`) wins; we validate it
  // matches the tar listing.
  let compressedFilename: string | null = null;
  const compressedPath = () =>
    compressedFilename === null ? null : `${workDir}/${compressedFilename}`;

  const cleanup = async () => {
    const pathsToWipe = [manifestPath, checksumsPath];
    const c = compressedPath();
    if (c) {
      pathsToWipe.push(c);
    }
    if (pathsToWipe.length > 0) {
      await execCommand(
        client,
        `rm -f ${pathsToWipe.map(shellEscape).join(" ")}`,
        30_000
      ).catch(() => {});
    }
  };

  try {
    // 0. Ensure both dirs exist.
    await execCommand(
      client,
      `mkdir -p ${shellEscape(workDir)} ${shellEscape(targetDir)}`,
      10_000
    );

    // 1. List archive entries (verify shape before extraction).
    //    `tar -tf` prints one entry per line. We require exactly 3
    //    bare-name entries; any directory, leading slash, or `..`
    //    component is a hard reject.
    const list = await execCommand(
      client,
      `tar -tf ${shellEscape(archivePath)}`,
      60_000
    );
    if (list.exitCode !== 0) {
      throw new Error(
        `Failed to list archive contents: ${list.stderr || list.stdout}`
      );
    }
    const entries = list.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (entries.length !== 3) {
      throw new Error(
        `Archive must contain exactly 3 entries, got ${entries.length}: ${entries.join(", ")}`
      );
    }
    for (const entry of entries) {
      if (!isSafeEntryName(entry)) {
        throw new Error(`Unsafe archive entry: ${entry}`);
      }
    }
    // Must contain manifest.json + checksums.txt + one *.ext4.zst.
    for (const required of EXPECTED_ENTRIES) {
      if (!entries.includes(required)) {
        throw new Error(`Archive is missing required entry: ${required}`);
      }
    }
    const rootfsCandidates = entries.filter(
      (e) => !EXPECTED_ENTRIES.includes(e as (typeof EXPECTED_ENTRIES)[number])
    );
    if (rootfsCandidates.length !== 1) {
      throw new Error(
        `Archive must contain exactly one rootfs blob, got ${rootfsCandidates.length}`
      );
    }
    if (!/\.ext4\.zst$/.test(rootfsCandidates[0])) {
      throw new Error(
        `Rootfs blob must end in .ext4.zst, got: ${rootfsCandidates[0]}`
      );
    }
    compressedFilename = rootfsCandidates[0];

    // 2. Extract into the work dir. `--no-same-owner` keeps the host
    //    from honoring uid/gid baked into the tar header. `-C` puts
    //    everything in `workDir`.
    const extract = await execCommand(
      client,
      `tar -xf ${shellEscape(archivePath)} -C ${shellEscape(workDir)} --no-same-owner --no-same-permissions`,
      timeoutMs
    );
    if (extract.exitCode !== 0) {
      throw new Error(`tar extract failed: ${extract.stderr}`);
    }

    // 3. Verify checksums (covers compressed rootfs + manifest).
    const verify = await execCommand(
      client,
      `cd ${shellEscape(workDir)} && sha256sum -c checksums.txt`,
      300_000
    );
    if (verify.exitCode !== 0) {
      throw new Error(
        `Checksum verification failed: ${verify.stderr || verify.stdout}`
      );
    }

    // 4. Read manifest (cat through a size guard).
    const manifestStat = await execCommand(
      client,
      `stat -c %s ${shellEscape(manifestPath)}`,
      10_000
    );
    if (manifestStat.exitCode !== 0) {
      throw new Error(`Failed to stat manifest: ${manifestStat.stderr}`);
    }
    const manifestSize = Number.parseInt(manifestStat.stdout.trim(), 10);
    if (!Number.isFinite(manifestSize) || manifestSize <= 0) {
      throw new Error(
        `Manifest has invalid size: ${manifestStat.stdout.trim()}`
      );
    }
    if (manifestSize > MAX_MANIFEST_BYTES) {
      throw new Error(
        `Manifest is ${manifestSize} bytes; max ${MAX_MANIFEST_BYTES}`
      );
    }
    const manifestRead = await execCommand(
      client,
      `cat ${shellEscape(manifestPath)}`,
      30_000
    );
    if (manifestRead.exitCode !== 0) {
      throw new Error(`Failed to read manifest: ${manifestRead.stderr}`);
    }
    const parsed = parseAndValidateManifest(manifestRead.stdout);

    // Cross-check the manifest's declared rootfs filename + compressed
    // size against what we actually extracted.
    if (parsed.value.rootfs.filename !== compressedFilename) {
      throw new Error(
        `Manifest declares rootfs filename "${parsed.value.rootfs.filename}", archive contains "${compressedFilename}"`
      );
    }
    const compressedStat = await execCommand(
      client,
      `stat -c %s ${shellEscape(compressedPath()!)}`,
      10_000
    );
    if (compressedStat.exitCode !== 0) {
      throw new Error(
        `Failed to stat compressed rootfs: ${compressedStat.stderr}`
      );
    }
    const actualCompressedSize = Number.parseInt(
      compressedStat.stdout.trim(),
      10
    );
    if (actualCompressedSize !== parsed.value.rootfs.compressedSizeBytes) {
      throw new Error(
        `Compressed rootfs size mismatch: manifest=${parsed.value.rootfs.compressedSizeBytes}, actual=${actualCompressedSize}`
      );
    }

    // Belt-and-suspenders: ensure the format tag matches even though
    // the schema check would have already rejected an off-format
    // value. Keeps a clear error path when the schema changes later.
    if (parsed.value.format !== CUBE_ARCHIVE_FORMAT) {
      throw new Error(
        `Unsupported archive format: ${parsed.value.format} (expected ${CUBE_ARCHIVE_FORMAT})`
      );
    }

    // 5. Decompress the rootfs to the target dir. `-f` overwrites any
    //    stale `rootfs.ext4` left by a previous failed attempt. Disk overhaul F:
    //    ionice/nice when enabled so an import/redeploy decompress doesn't starve
    //    co-tenant cubes on the shared array. Flag-off = no prefix (byte-identical).
    const decompress = await execCommand(
      client,
      zstdDecompressCommand({
        ionicePrefix: ioNicePrefix(),
        compressedPath: compressedPath()!,
        rootfsPath,
      }),
      timeoutMs
    );
    if (decompress.exitCode !== 0) {
      throw new Error(`zstd decompression failed: ${decompress.stderr}`);
    }

    // 6. Stat the decompressed rootfs and verify it matches the
    //    manifest's uncompressed-size claim.
    const rootfsStat = await execCommand(
      client,
      `stat -c %s ${shellEscape(rootfsPath)}`,
      10_000
    );
    if (rootfsStat.exitCode !== 0) {
      throw new Error(
        `Failed to stat decompressed rootfs: ${rootfsStat.stderr}`
      );
    }
    const rootfsSizeBytes = Number.parseInt(rootfsStat.stdout.trim(), 10);
    if (rootfsSizeBytes !== parsed.value.rootfs.uncompressedSizeBytes) {
      throw new Error(
        `Decompressed rootfs size ${rootfsSizeBytes} does not match manifest ${parsed.value.rootfs.uncompressedSizeBytes}`
      );
    }

    // 7. Sanity check: `file` must report this is an ext4 filesystem.
    //    Catches the case where someone crafts a manifest claiming
    //    `compression: "zstd"` but the inner blob is something else.
    const fileCheck = await execCommand(
      client,
      `file -b ${shellEscape(rootfsPath)}`,
      30_000
    );
    if (fileCheck.exitCode !== 0) {
      throw new Error(`Failed to run file(1) on rootfs: ${fileCheck.stderr}`);
    }
    const fileOut = fileCheck.stdout.trim().toLowerCase();
    if (
      !fileOut.includes("ext4 filesystem") &&
      !fileOut.includes("ext2 filesystem")
    ) {
      throw new Error(
        `Decompressed rootfs is not an ext4 filesystem: ${fileCheck.stdout.trim().slice(0, 200)}`
      );
    }

    // 8. Cleanup intermediates on success.
    await cleanup();
    if (!input.keepArchive) {
      await execCommand(
        client,
        `rm -f ${shellEscape(archivePath)}`,
        30_000
      ).catch(() => {});
    }

    return {
      rootfsPath,
      rootfsSizeBytes,
      manifest: parsed.value,
      rangeIssues: parsed.rangeIssues,
    };
  } catch (err) {
    await cleanup();
    // Don't delete the partial rootfs.ext4 here — the caller's outer
    // catch handles full cube-workspace cleanup with the right
    // context (it knows whether other state still needs preserving).
    throw err;
  }
}
