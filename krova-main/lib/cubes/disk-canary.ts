/**
 * Per-cube canary resolution for the disk-I/O overhaul. A cube on the
 * `DISK_CANARY_CUBE_IDS` allowlist gets the per-cube disk features even while the
 * global flags are off (mirrors the JAILER_ENABLED_CUBE_IDS idiom), so the
 * overhaul can be validated on ONE real cube before any fleet-wide flip.
 *
 * Pure + always-safe (no I/O); the launch sites OR it with the global flag, e.g.
 *   cacheWriteback: DISK_WRITEBACK_CACHE_ENABLED || isDiskCanaryCube(cubeId)
 */

import { DISK_CANARY_CUBE_IDS } from "@/config/platform";

/** True iff this cube is on the disk-canary allowlist. Empty list → always false. */
export function isDiskCanaryCube(cubeId: string): boolean {
  return DISK_CANARY_CUBE_IDS.includes(cubeId);
}
