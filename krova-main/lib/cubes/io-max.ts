/**
 * Sole formatter of a cgroup-v2 `io.max` leaf-write line. Kept separate from the
 * numeric `cubeIoMax` (lib/cubes/disk-iops.ts) so the device-resolution + string
 * shaping live in one place (mirrors the cpu-weight.ts pure-number vs
 * cpu-cgroup.ts line-shaping split).
 *
 * IMPORTANT (live-validated 2026-06-05): the jailer v1.15.1 REJECTS an
 * `io.max=<dev> wbps=N` `--cgroup` arg (`Error: CgroupFormat` — its file=value
 * parser refuses the space + second `=`). So this line is NEVER passed to the
 * jailer; the worker writes it DIRECTLY to `/sys/fs/cgroup/<parent>/<cubeId>/io.max`
 * after the jailer creates the leaf. cgroup `io.max` merges partial writes and
 * treats an omitted key as "max" (no limit), so we emit ONLY the axes the tier
 * actually caps: the bandwidth pair (wbps+rbps) and/or the ops pair (wiops+riops).
 * An unlimited axis is omitted; a fully-unlimited tier yields `null` (no write).
 *
 * The device MUST be the `<maj:min>` of the dm/LVM logical volume backing the
 * cube's rootfs FILE (resolved at runtime by `cubeDiskDeviceCommand`), NOT a
 * physical `sd*` member — on ext4-on-LVM-on-RAID1 the writeback bios carry the
 * `dm` device number, so an `sd*` key would throttle nothing.
 */

import type { CubeIoMax } from "@/lib/cubes/disk-iops";

/** `<maj:min>` shape, e.g. "253:0". */
const MAJ_MIN = /^\d+:\d+$/;

/**
 * Build the `io.max` line for a cube's leaf. Returns `null` (caller writes
 * nothing → byte-identical) when the device is malformed or the limits are
 * missing — never throws, never emits a partial/`NaN` line that the kernel would
 * reject.
 */
function pos(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

export function buildIoMaxLine(
  device: string | null | undefined,
  limits: CubeIoMax | null | undefined
): string | null {
  if (!device || !MAJ_MIN.test(device) || !limits) {
    return null;
  }
  const parts: string[] = [];
  // bandwidth axis — emit only if BOTH wbps + rbps are valid positives.
  if (pos(limits.wbps) && pos(limits.rbps)) {
    parts.push(
      `wbps=${Math.round(limits.wbps)}`,
      `rbps=${Math.round(limits.rbps)}`
    );
  }
  // ops axis — emit only if BOTH wiops + riops are valid positives.
  if (pos(limits.wiops) && pos(limits.riops)) {
    parts.push(
      `wiops=${Math.round(limits.wiops)}`,
      `riops=${Math.round(limits.riops)}`
    );
  }
  if (parts.length === 0) {
    return null;
  }
  return `${device} ${parts.join(" ")}`;
}
