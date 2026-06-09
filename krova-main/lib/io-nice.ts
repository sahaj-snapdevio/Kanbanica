import { DISK_IO_STORAGE_TUNING_ENABLED } from "@/config/platform";

/**
 * Host-side I/O + CPU de-prioritization prefix for BACKGROUND storage operations
 * that run on the bare-metal host and would otherwise contend with live cubes on
 * the shared SATA-RAID1 array (disk overhaul F / Task F3.3): restic, zstd, and the
 * `e2fsck`/`resize2fs` grow passes on import / redeploy / clone / restore /
 * transfer / resize / provision.
 *
 * `ionice -c2 -n7` = best-effort, lowest priority (only yields UNDER contention;
 * idle throughput is unchanged); `nice -n10` deprioritizes CPU.
 *
 * Returns "" when DISK_IO_STORAGE_TUNING_ENABLED is off → byte-identical to the
 * historical command. The wrapped command MUST follow this prefix DIRECTLY, with
 * NO `VAR=val` env assignment between it and `nice` — the env-after-`nice` ordering
 * is what broke every restic snapshot on 2026-06-06 (`nice` execs the assignment).
 * `ionice` is util-linux + `nice` is coreutils, both verified by the
 * `verify host tools` step (Rule 46).
 *
 * SINGLE SOURCE (Rule 14). NOT for guest-side commands (e.g. `resize2fs /dev/vda`
 * inside the VM) — those are the customer's own resource, not host contention.
 */
export function ioNicePrefix(): string {
  return DISK_IO_STORAGE_TUNING_ENABLED ? "ionice -c2 -n7 nice -n10 " : "";
}
