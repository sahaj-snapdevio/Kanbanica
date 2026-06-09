/**
 * Disk write-speed benchmark for host disk-I/O tuning. The host-side command +
 * the pure parser/derivation live here; the worker runs the command on a CLEAN
 * host (install time, no cubes), parses the result, stores it as
 * `servers.disk_write_mbps`, and the tuning is DERIVED from it.
 *
 * Why clean-host only: a write benchmark on a host with running cubes both
 * UNDER-REPORTS (it competes with cube I/O so it measures available, not true,
 * throughput) and DISTURBS those cubes (a multi-GB write spike). The disk's
 * capability does not change over time, so we measure once when the host is empty
 * and reuse it. Servers without a measurement use the per-class heuristic.
 */

import {
  DISK_BENCHMARK_WRITE_MIB,
  DISK_DIRTY_BYTES_CAP,
  DISK_DIRTY_BYTES_FLOOR,
  DISK_DIRTY_POOL_SECONDS,
  DISK_SCRUB_BANDWIDTH_FRACTION,
  DISK_SCRUB_MIN_KBPS,
} from "@/config/platform";

/** Marker the command emits (instead of benchmarking) when the host has cubes. */
export const DISK_BENCH_SKIP_MARKER = "KROVA_BENCH_SKIP_HAS_CUBES";

/**
 * Host command: refuse to benchmark if the cube dir is non-empty (defense in
 * depth — install time is already cube-free), else write `DISK_BENCHMARK_WRITE_MIB`
 * MiB with O_DIRECT + fdatasync (bypasses the page cache → measures the device),
 * print dd's summary, and clean up. `storageRoot` is the cube-storage filesystem
 * (`/var/lib/krova`); the temp file is written there so the measurement reflects
 * the disk cubes actually use. `dd` is coreutils (Rule 46 exempt).
 */
export function diskBenchmarkCommand(storageRoot = "/var/lib/krova"): string {
  const cubes = `${storageRoot}/cubes`;
  const bench = `${storageRoot}/.krova-diskbench.tmp`;
  return [
    `if [ -n "$(ls -A "${cubes}" 2>/dev/null)" ]; then echo ${DISK_BENCH_SKIP_MARKER}; exit 0; fi`,
    `mkdir -p "${storageRoot}"`,
    `dd if=/dev/zero of="${bench}" bs=1M count=${DISK_BENCHMARK_WRITE_MIB} oflag=direct conv=fdatasync 2>&1`,
    `rm -f "${bench}"`,
  ].join("; ");
}

/**
 * Parse dd's summary into MB/s (10^6 bytes/s, computed from bytes + seconds so the
 * MB/s-vs-GB/s unit of dd's own rate field is irrelevant). Returns `null` on the
 * skip marker, an unparseable line, or a non-positive result — caller then stores
 * nothing and the tuning falls back to the per-class heuristic.
 */
export function parseDiskWriteMbps(
  ddOutput: string | null | undefined
): number | null {
  if (!ddOutput || ddOutput.includes(DISK_BENCH_SKIP_MARKER)) {
    return null;
  }
  // GNU dd: "2147483648 bytes (2.1 GB, 2.0 GiB) copied, 4.50631 s, 477 MB/s"
  const m = ddOutput.match(/(\d+)\s+bytes\b.*?copied,\s*([\d.]+)\s*s\b/i);
  if (!m) {
    return null;
  }
  const bytes = Number(m[1]);
  const secs = Number(m[2]);
  if (
    !Number.isFinite(bytes) ||
    !Number.isFinite(secs) ||
    bytes <= 0 ||
    secs <= 0
  ) {
    return null;
  }
  const mbps = Math.round(bytes / 1_000_000 / secs);
  return mbps > 0 ? mbps : null;
}

export type DiskTuningValues = {
  dirtyBytes: number;
  backgroundBytes: number;
  scrubKbps: number;
};

/**
 * Derive the host tuning from a measured write speed (MB/s). Dirty pool ≈ N
 * seconds of writeback (clamped) so a flush drains fast; background = pool / 4;
 * scrub cap ≈ a fraction of the write so the monthly RAID scrub yields to cubes.
 * `null` for a non-positive/non-finite input (caller uses the class heuristic).
 */
export function deriveDiskTuning(mbps: number): DiskTuningValues | null {
  if (!Number.isFinite(mbps) || mbps <= 0) {
    return null;
  }
  const raw = Math.round(mbps * 1_000_000 * DISK_DIRTY_POOL_SECONDS);
  const dirtyBytes = Math.min(
    Math.max(raw, DISK_DIRTY_BYTES_FLOOR),
    DISK_DIRTY_BYTES_CAP
  );
  return {
    dirtyBytes,
    backgroundBytes: Math.round(dirtyBytes / 4),
    scrubKbps: Math.max(
      Math.round(mbps * 1000 * DISK_SCRUB_BANDWIDTH_FRACTION),
      DISK_SCRUB_MIN_KBPS
    ),
  };
}
