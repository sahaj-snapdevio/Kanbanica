/**
 * Host-side `.cube` archive construction.
 *
 * The worker never holds rootfs bytes (Rule 24) — every byte of the
 * archive is produced on the bare-metal host the source cube lives on
 * and uploaded directly from there to S3. This module exposes a single
 * orchestrator that runs the per-step shell commands over SSH:
 *
 *   1. zstd-compress the live rootfs (`rootfs.ext4` → `rootfs.ext4.zst`)
 *   2. sha256sum the compressed file
 *   3. write `manifest.json` (passed in by the worker) via base64-decode
 *      to avoid heredoc-quoting traps (CLAUDE.md Rule 39)
 *   4. sha256sum the manifest
 *   5. write `checksums.txt` covering both files
 *   6. `tar -cf <backupId>.cube manifest.json rootfs.ext4.zst checksums.txt`
 *   7. clean up the loose files; leave only the `.cube`
 *
 * The caller is responsible for uploading the produced `.cube` via
 * `s3HostUpload` and then `rm -f`'ing the host-side copy.
 */

import type { Client } from "ssh2";

import {
  DISK_IO_STORAGE_TUNING_ENABLED,
  DISK_ZSTD_THREADS,
} from "@/config/platform";
import { ioNicePrefix } from "@/lib/io-nice";
import { execCommand, shellEscape } from "@/lib/ssh";
import {
  type BuildManifestInput,
  buildManifest,
} from "@/lib/storage/cube-archive/manifest";
import { zstdCompressCommand } from "@/lib/storage/cube-archive/zstd-commands";

export interface BuildCubeArchiveInput {
  /** Bare filename of the produced archive (typically `<backupId>.cube`). */
  archiveFilename: string;
  /** Manifest source data — minus the rootfs sha256/sizes, which this
   *  module computes from the actual compressed file. */
  manifestSource: Omit<BuildManifestInput, "rootfs"> & {
    rootfsCompressedFilename?: string;
  };
  /** Bare filename of the live rootfs (typically `rootfs.ext4`). */
  rootfsFilename: string;
  /** Total SSH timeout for the entire build. Default 30 min — covers
   *  ~50 GB rootfs at typical bare-metal disk speeds. */
  timeoutMs?: number;
  /** Cube working dir on the host. The rootfs and intermediate files
   *  all live here so the cleanup is local to one directory. */
  workingDir: string;
  /** Custom zstd compression level. Defaults to 1 — matches existing
   *  backup.create choice (fast, low memory; ~10-20% larger than -19
   *  but completes in a fraction of the time on big rootfs). */
  zstdLevel?: number;
}

export interface BuildCubeArchiveResult {
  archivePath: string;
  archiveSizeBytes: number;
  rootfsCompressedSizeBytes: number;
  rootfsSha256: string;
  rootfsUncompressedSizeBytes: number;
}

/**
 * Build a `.cube` archive on the host. Returns the absolute path and
 * size metadata so the caller can record `cube_backups.sizeBytes` and
 * the manifest's rootfs section.
 *
 * On any failure, the function attempts a best-effort cleanup of
 * intermediate files (`*.ext4.zst`, `manifest.json`, `checksums.txt`,
 * and the partially-built `.cube`) before re-throwing.
 */
