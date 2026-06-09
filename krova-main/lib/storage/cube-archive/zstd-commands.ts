/**
 * Pure builders for the host-side zstd `.cube` compress (backup) + decompress
 * (import/redeploy) commands. EXPORTED + pure so their structure is locked by a
 * unit test (zstd-commands.test.ts) — the class of bug the 2026-06-06 restic
 * incident exposed (a command string shipped to a host with no structure test).
 *
 * `ionicePrefix` ("" or "ionice -c2 -n7 nice -n10 ") + `threads` are passed by the
 * caller (gated on DISK_IO_STORAGE_TUNING_ENABLED) so BOTH flag states are testable
 * deterministically. zstd follows the prefix DIRECTLY with NO `VAR=val` env
 * assignment between it and `nice` — unlike restic, zstd needs no env, so it is
 * structurally immune to the env-after-nice ordering bug.
 */

import { shellEscape } from "@/lib/ssh";

/** `.cube` backup compression: `-T<threads>` (0 = all cores), `-f` overwrites a stale file. */
export function zstdCompressCommand(args: {
  ionicePrefix: string;
  rootfsPath: string;
  compressedPath: string;
  level: number;
  threads: number;
}): string {
  return `${args.ionicePrefix}zstd -${args.level} -T${args.threads} -f ${shellEscape(args.rootfsPath)} -o ${shellEscape(args.compressedPath)}`;
}

/** Import/redeploy decompression of a `.cube` blob back to a raw rootfs. */
export function zstdDecompressCommand(args: {
  ionicePrefix: string;
  compressedPath: string;
  rootfsPath: string;
}): string {
  return `${args.ionicePrefix}zstd -d -f ${shellEscape(args.compressedPath)} -o ${shellEscape(args.rootfsPath)}`;
}