export async function buildCubeArchive(
  client: Client,
  input: BuildCubeArchiveInput
): Promise<BuildCubeArchiveResult> {
  const workingDir = input.workingDir;
  const rootfsFilename = input.rootfsFilename;
  const compressedFilename =
    input.manifestSource.rootfsCompressedFilename ?? "rootfs.ext4.zst";
  const archiveFilename = input.archiveFilename;
  const zstdLevel = input.zstdLevel ?? 1;
  const timeoutMs = input.timeoutMs ?? 1_800_000;

  const compressedPath = `${workingDir}/${compressedFilename}`;
  const rootfsPath = `${workingDir}/${rootfsFilename}`;
  const manifestPath = `${workingDir}/manifest.json`;
  const checksumsPath = `${workingDir}/checksums.txt`;
  const archivePath = `${workingDir}/${archiveFilename}`;

  const cleanup = async () => {
    await execCommand(
      client,
      `rm -f ${shellEscape(compressedPath)} ${shellEscape(manifestPath)} ${shellEscape(checksumsPath)}`,
      30_000
    ).catch(() => {});
  };

  try {
    // 1. Measure live rootfs size BEFORE compression — needed for the
    //    manifest. A Firecracker rootfs is a fixed-size ext4 image
    //    equal to the cube's `diskLimitGb`.
    const rootfsStat = await execCommand(
      client,
      `stat -c %s ${shellEscape(rootfsPath)}`,
      10_000
    );
    if (rootfsStat.exitCode !== 0) {
      throw new Error(
        `Failed to stat rootfs at ${rootfsPath}: ${rootfsStat.stderr}`
      );
    }
    const rootfsUncompressedSizeBytes = Number.parseInt(
      rootfsStat.stdout.trim(),
      10
    );
    if (
      !Number.isFinite(rootfsUncompressedSizeBytes) ||
      rootfsUncompressedSizeBytes <= 0
    ) {
      throw new Error(
        `Rootfs at ${rootfsPath} reports invalid size: ${rootfsStat.stdout.trim()}`
      );
    }

    // 1b. ext4 sanity gate (audit M1). For an export/promote build the rootfs
    //     is freshly `restic dump`-ed; a `dump > file` redirect can fail to
    //     write the full image (e.g. host disk full mid-write) while restic's
    //     own pipe still closes clean, yielding a truncated/garbage file. Left
    //     unchecked it packages as a `complete` backup whose corruption only
    //     surfaces at a future restore. Assert the file is an ext-family
    //     filesystem BEFORE compressing so a bad dump fails the build now. (For
    //     a live-rootfs backup this always passes.) `host-extract` runs the
    //     same gate on the consume side.
    const fsCheck = await execCommand(
      client,
      `file -b ${shellEscape(rootfsPath)}`,
      10_000
    );
    if (!/ext[234] filesystem/i.test(fsCheck.stdout)) {
      throw new Error(
        `Rootfs at ${rootfsPath} is not a valid ext filesystem — refusing to build a corrupt archive (file: ${fsCheck.stdout.trim().slice(0, 200)})`
      );
    }

    // 2. Compress rootfs with zstd. -T0 = all cores; -f = overwrite if
    //    a stale file from a prior failed run is still around. Disk overhaul F:
    //    when enabled, cap zstd threads (DISK_ZSTD_THREADS; 0 still = all) +
    //    ionice/nice so a backup's compression doesn't saturate every core +
    //    the disk against co-tenant cubes. Flag-off = `-T0`, no ionice.
    const compress = await execCommand(
      client,
      zstdCompressCommand({
        ionicePrefix: ioNicePrefix(),
        rootfsPath,
        compressedPath,
        level: zstdLevel,
        threads: DISK_IO_STORAGE_TUNING_ENABLED ? DISK_ZSTD_THREADS : 0,
      }),
      timeoutMs
    );
    if (compress.exitCode !== 0) {
      throw new Error(`zstd compression failed: ${compress.stderr}`);
    }

    // 3. Compressed size + sha256.
    const compressedStat = await execCommand(
      client,
      `stat -c %s ${shellEscape(compressedPath)}`,
      10_000
    );
    if (compressedStat.exitCode !== 0) {
      throw new Error(
        `Failed to stat compressed rootfs: ${compressedStat.stderr}`
      );
    }
    const rootfsCompressedSizeBytes = Number.parseInt(
      compressedStat.stdout.trim(),
      10
    );
    if (
      !Number.isFinite(rootfsCompressedSizeBytes) ||
      rootfsCompressedSizeBytes <= 0
    ) {
      throw new Error(
        `Compressed rootfs reports invalid size: ${compressedStat.stdout.trim()}`
      );
    }
    const compressedSha = await execCommand(
      client,
      `sha256sum ${shellEscape(compressedPath)}`,
      120_000
    );
    if (compressedSha.exitCode !== 0) {
      throw new Error(
        `sha256sum failed on compressed rootfs: ${compressedSha.stderr}`
      );
    }
    const rootfsSha256 = compressedSha.stdout.trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{64}$/.test(rootfsSha256)) {
      throw new Error(
        `Unexpected sha256sum output: ${compressedSha.stdout.slice(0, 200)}`
      );
    }

    // 4. Build the manifest JSON in the worker (single-source schema),
    //    write it to the host via base64 — avoids heredoc apostrophe
    //    quoting traps (Rule 39).
    const manifestJson = buildManifest({
      ...input.manifestSource,
      rootfs: {
        filename: compressedFilename,
        compressedSizeBytes: rootfsCompressedSizeBytes,
        uncompressedSizeBytes: rootfsUncompressedSizeBytes,
        sha256: rootfsSha256,
      },
    });
    const manifestB64 = Buffer.from(manifestJson, "utf8").toString("base64");
    const writeManifest = await execCommand(
      client,
      `echo ${shellEscape(manifestB64)} | base64 -d > ${shellEscape(manifestPath)}`,
      30_000
    );
    if (writeManifest.exitCode !== 0) {
      throw new Error(`Failed to write manifest.json: ${writeManifest.stderr}`);
    }

    // 5. Build checksums.txt (sha256sum format). We `cd` into the
    //    working dir so the output records bare filenames — matches
    //    how the file will look after `tar xf` into a fresh dir on
    //    the import side.
    const buildChecksums = await execCommand(
      client,
      `cd ${shellEscape(workingDir)} && sha256sum ${shellEscape(compressedFilename)} manifest.json > checksums.txt`,
      120_000
    );
    if (buildChecksums.exitCode !== 0) {
      throw new Error(
        `Failed to build checksums.txt: ${buildChecksums.stderr}`
      );
    }

    // 6. Bundle into the .cube archive. Plain tar — no outer
    //    compression because the rootfs is already zstd. The `-C`
    //    flag keeps entry names bare (no leading paths), so an
    //    importer extracting into a fresh dir gets exactly the 3
    //    expected files at the dir's root.
    const tar = await execCommand(
      client,
      `tar -cf ${shellEscape(archivePath)} -C ${shellEscape(workingDir)} manifest.json ${shellEscape(compressedFilename)} checksums.txt`,
      timeoutMs
    );
    if (tar.exitCode !== 0) {
      throw new Error(`tar failed: ${tar.stderr}`);
    }

    // 7. Archive size for the caller's storage accounting.
    const archiveStat = await execCommand(
      client,
      `stat -c %s ${shellEscape(archivePath)}`,
      10_000
    );
    if (archiveStat.exitCode !== 0) {
      throw new Error(`Failed to stat archive: ${archiveStat.stderr}`);
    }
    const archiveSizeBytes = Number.parseInt(archiveStat.stdout.trim(), 10);
    if (!Number.isFinite(archiveSizeBytes) || archiveSizeBytes <= 0) {
      throw new Error(
        `Archive reports invalid size: ${archiveStat.stdout.trim()}`
      );
    }

    // 8. Cleanup intermediates ONLY on success — failure path's
    //    `cleanup` runs in the catch block plus removes the partial
    //    archive too.
    await cleanup();

    return {
      archivePath,
      archiveSizeBytes,
      rootfsCompressedSizeBytes,
      rootfsUncompressedSizeBytes,
      rootfsSha256,
    };
  } catch (err) {
    await cleanup();
    // Remove a partial .cube too — the caller may not know we got far
    // enough to start `tar`.
    await execCommand(
      client,
      `rm -f ${shellEscape(archivePath)}`,
      30_000
    ).catch(() => {});
    throw err;
  }
}
